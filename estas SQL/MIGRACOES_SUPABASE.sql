-- =====================================================================
-- ZENITH RIDE - MIGRATIONS PARA O SUPABASE SQL EDITOR
-- ATENÇÃO: Executa cada bloco separadamente, por ordem!
-- =====================================================================

-- ---------------------------------------------------------------------
-- MIGRATION 2.1 — Trigger de Role Automática (CRÍTICO DE SEGURANÇA)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, name, email)
  VALUES (
    new.id,
    new.raw_user_meta_data->>'name',
    new.email
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ---------------------------------------------------------------------
-- MIGRATION 2.2 — RLS para driver_locations (CRÍTICO DE SEGURANÇA)
-- ---------------------------------------------------------------------
ALTER TABLE public.driver_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drivers_update_own_location"
ON public.driver_locations FOR ALL
USING (auth.uid() = driver_id);

CREATE POLICY "passengers_see_available_drivers"
ON public.driver_locations FOR SELECT
USING (status = 'available');


-- ---------------------------------------------------------------------
-- MIGRATION 2.3 — Colunas de Gamificação no profiles
-- ---------------------------------------------------------------------
-- Garantir que a coluna 'role' existe antes de ser usada no código
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS role               TEXT          DEFAULT 'passenger'
  CHECK (role IN ('passenger', 'driver', 'admin')),
ADD COLUMN IF NOT EXISTS km_total            NUMERIC       DEFAULT 0,
ADD COLUMN IF NOT EXISTS free_km_available   NUMERIC       DEFAULT 0,
ADD COLUMN IF NOT EXISTS km_to_next_perk     NUMERIC       DEFAULT 70,
ADD COLUMN IF NOT EXISTS last_known_lat      DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS last_known_lng      DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS user_tier           TEXT          DEFAULT 'standard'
  CHECK (user_tier IN ('new', 'standard', 'vip', 'problematic'));

COMMENT ON COLUMN public.profiles.role            IS 'Role do utilizador: passenger, driver ou admin';
COMMENT ON COLUMN public.profiles.km_total        IS 'Total km acumulados (perk a cada 70km)';
COMMENT ON COLUMN public.profiles.km_to_next_perk IS 'km restantes para próximo perk (começa em 70)';
COMMENT ON COLUMN public.profiles.user_tier       IS 'Tier do utilizador para o Engine Pro';

-- Actualizar trigger para incluir role agora que a coluna existe
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, name, role, email)
  VALUES (
    new.id,
    new.raw_user_meta_data->>'name',
    'passenger',
    new.email
  )
  ON CONFLICT (user_id) DO UPDATE SET
    name  = EXCLUDED.name,
    email = EXCLUDED.email;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ---------------------------------------------------------------------
-- MIGRATION 2.4 — Colunas em falta nos rides
-- ---------------------------------------------------------------------
ALTER TABLE public.rides
ADD COLUMN IF NOT EXISTS contract_id         UUID REFERENCES public.contracts(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS scheduled_time      TIME,
ADD COLUMN IF NOT EXISTS origin_lat          DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS origin_lng          DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS dest_lat            DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS dest_lng            DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS payment_pending     BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS payment_error       TEXT,
ADD COLUMN IF NOT EXISTS surge_factor        NUMERIC DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS zone_multiplier     NUMERIC DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS user_factor         NUMERIC DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS price_locked_until  TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS route_distance_km   NUMERIC,
ADD COLUMN IF NOT EXISTS route_duration_min  NUMERIC,
ADD COLUMN IF NOT EXISTS route_polyline      TEXT,
ADD COLUMN IF NOT EXISTS traffic_factor      NUMERIC DEFAULT 1.0;

-- Popular lat/lng a partir de colunas geography (se existirem)
UPDATE public.rides
SET origin_lat = ST_Y(origin_geo::geometry),
    origin_lng = ST_X(origin_geo::geometry)
WHERE origin_geo IS NOT NULL AND origin_lat IS NULL;

UPDATE public.rides
SET dest_lat = ST_Y(dest_geo::geometry),
    dest_lng = ST_X(dest_geo::geometry)
WHERE dest_geo IS NOT NULL AND dest_lat IS NULL;


-- ---------------------------------------------------------------------
-- MIGRATION 2.5 — Tabela pricing_config (Engine Pro — PROTEGIDA)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pricing_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  config_name TEXT NOT NULL DEFAULT 'default',

  base_fare_kz        NUMERIC NOT NULL DEFAULT 300,   
  rate_per_km_kz      NUMERIC NOT NULL DEFAULT 182,   
  rate_per_min_kz     NUMERIC NOT NULL DEFAULT 15,    

  surge_alpha         NUMERIC NOT NULL DEFAULT 0.5,   
  surge_max           NUMERIC NOT NULL DEFAULT 2.5,   

  fee_night_kz        NUMERIC NOT NULL DEFAULT 200,
  fee_airport_kz      NUMERIC NOT NULL DEFAULT 500,
  fee_traffic_kz      NUMERIC NOT NULL DEFAULT 150,   
  fee_cancel_kz       NUMERIC NOT NULL DEFAULT 300,

  platform_commission NUMERIC NOT NULL DEFAULT 0.15,

  wl_talatona         NUMERIC NOT NULL DEFAULT 1.4,
  wl_miramar          NUMERIC NOT NULL DEFAULT 1.2,
  wl_alvalade         NUMERIC NOT NULL DEFAULT 1.2,
  wl_patriota         NUMERIC NOT NULL DEFAULT 1.4,
  wl_viana            NUMERIC NOT NULL DEFAULT 0.9,
  wl_cacuaco          NUMERIC NOT NULL DEFAULT 0.9,
  wl_default          NUMERIC NOT NULL DEFAULT 1.0,

  wl_premium          NUMERIC NOT NULL DEFAULT 1.8,
  wl_standard         NUMERIC NOT NULL DEFAULT 1.0,
  wl_eco              NUMERIC NOT NULL DEFAULT 0.8,

  u_vip               NUMERIC NOT NULL DEFAULT 0.85,
  u_new               NUMERIC NOT NULL DEFAULT 1.0,
  u_standard          NUMERIC NOT NULL DEFAULT 1.0,
  u_problematic       NUMERIC NOT NULL DEFAULT 1.3,

  traffic_threshold   NUMERIC NOT NULL DEFAULT 1.3,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_active  BOOLEAN DEFAULT TRUE
);

ALTER TABLE public.pricing_config ENABLE ROW LEVEL SECURITY;

-- Admins identificados pelo JWT metadata (não requer coluna 'role' na tabela profiles)
DROP POLICY IF EXISTS "only_admins_pricing" ON public.pricing_config;
CREATE POLICY "only_admins_pricing"
ON public.pricing_config FOR ALL
USING (
  (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  OR
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

INSERT INTO public.pricing_config (config_name) VALUES ('default')
ON CONFLICT DO NOTHING;


-- ---------------------------------------------------------------------
-- MIGRATION 2.6 — Função RPC do Engine Pro (cálculo PROTEGIDO)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_fare_engine_pro(
  p_distance_km       NUMERIC,
  p_duration_min      NUMERIC,
  p_origin_lat        DOUBLE PRECISION,
  p_origin_lng        DOUBLE PRECISION,
  p_dest_lat          DOUBLE PRECISION,
  p_dest_lng          DOUBLE PRECISION,
  p_service_tier      TEXT    DEFAULT 'standard',
  p_demand_count      INT     DEFAULT 5,
  p_supply_count      INT     DEFAULT 5,
  p_is_night          BOOLEAN DEFAULT FALSE,
  p_is_airport        BOOLEAN DEFAULT FALSE,
  p_traffic_factor    NUMERIC DEFAULT 1.0   
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cfg         public.pricing_config%ROWTYPE;
  B           NUMERIC;
  rd          NUMERIC;
  rt          NUMERIC;
  Wl          NUMERIC := 1.0;
  Wt          NUMERIC := 1.0;
  S           NUMERIC;
  C           NUMERIC := 1.0;
  U           NUMERIC := 1.0;
  F           NUMERIC := 0;
  fare_raw    NUMERIC;
  fare_final  NUMERIC;
  user_tier   TEXT;
  is_traffic  BOOLEAN;
  badges      TEXT[]  := '{}';
BEGIN
  SELECT * INTO cfg FROM public.pricing_config WHERE is_active = TRUE LIMIT 1;

  B  := cfg.base_fare_kz;
  rd := cfg.rate_per_km_kz;
  rt := cfg.rate_per_min_kz;

  is_traffic := p_traffic_factor > cfg.traffic_threshold;
  IF is_traffic THEN
    Wt := LEAST(p_traffic_factor, 1.5);
    badges := array_append(badges, 'Trânsito Intenso');
  END IF;

  IF  (p_origin_lat BETWEEN -9.05 AND -8.95 AND p_origin_lng BETWEEN 13.17 AND 13.27)
   OR (p_dest_lat   BETWEEN -9.05 AND -8.95 AND p_dest_lng   BETWEEN 13.17 AND 13.27) THEN
    Wl := cfg.wl_talatona;
    badges := array_append(badges, 'Zona Premium');
  ELSIF (p_origin_lat BETWEEN -8.85 AND -8.80 AND p_origin_lng BETWEEN 13.22 AND 13.28)
     OR (p_dest_lat   BETWEEN -8.85 AND -8.80 AND p_dest_lng   BETWEEN 13.22 AND 13.28) THEN
    Wl := cfg.wl_miramar;
    badges := array_append(badges, 'Zona Prestígio');
  ELSIF (p_origin_lat BETWEEN -8.95 AND -8.80 AND p_origin_lng BETWEEN 13.35 AND 13.55)
     OR (p_dest_lat   BETWEEN -8.95 AND -8.80 AND p_dest_lng   BETWEEN 13.35 AND 13.55) THEN
    Wl := cfg.wl_viana;
  END IF;

  C := CASE p_service_tier
    WHEN 'premium' THEN cfg.wl_premium
    WHEN 'eco'     THEN cfg.wl_eco
    ELSE                cfg.wl_standard
  END;

  SELECT profiles.user_tier INTO user_tier
  FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;

  U := CASE user_tier
    WHEN 'vip'         THEN cfg.u_vip
    WHEN 'problematic' THEN cfg.u_problematic
    ELSE                    cfg.u_standard
  END;

  IF user_tier = 'problematic' THEN
    badges := array_append(badges, 'Tarifa Ajustada');
  END IF;

  IF p_supply_count > 0 THEN
    S := LEAST(
      1.0 + cfg.surge_alpha * (p_demand_count::NUMERIC / p_supply_count::NUMERIC),
      cfg.surge_max
    );
  ELSE
    S := cfg.surge_max;
  END IF;

  IF S > 1.2 THEN
    badges := array_append(badges, 'Alta Procura ' || ROUND(S, 1)::TEXT || 'x');
  END IF;

  IF p_is_night   THEN F := F + cfg.fee_night_kz;   badges := array_append(badges, 'Tarifa Nocturna');   END IF;
  IF p_is_airport THEN F := F + cfg.fee_airport_kz; badges := array_append(badges, 'Serviço Aeroporto'); END IF;
  IF is_traffic   THEN F := F + cfg.fee_traffic_kz; END IF;

  fare_raw := B
    + (p_distance_km * rd * Wl)
    + (p_duration_min * rt * Wt) * S * C * U
    + F;

  fare_final := FLOOR(fare_raw / 100) * 100 + 99;
  IF fare_final < fare_raw THEN fare_final := fare_final + 100; END IF;
  fare_final := GREATEST(fare_final, B); 

  RETURN jsonb_build_object(
    'fare_kz',             fare_final,
    'fare_raw_kz',         ROUND(fare_raw, 2),
    'surge_factor',        ROUND(S, 2),
    'zone_multiplier',     Wl,
    'traffic_multiplier',  ROUND(Wt, 2),
    'user_factor',         U,
    'service_factor',      C,
    'extras_kz',           F,
    'is_traffic',          is_traffic,
    'badges',              badges,
    'price_locked_until',  NOW() + INTERVAL '2 minutes',
    'breakdown', jsonb_build_object(
      'base',     B,
      'distance', ROUND(p_distance_km * rd * Wl, 2),
      'time',     ROUND(p_duration_min * rt * Wt, 2),
      'surge',    ROUND(S, 2),
      'extras',   F
    )
  );
END;
$$;


-- ---------------------------------------------------------------------
-- MIGRATION 2.7 — Função atómica de aceitação de corrida
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_ride_atomic(
  p_ride_id   UUID,
  p_driver_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ride RECORD;
BEGIN
  SELECT * INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'ride_not_found');
  END IF;

  IF v_ride.status != 'searching' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'ride_not_searching');
  END IF;

  IF v_ride.driver_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_accepted');
  END IF;

  UPDATE public.rides
  SET driver_id   = p_driver_id,
      status      = 'accepted',
      accepted_at = NOW(),
      updated_at  = NOW()
  WHERE id = p_ride_id;

  UPDATE public.driver_locations
  SET status = 'on_trip', updated_at = NOW()
  WHERE driver_id = p_driver_id;

  RETURN jsonb_build_object('success', true, 'ride_id', p_ride_id);

EXCEPTION
  WHEN lock_not_available THEN
    RETURN jsonb_build_object('success', false, 'reason', 'race_condition_lost');
END;
$$;


-- ---------------------------------------------------------------------
-- MIGRATION 2.8 — Fix do trigger de pagamento
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_ride_payment_v3(
  p_ride_id UUID,
  p_amount  NUMERIC DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_amount NUMERIC;
BEGIN
  IF p_amount IS NULL THEN
    SELECT price_kz INTO v_amount FROM public.rides WHERE id = p_ride_id;
  ELSE
    v_amount := p_amount;
  END IF;

  IF v_amount IS NOT NULL AND v_amount > 0 THEN
    PERFORM public.process_ride_payment(p_ride_id, v_amount);
  END IF;

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING '[process_ride_payment_v3] ride=% erro=%', p_ride_id, SQLERRM;
    UPDATE public.rides
    SET payment_pending = TRUE, payment_error = SQLERRM
    WHERE id = p_ride_id;
END;
$$;


-- ---------------------------------------------------------------------
-- MIGRATION 2.9 — RLS para driver_bids
-- ---------------------------------------------------------------------
ALTER TABLE public.driver_bids ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "drivers_own_bids_only" ON public.driver_bids;
CREATE POLICY "drivers_own_bids_only"
ON public.driver_bids FOR INSERT
WITH CHECK (driver_id = auth.uid());

DROP POLICY IF EXISTS "drivers_read_own_bids" ON public.driver_bids;
CREATE POLICY "drivers_read_own_bids"
ON public.driver_bids FOR SELECT
USING (driver_id = auth.uid());


-- ---------------------------------------------------------------------
-- MIGRATION 2.10 — Áudio e Índices de Performance
-- ---------------------------------------------------------------------
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS audio_url TEXT;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rides_searching
ON public.rides(status, created_at DESC)
WHERE status = 'searching' AND driver_id IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rides_passenger
ON public.rides(passenger_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rides_driver
ON public.rides(driver_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_posts_created_at
ON public.posts(created_at DESC);


-- ---------------------------------------------------------------------
-- MIGRATION 2.11 — TTL automático (pg_cron)
-- ATENÇÃO: pode dar 'extensão não existe'. Ignorar o erro se der.
-- ---------------------------------------------------------------------
SELECT cron.schedule('cleanup-stale-drivers', '*/5 * * * *', $$
  UPDATE public.driver_locations
  SET status = 'offline'
  WHERE status = 'available'
    AND updated_at < NOW() - INTERVAL '10 minutes';
$$);

SELECT cron.schedule('cleanup-posts-24h', '0 * * * *', $$
  DELETE FROM public.posts WHERE created_at < NOW() - INTERVAL '24 hours';
$$);

SELECT cron.schedule('timeout-searching-rides', '*/3 * * * *', $$
  UPDATE public.rides
  SET status = 'cancelled', updated_at = NOW()
  WHERE status = 'searching'
    AND created_at < NOW() - INTERVAL '15 minutes';
$$);


-- ---------------------------------------------------------------------
-- MIGRATION 2.12 — Storage para Mensagens de Voz
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'voice-messages', 'voice-messages', true, 5242880,
  ARRAY['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "authenticated_upload_voice"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'voice-messages');

CREATE POLICY "public_read_voice"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'voice-messages');
