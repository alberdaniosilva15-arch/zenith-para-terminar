-- =============================================================================
-- ZENITH RIDE v3.5 — MIGRAÇÃO FINAL CONSOLIDADA
-- Data: 2026-04-21
-- Objectivo: Corrigir TODOS os ERRs identificados na auditoria completa
--            Esta migração é 100% idempotente (segura para re-executar)
--
-- INSTRUÇÕES:
--   1. Vai ao Dashboard Supabase → SQL Editor
--   2. Cola TODO este ficheiro
--   3. Clica em "Run"
--   4. Verifica que não há erros a vermelho
-- =============================================================================

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECÇÃO A: COLUNAS EM FALTA (idempotente com IF NOT EXISTS)
-- ══════════════════════════════════════════════════════════════════════════════

-- A.1 · Tabela profiles — campos bio, emergência, localização, quota, tier
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio                     TEXT,
  ADD COLUMN IF NOT EXISTS phone_privacy           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS emergency_contact_name  TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS last_known_lat          DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_known_lng          DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS chat_quota              INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS user_tier               TEXT DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS referral_code           TEXT UNIQUE;

-- A.2 · Tabela users — suspensão de conta
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ;

-- A.3 · Tabela rides — campos do motor de preços
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS vehicle_type       TEXT DEFAULT 'moto',
  ADD COLUMN IF NOT EXISTS proposed_price     NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS traffic_factor     NUMERIC DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS route_distance_km  NUMERIC,
  ADD COLUMN IF NOT EXISTS route_duration_min NUMERIC,
  ADD COLUMN IF NOT EXISTS route_polyline     TEXT,
  ADD COLUMN IF NOT EXISTS surge_factor       NUMERIC DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS zone_multiplier    NUMERIC DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS user_factor        NUMERIC DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS price_locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_pending    BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS payment_error      TEXT;

-- A.4 · Tabela driver_locations — H3 indexes para matching rápido
ALTER TABLE public.driver_locations
  ADD COLUMN IF NOT EXISTS h3_index_res9 TEXT,
  ADD COLUMN IF NOT EXISTS h3_index_res7 TEXT;

CREATE INDEX IF NOT EXISTS idx_driver_locations_h3_res9
  ON public.driver_locations(h3_index_res9);
CREATE INDEX IF NOT EXISTS idx_driver_locations_h3_res7
  ON public.driver_locations(h3_index_res7);

-- ══════════════════════════════════════════════════════════════════════════════
-- SECÇÃO B: RPCs CRÍTICAS EM FALTA
-- ══════════════════════════════════════════════════════════════════════════════

-- B.1 · is_admin_secure — usada pelo CRM para verificar acesso admin
CREATE OR REPLACE FUNCTION public.is_admin_secure()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.is_admin_secure() TO authenticated;

-- B.2 · set_my_role_driver — promoção de passageiro a motorista via OAuth
CREATE OR REPLACE FUNCTION public.set_my_role_driver()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.users
  SET role = 'driver', updated_at = NOW()
  WHERE id = auth.uid()
    AND role = 'passenger';
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_my_role_driver() TO authenticated;

-- B.3 · ensure_user_exists — auto-repair quando trigger handle_new_user falha
CREATE OR REPLACE FUNCTION public.ensure_user_exists(
  p_user_id UUID,
  p_email   TEXT,
  p_name    TEXT DEFAULT '',
  p_role    TEXT DEFAULT 'passenger'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, role)
  VALUES (p_user_id, p_email, p_role::user_role)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (user_id, name)
  VALUES (p_user_id, COALESCE(NULLIF(p_name, ''), split_part(p_email, '@', 1)))
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.wallets (user_id, balance)
  VALUES (p_user_id, 0.00)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_privacy (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ensure_user_exists(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- B.4 · find_drivers_h3 — matching de motoristas por índice H3 (ultra-rápido)
CREATE OR REPLACE FUNCTION public.find_drivers_h3(
  p_h3_indexes TEXT[],
  p_limit      INT DEFAULT 8
)
RETURNS TABLE(
  driver_id    UUID,
  driver_name  TEXT,
  avatar_url   TEXT,
  rating       NUMERIC,
  total_rides  INT,
  level        TEXT,
  distance_m   DOUBLE PRECISION,
  eta_min      INT,
  heading      NUMERIC,
  motogo_score INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_h3_indexes IS NULL OR array_length(p_h3_indexes, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    dl.driver_id,
    pr.name                  AS driver_name,
    pr.avatar_url,
    pr.rating,
    pr.total_rides,
    pr.level,
    500::DOUBLE PRECISION    AS distance_m,
    2::INT                   AS eta_min,
    dl.heading,
    COALESCE(ms.score, 500)  AS motogo_score
  FROM public.driver_locations dl
  JOIN public.profiles pr ON pr.user_id = dl.driver_id
  LEFT JOIN public.motogo_scores ms ON ms.driver_id = dl.driver_id
  WHERE dl.status = 'available'
    AND dl.h3_index_res9 = ANY(p_h3_indexes)
  ORDER BY
    COALESCE(ms.score, 500) DESC,
    pr.rating DESC,
    dl.updated_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 8), 1);
END;
$$;
GRANT EXECUTE ON FUNCTION public.find_drivers_h3(TEXT[], INT) TO authenticated;

-- B.5 · decline_ride_atomic — recusa atómica de corrida (sem race condition)
CREATE OR REPLACE FUNCTION public.decline_ride_atomic(
  p_ride_id   UUID,
  p_driver_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status    ride_status;
  v_driver_id UUID;
BEGIN
  BEGIN
    SELECT r.status, r.driver_id
      INTO v_status, v_driver_id
    FROM public.rides r
    WHERE r.id = p_ride_id
    FOR UPDATE NOWAIT;
  EXCEPTION
    WHEN lock_not_available THEN
      RETURN jsonb_build_object('success', false, 'reason', 'concurrent_update');
  END;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'ride_not_found');
  END IF;

  IF v_driver_id IS DISTINCT FROM p_driver_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_your_ride');
  END IF;

  IF v_status NOT IN ('accepted', 'picking_up') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'ride_not_declinable');
  END IF;

  UPDATE public.rides
  SET
    driver_id        = NULL,
    driver_confirmed = FALSE,
    status           = 'searching',
    accepted_at      = NULL,
    pickup_at        = NULL
  WHERE id = p_ride_id;

  UPDATE public.driver_locations
  SET status = 'available', updated_at = NOW()
  WHERE driver_id = p_driver_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.decline_ride_atomic(UUID, UUID) TO authenticated;

-- B.6 · recharge_chat_quota — recarrega créditos do Kaze após corrida
CREATE OR REPLACE FUNCTION public.recharge_chat_quota(
  p_user_id UUID,
  amount    INT DEFAULT 10
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET chat_quota = LEAST(COALESCE(chat_quota, 0) + amount, 50)
  WHERE user_id = p_user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.recharge_chat_quota(UUID, INT) TO authenticated;

-- B.7 · process_ride_payment_v3 — processamento completo de pagamento
-- DROP obrigatório: PostgreSQL não permite alterar defaults com CREATE OR REPLACE
DROP FUNCTION IF EXISTS public.process_ride_payment_v3(
  UUID, UUID, UUID, NUMERIC, NUMERIC,
  TEXT, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT, DOUBLE PRECISION, DOUBLE PRECISION
);
CREATE OR REPLACE FUNCTION public.process_ride_payment_v3(
  p_ride_id       UUID,
  p_passenger_id  UUID,
  p_driver_id     UUID,
  p_amount        NUMERIC,
  p_distance_km   NUMERIC,
  p_origin_addr   TEXT,
  p_origin_lat    DOUBLE PRECISION,
  p_origin_lng    DOUBLE PRECISION,
  p_dest_addr     TEXT,
  p_dest_lat      DOUBLE PRECISION,
  p_dest_lng      DOUBLE PRECISION
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_platform_fee   NUMERIC;
  v_driver_earning NUMERIC;
  v_pass_bal_after NUMERIC;
  v_driv_bal_after NUMERIC;
BEGIN
  v_platform_fee   := ROUND(p_amount * 0.15, 2);
  v_driver_earning := p_amount - v_platform_fee;

  -- Debitar passageiro (permite saldo negativo — cobrado no próximo top-up)
  INSERT INTO public.wallets (user_id, balance)
  VALUES (p_passenger_id, 0.00)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.wallets
  SET balance = balance - p_amount, updated_at = NOW()
  WHERE user_id = p_passenger_id
  RETURNING balance INTO v_pass_bal_after;

  INSERT INTO public.transactions (user_id, ride_id, amount, type, description, balance_after)
  VALUES (p_passenger_id, p_ride_id, -p_amount, 'ride_payment',
    format('Corrida %s → %s (%.1f km)', p_origin_addr, p_dest_addr, p_distance_km),
    COALESCE(v_pass_bal_after, 0));

  -- Creditar motorista
  INSERT INTO public.wallets (user_id, balance)
  VALUES (p_driver_id, v_driver_earning)
  ON CONFLICT (user_id) DO UPDATE
    SET balance = wallets.balance + v_driver_earning, updated_at = NOW()
  RETURNING balance INTO v_driv_bal_after;

  INSERT INTO public.transactions (user_id, ride_id, amount, type, description, balance_after)
  VALUES (p_driver_id, p_ride_id, v_driver_earning, 'ride_earning',
    format('Ganho: %s → %s (%.1f km)', p_origin_addr, p_dest_addr, p_distance_km),
    COALESCE(v_driv_bal_after, v_driver_earning));

  -- Actualizar estatísticas do motorista
  UPDATE public.profiles
  SET km_total = COALESCE(km_total, 0) + COALESCE(p_distance_km, 0)
  WHERE user_id = p_driver_id;

  -- Actualizar predições para o Kaze Preditivo
  INSERT INTO public.ride_predictions (
    user_id, origin_address, origin_lat, origin_lng,
    dest_address, dest_lat, dest_lng, frequency, last_used_at, avg_price_kz
  )
  VALUES (
    p_passenger_id, p_origin_addr, p_origin_lat, p_origin_lng,
    p_dest_addr, p_dest_lat, p_dest_lng, 1, NOW(), p_amount
  )
  ON CONFLICT (user_id, origin_address, dest_address)
  DO UPDATE SET
    frequency    = ride_predictions.frequency + 1,
    last_used_at = NOW(),
    avg_price_kz = ROUND(
      (COALESCE(ride_predictions.avg_price_kz, p_amount) * ride_predictions.frequency + p_amount)
      / (ride_predictions.frequency + 1), 2
    );
END;
$$;

-- B.8 · check_rate_limit — rate limiting server-side para Edge Functions
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id        UUID,
  p_endpoint       VARCHAR,
  p_limit          INT,
  p_window_seconds INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req_count INT;
BEGIN
  DELETE FROM public.api_rate_limits
  WHERE request_time < (NOW() - (p_window_seconds || ' seconds')::interval);

  SELECT COUNT(*) INTO req_count
  FROM public.api_rate_limits
  WHERE user_id = p_user_id
    AND endpoint = p_endpoint
    AND request_time >= (NOW() - (p_window_seconds || ' seconds')::interval);

  IF req_count >= p_limit THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.api_rate_limits (user_id, endpoint)
  VALUES (p_user_id, p_endpoint);

  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(UUID, VARCHAR, INT, INT) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- SECÇÃO C: TABELAS DAS NOVAS FEATURES
-- ══════════════════════════════════════════════════════════════════════════════

-- C.1 · Referrals — sistema "Traz o Mano"
CREATE TABLE IF NOT EXISTS public.referrals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id   UUID NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  referred_id   UUID REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  referral_code VARCHAR(20) NOT NULL,
  status        VARCHAR(20) DEFAULT 'pending'
                  CHECK (status IN ('pending', 'completed', 'cancelled', 'expired')),
  reward_kz     NUMERIC(10,2) DEFAULT 500.00,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  UNIQUE (referred_id)
);
CREATE INDEX IF NOT EXISTS idx_referrals_code     ON public.referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals(referrer_id);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "referrals_select_referrer" ON public.referrals;
DROP POLICY IF EXISTS "referrals_select_referred"  ON public.referrals;
DROP POLICY IF EXISTS "referrals_insert_referred"  ON public.referrals;

CREATE POLICY "referrals_select_referrer"
  ON public.referrals FOR SELECT USING (auth.uid() = referrer_id);
CREATE POLICY "referrals_select_referred"
  ON public.referrals FOR SELECT USING (auth.uid() = referred_id);
CREATE POLICY "referrals_insert_referred"
  ON public.referrals FOR INSERT WITH CHECK (auth.uid() = referred_id);

-- C.2 · Panic Alerts — Kaze Safety Shield
CREATE TABLE IF NOT EXISTS public.panic_alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ride_id      UUID REFERENCES public.rides(id) ON DELETE SET NULL,
  lat          NUMERIC(10,7),
  lng          NUMERIC(10,7),
  driver_name  VARCHAR(100),
  status       VARCHAR(20) DEFAULT 'active'
                 CHECK (status IN ('active', 'resolved', 'false_alarm')),
  resolved_by  UUID REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ
);
ALTER TABLE public.panic_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "panic_insert"    ON public.panic_alerts;
DROP POLICY IF EXISTS "panic_select_admin" ON public.panic_alerts;
CREATE POLICY "panic_insert"
  ON public.panic_alerts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "panic_select_admin"
  ON public.panic_alerts FOR SELECT USING (public.is_admin_secure());

-- C.3 · API Rate Limits — rate limiting server-side
CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID DEFAULT auth.uid(),
  endpoint     VARCHAR(100) NOT NULL,
  request_time TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_rate_limits_user_endpoint_time
  ON public.api_rate_limits(user_id, endpoint, request_time);

-- C.4 · Driver Insurance — Seguro MotoGo Basic
CREATE TABLE IF NOT EXISTS public.driver_insurance (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  plan_type  TEXT NOT NULL DEFAULT 'basic' CHECK (plan_type IN ('basic', 'premium')),
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  premium_kz NUMERIC(10,2) NOT NULL DEFAULT 0,
  deducted   NUMERIC(10,2) NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  UNIQUE(driver_id)
);

-- C.5 · Cash Advances — MotoGo Cash Advance para motoristas Diamante
CREATE TABLE IF NOT EXISTS public.cash_advances (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id  UUID NOT NULL REFERENCES public.users(id),
  amount_kz  NUMERIC(10,2) NOT NULL,
  fee_kz     NUMERIC(10,2) NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'repaid', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  repaid_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cash_advances_driver ON public.cash_advances(driver_id);

-- C.6 · Demand Heatmap — Mapa de calor de procura por zona H3
CREATE TABLE IF NOT EXISTS public.demand_heatmap (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  h3_index     TEXT NOT NULL,
  demand_count INT NOT NULL DEFAULT 0,
  supply_count INT NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT date_trunc('hour', NOW()),
  UNIQUE(h3_index, window_start)
);
CREATE INDEX IF NOT EXISTS idx_heatmap_h3     ON public.demand_heatmap(h3_index);
CREATE INDEX IF NOT EXISTS idx_heatmap_window ON public.demand_heatmap(window_start);

-- C.7 · Contratos B2B — campos empresariais
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contracts' AND column_name = 'company_name'
  ) THEN
    ALTER TABLE public.contracts
      ADD COLUMN IF NOT EXISTS company_name   TEXT,
      ADD COLUMN IF NOT EXISTS company_nif    TEXT,
      ADD COLUMN IF NOT EXISTS monthly_budget NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS billing_email  TEXT;
  END IF;
END $$;

-- C.8 · Pricing Config — garantir que existe (motor de preços depende disto)
CREATE TABLE IF NOT EXISTS public.pricing_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  base_fare_kz    NUMERIC NOT NULL DEFAULT 300,
  rate_per_km_kz  NUMERIC NOT NULL DEFAULT 182,
  rate_per_min_kz NUMERIC NOT NULL DEFAULT 15,
  surge_alpha     NUMERIC NOT NULL DEFAULT 0.3,
  surge_max       NUMERIC NOT NULL DEFAULT 2.5,
  wl_talatona     NUMERIC NOT NULL DEFAULT 1.15,
  wl_miramar      NUMERIC NOT NULL DEFAULT 1.10,
  wl_viana        NUMERIC NOT NULL DEFAULT 0.90,
  wl_premium      NUMERIC NOT NULL DEFAULT 1.5,
  wl_eco          NUMERIC NOT NULL DEFAULT 0.8,
  wl_standard     NUMERIC NOT NULL DEFAULT 1.0,
  u_vip           NUMERIC NOT NULL DEFAULT 0.95,
  u_problematic   NUMERIC NOT NULL DEFAULT 1.15,
  u_standard      NUMERIC NOT NULL DEFAULT 1.0,
  fee_night_kz    NUMERIC NOT NULL DEFAULT 100,
  fee_airport_kz  NUMERIC NOT NULL DEFAULT 200,
  fee_traffic_kz  NUMERIC NOT NULL DEFAULT 50,
  traffic_threshold NUMERIC NOT NULL DEFAULT 1.3,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.pricing_config (is_active)
SELECT TRUE WHERE NOT EXISTS (SELECT 1 FROM public.pricing_config);

-- ══════════════════════════════════════════════════════════════════════════════
-- SECÇÃO D: CORRECÇÕES DE SEGURANÇA RLS
-- ══════════════════════════════════════════════════════════════════════════════

-- D.1 · Rides — policy de actualização corrigida (evita hijack de corridas)
DROP POLICY IF EXISTS "rides: actualiza" ON public.rides;
DROP POLICY IF EXISTS "rides: passageiro ou motorista autenticado atualiza" ON public.rides;

CREATE POLICY "rides: passageiro ou motorista autenticado atualiza"
ON public.rides
FOR UPDATE TO authenticated
USING (
  passenger_id = auth.uid() OR
  driver_id    = auth.uid() OR
  (driver_id IS NULL AND status = 'searching')
)
WITH CHECK (
  passenger_id = auth.uid() OR driver_id = auth.uid()
);

-- D.2 · Rides — motoristas podem ver corridas em searching
DROP POLICY IF EXISTS "rides: motorista pode ver corridas em searching" ON public.rides;
CREATE POLICY "rides: motorista pode ver corridas em searching"
ON public.rides
FOR SELECT TO authenticated
USING (status = 'searching');

-- D.3 · Driver locations — só o próprio motorista actualiza a sua posição
DROP POLICY IF EXISTS "driver_locations_update" ON public.driver_locations;
CREATE POLICY "driver_locations_update"
ON public.driver_locations
FOR UPDATE TO authenticated
USING    (driver_id = auth.uid())
WITH CHECK (driver_id = auth.uid());

-- D.4 · School tracking sessions — fechar leitura pública
DROP POLICY IF EXISTS "tracking: leitura pública" ON public.school_tracking_sessions;
DROP POLICY IF EXISTS "tracking: dono lê"          ON public.school_tracking_sessions;
CREATE POLICY "tracking: dono lê"
  ON public.school_tracking_sessions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.contracts c
    WHERE c.id = contract_id AND c.user_id = auth.uid()
  ));

-- ══════════════════════════════════════════════════════════════════════════════
-- SECÇÃO E: STORAGE BUCKETS
-- ══════════════════════════════════════════════════════════════════════════════

-- E.1 · Bucket para áudio de pânico (Safety Shield)
INSERT INTO storage.buckets (id, name, public)
VALUES ('panic-audio', 'panic-audio', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Admins can access panic audio" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload panic audio"  ON storage.objects;

CREATE POLICY "Admins can access panic audio"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'panic-audio' AND public.is_admin_secure());

CREATE POLICY "Users can upload panic audio"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'panic-audio' AND auth.uid() IS NOT NULL);

-- ══════════════════════════════════════════════════════════════════════════════
-- FIM — Migração aplicada com sucesso
-- ══════════════════════════════════════════════════════════════════════════════
COMMIT;
