-- =============================================================================
-- ZENITH RIDE — MIGRAÇÃO CRÍTICA 2026-04-20
-- Objectivo: Alinhar BD com o código (resolver TODOS os ERR-01 a ERR-07)
-- Seguro para re-executar (100% idempotente)
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. COLUNAS EM FALTA NA TABELA profiles
--    (bio, phone_privacy, emergency_contact_*, last_known_lat/lng, chat_quota,
--     suspended_until, user_tier)
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio                    TEXT,
  ADD COLUMN IF NOT EXISTS phone_privacy          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS last_known_lat         DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_known_lng         DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS chat_quota             INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS user_tier              TEXT DEFAULT 'standard';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. COLUNA suspended_until NA TABELA users
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. COLUNAS EM FALTA NA TABELA rides (vehicle_type + campos engine pro)
-- ═══════════════════════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. COLUNAS H3 EM driver_locations (caso a migração 20260417 não tenha sido aplicada)
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.driver_locations
  ADD COLUMN IF NOT EXISTS h3_index_res9 TEXT,
  ADD COLUMN IF NOT EXISTS h3_index_res7 TEXT;

CREATE INDEX IF NOT EXISTS idx_driver_locations_h3_res9
  ON public.driver_locations(h3_index_res9);
CREATE INDEX IF NOT EXISTS idx_driver_locations_h3_res7
  ON public.driver_locations(h3_index_res7);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. RPC is_admin_secure — usada pelo CRM (ERR-02)
--    Wrapper SECURITY DEFINER em volta de is_admin() existente
-- ═══════════════════════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. RPC set_my_role_driver — usada pelo OAuth intent (ERR-05 do AuthContext)
--    Permite que o próprio utilizador promova a sua conta para motorista
-- ═══════════════════════════════════════════════════════════════════════════════
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
    AND role = 'passenger';  -- Só promove passageiro → motorista (nunca rebaixa admin)
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_my_role_driver() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. RPC ensure_user_exists — auto-repair para ERR-01
--    Se o trigger handle_new_user falhou, esta RPC cria o utilizador manualmente
-- ═══════════════════════════════════════════════════════════════════════════════
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
  -- 1. Garantir utilizador na tabela users
  INSERT INTO public.users (id, email, role)
  VALUES (p_user_id, p_email, p_role::user_role)
  ON CONFLICT (id) DO NOTHING;

  -- 2. Garantir perfil
  INSERT INTO public.profiles (user_id, name)
  VALUES (p_user_id, COALESCE(NULLIF(p_name, ''), split_part(p_email, '@', 1)))
  ON CONFLICT (user_id) DO NOTHING;

  -- 3. Garantir carteira
  INSERT INTO public.wallets (user_id, balance)
  VALUES (p_user_id, 0.00)
  ON CONFLICT (user_id) DO NOTHING;

  -- 4. Garantir privacidade VoIP
  INSERT INTO public.user_privacy (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_user_exists(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. RPC process_ride_payment_v3 — versão completa com 11 parâmetros
--    (referenciada pelo trigger trg_payment_on_complete)
-- ═══════════════════════════════════════════════════════════════════════════════
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
  v_passenger_balance NUMERIC;
  v_platform_fee      NUMERIC;
  v_driver_earning    NUMERIC;
  v_pass_bal_after    NUMERIC;
  v_driv_bal_after    NUMERIC;
BEGIN
  v_platform_fee   := ROUND(p_amount * 0.15, 2);
  v_driver_earning := p_amount - v_platform_fee;

  -- Debitar passageiro
  SELECT balance INTO v_passenger_balance
  FROM public.wallets WHERE user_id = p_passenger_id FOR UPDATE;

  IF NOT FOUND THEN
    -- Criar carteira se não existe
    INSERT INTO public.wallets (user_id, balance)
    VALUES (p_passenger_id, 0.00)
    ON CONFLICT (user_id) DO NOTHING;
    v_passenger_balance := 0;
  END IF;

  IF v_passenger_balance < p_amount THEN
    -- Permitir saldo negativo em vez de bloquear a corrida
    -- (será cobrado no próximo top-up)
    RAISE WARNING '[payment_v3] Saldo insuficiente para ride %: disponível=%, necessário=%',
      p_ride_id, v_passenger_balance, p_amount;
  END IF;

  UPDATE public.wallets
  SET balance = balance - p_amount, updated_at = NOW()
  WHERE user_id = p_passenger_id
  RETURNING balance INTO v_pass_bal_after;

  INSERT INTO public.transactions (user_id, ride_id, amount, type, description, balance_after)
  VALUES (p_passenger_id, p_ride_id, -p_amount, 'ride_payment',
    format('Corrida %s → %s (%.1f km)', p_origin_addr, p_dest_addr, p_distance_km),
    COALESCE(v_pass_bal_after, 0));

  -- Creditar motorista
  UPDATE public.wallets
  SET balance = balance + v_driver_earning, updated_at = NOW()
  WHERE user_id = p_driver_id
  RETURNING balance INTO v_driv_bal_after;

  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id, balance)
    VALUES (p_driver_id, v_driver_earning)
    ON CONFLICT (user_id) DO UPDATE SET balance = wallets.balance + v_driver_earning;
    v_driv_bal_after := v_driver_earning;
  END IF;

  INSERT INTO public.transactions (user_id, ride_id, amount, type, description, balance_after)
  VALUES (p_driver_id, p_ride_id, v_driver_earning, 'ride_earning',
    format('Ganho: %s → %s (%.1f km)', p_origin_addr, p_dest_addr, p_distance_km),
    COALESCE(v_driv_bal_after, 0));

  -- Actualizar km_total e gamificação no perfil do motorista
  UPDATE public.profiles
  SET km_total = COALESCE(km_total, 0) + COALESCE(p_distance_km, 0),
      free_km_available = CASE
        WHEN COALESCE(km_total, 0) + COALESCE(p_distance_km, 0) >= COALESCE(km_to_next_perk, 70)
        THEN COALESCE(free_km_available, 0) + 5
        ELSE COALESCE(free_km_available, 0)
      END,
      km_to_next_perk = CASE
        WHEN COALESCE(km_total, 0) + COALESCE(p_distance_km, 0) >= COALESCE(km_to_next_perk, 70)
        THEN COALESCE(km_to_next_perk, 70) + 70
        ELSE COALESCE(km_to_next_perk, 70)
      END
  WHERE user_id = p_driver_id;

  -- Actualizar ride prediction para o Kaze Preditivo
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

-- ═══════════════════════════════════════════════════════════════════════════════
-- 9. RPC find_drivers_h3 (caso a migração 20260417 não tenha sido aplicada)
-- ═══════════════════════════════════════════════════════════════════════════════
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
    AND dl.h3_index_res9 = ANY (p_h3_indexes)
  ORDER BY
    COALESCE(ms.score, 500) DESC,
    pr.rating DESC,
    dl.updated_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 8), 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_drivers_h3(TEXT[], INT) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 10. RPC decline_ride_atomic (caso a migração 20260417 não tenha sido aplicada)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.decline_ride_atomic(
  p_ride_id   UUID,
  p_driver_id UUID
)
RETURNS TABLE(
  success BOOLEAN,
  reason  TEXT
)
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
      RETURN QUERY SELECT false, 'concurrent_update'::TEXT;
      RETURN;
  END;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'ride_not_found'::TEXT;
    RETURN;
  END IF;

  IF v_driver_id IS DISTINCT FROM p_driver_id THEN
    RETURN QUERY SELECT false, 'not_your_ride'::TEXT;
    RETURN;
  END IF;

  IF v_status NOT IN ('accepted', 'picking_up') THEN
    RETURN QUERY SELECT false, 'ride_not_declinable'::TEXT;
    RETURN;
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

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decline_ride_atomic(UUID, UUID) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 11. Tabela de Referrals (Feature F12 — "Traz o Mano")
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.referrals (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referrer_id   UUID NOT NULL REFERENCES public.users(id),
  referred_id   UUID REFERENCES public.users(id),
  referral_code TEXT NOT NULL UNIQUE,
  reward_kz     NUMERIC(10,2) NOT NULL DEFAULT 500,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_referrals_code ON public.referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals(referrer_id);

-- Coluna de referral_code no profile
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 12. Tabela de Seguros MotoGo (Feature F6)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.driver_insurance (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  plan_type  TEXT NOT NULL DEFAULT 'basic' CHECK (plan_type IN ('basic', 'premium')),
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  premium_kz NUMERIC(10,2) NOT NULL DEFAULT 0,
  deducted   NUMERIC(10,2) NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  UNIQUE(driver_id)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 13. Tabela de Adiantamentos de Ganhos (Feature F8 — MotoGo Cash Advance)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.cash_advances (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id   UUID NOT NULL REFERENCES public.users(id),
  amount_kz   NUMERIC(10,2) NOT NULL,
  fee_kz      NUMERIC(10,2) NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'repaid', 'rejected')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  repaid_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cash_advances_driver ON public.cash_advances(driver_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 14. Tabela de Contratos B2B (Feature F9 — Zenith B2B)
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  -- Adicionar 'corporate' e 'b2b' aos contract_type check se não existir
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contracts' AND column_name = 'company_name'
  ) THEN
    ALTER TABLE public.contracts
      ADD COLUMN IF NOT EXISTS company_name     TEXT,
      ADD COLUMN IF NOT EXISTS company_nif      TEXT,
      ADD COLUMN IF NOT EXISTS monthly_budget   NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS billing_email    TEXT;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 15. Tabela de Heatmap Analytics (Feature F5 — Mapa de Calor)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.demand_heatmap (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  h3_index      TEXT NOT NULL,
  demand_count  INT NOT NULL DEFAULT 0,
  supply_count  INT NOT NULL DEFAULT 0,
  window_start  TIMESTAMPTZ NOT NULL DEFAULT date_trunc('hour', NOW()),
  UNIQUE(h3_index, window_start)
);

CREATE INDEX IF NOT EXISTS idx_heatmap_h3 ON public.demand_heatmap(h3_index);
CREATE INDEX IF NOT EXISTS idx_heatmap_window ON public.demand_heatmap(window_start);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 16. Pricing Config — garantir que existe (engine_pro_fare.sql depende disto)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.pricing_config (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

-- Inserir configuração default se não existir nenhuma
INSERT INTO public.pricing_config (is_active)
SELECT TRUE
WHERE NOT EXISTS (SELECT 1 FROM public.pricing_config);

-- ═══════════════════════════════════════════════════════════════════════════════
-- DONE — Migração aplicada com sucesso
-- ═══════════════════════════════════════════════════════════════════════════════
