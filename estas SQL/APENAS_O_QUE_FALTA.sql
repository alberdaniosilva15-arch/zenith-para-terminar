-- =====================================================================
-- ZENITH RIDE v3.0 — APENAS O QUE FALTA
-- Corre estes blocos NO SUPABASE SQL EDITOR, um de cada vez.
-- Tudo aqui é NOVO face ao teu schema actual — sem duplicações.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- BLOCO 1 — Novas colunas em 'profiles'
-- (user_tier, last_known_lat, last_known_lng — não existem no teu schema)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS user_tier       TEXT  DEFAULT 'standard'
    CHECK (user_tier IN ('new', 'standard', 'vip', 'problematic')),
  ADD COLUMN IF NOT EXISTS last_known_lat  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_known_lng  DOUBLE PRECISION;

COMMENT ON COLUMN public.profiles.user_tier      IS 'Tier do passageiro para o Engine Pro de preços';
COMMENT ON COLUMN public.profiles.last_known_lat IS 'Última latitude conhecida (usada nos contratos)';
COMMENT ON COLUMN public.profiles.last_known_lng IS 'Última longitude conhecida (usada nos contratos)';


-- ─────────────────────────────────────────────────────────────────────
-- BLOCO 2 — Novas colunas em 'rides'
-- (colunas de Engine Pro e contratos — não existem no teu schema)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS contract_id        UUID REFERENCES public.contracts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scheduled_time     TIME,
  ADD COLUMN IF NOT EXISTS surge_factor       NUMERIC DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS zone_multiplier    NUMERIC DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS user_factor        NUMERIC DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS price_locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS route_distance_km  NUMERIC,
  ADD COLUMN IF NOT EXISTS route_duration_min NUMERIC,
  ADD COLUMN IF NOT EXISTS route_polyline     TEXT,
  ADD COLUMN IF NOT EXISTS traffic_factor     NUMERIC DEFAULT 1.0;


-- ─────────────────────────────────────────────────────────────────────
-- BLOCO 3 — Nova coluna em 'posts'
-- (audio_url para o RideTalk — não existe no teu schema)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS audio_url TEXT;


-- ─────────────────────────────────────────────────────────────────────
-- BLOCO 4 — Nova tabela pricing_config
-- (Protege a fórmula do Engine Pro no servidor)
-- ─────────────────────────────────────────────────────────────────────
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

DROP POLICY IF EXISTS "only_admins_pricing" ON public.pricing_config;
CREATE POLICY "only_admins_pricing"
ON public.pricing_config FOR ALL
USING (public.is_admin());

-- Inserir configuração padrão
INSERT INTO public.pricing_config (config_name) VALUES ('default')
ON CONFLICT DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────
-- BLOCO 5 — Função calculate_fare_engine_pro (RPC protegido)
-- (A fórmula de preços — NUNCA deve estar no frontend)
-- ─────────────────────────────────────────────────────────────────────
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
SET search_path = public
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
  v_user_tier TEXT;
  is_traffic  BOOLEAN;
  badges      TEXT[]  := '{}';
BEGIN
  SELECT * INTO cfg FROM public.pricing_config WHERE is_active = TRUE LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configuração de preços não encontrada. Contacte o suporte.';
  END IF;

  B  := cfg.base_fare_kz;
  rd := cfg.rate_per_km_kz;
  rt := cfg.rate_per_min_kz;

  is_traffic := p_traffic_factor > cfg.traffic_threshold;
  IF is_traffic THEN
    Wt := LEAST(p_traffic_factor, 1.5);
    badges := array_append(badges, 'Trânsito Intenso');
  END IF;

  -- Zonas de Luanda
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

  -- Tier do utilizador para factor de preço
  SELECT profiles.user_tier INTO v_user_tier
  FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;

  U := CASE v_user_tier
    WHEN 'vip'         THEN cfg.u_vip
    WHEN 'problematic' THEN cfg.u_problematic
    ELSE                    cfg.u_standard
  END;

  IF v_user_tier = 'problematic' THEN
    badges := array_append(badges, 'Tarifa Ajustada');
  END IF;

  -- Surge (alta procura)
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

  fare_raw   := B + (p_distance_km * rd * Wl) + (p_duration_min * rt * Wt) * S * C * U + F;
  fare_final := CEIL(fare_raw / 100.0) * 100;
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


-- ─────────────────────────────────────────────────────────────────────
-- BLOCO 6 — Função accept_ride_atomic
-- (Previne que 2 motoristas aceitem a mesma corrida ao mesmo tempo)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accept_ride_atomic(
  p_ride_id   UUID,
  p_driver_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  SET status = 'busy', updated_at = NOW()
  WHERE driver_id = p_driver_id;

  RETURN jsonb_build_object('success', true, 'ride_id', p_ride_id);

EXCEPTION
  WHEN lock_not_available THEN
    RETURN jsonb_build_object('success', false, 'reason', 'race_condition_lost');
END;
$$;


-- ─────────────────────────────────────────────────────────────────────
-- BLOCO 7 — Função get_active_ride (usada pelo frontend)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_active_ride(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ride RECORD;
  v_driver_name TEXT;
  v_passenger_name TEXT;
BEGIN
  SELECT r.* INTO v_ride
  FROM public.rides r
  WHERE (r.passenger_id = p_user_id OR r.driver_id = p_user_id)
    AND r.status NOT IN ('completed', 'cancelled')
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT name INTO v_driver_name
  FROM public.profiles WHERE user_id = v_ride.driver_id;

  SELECT name INTO v_passenger_name
  FROM public.profiles WHERE user_id = v_ride.passenger_id;

  RETURN to_jsonb(v_ride) ||
    jsonb_build_object(
      'driver_name',    v_driver_name,
      'passenger_name', v_passenger_name
    );
END;
$$;


-- ─────────────────────────────────────────────────────────────────────
-- BLOCO 8 — Índices de performance
-- (SEM CONCURRENTLY — funciona dentro de transacção)
-- ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rides_searching_v2
ON public.rides(status, created_at DESC)
WHERE status = 'searching' AND driver_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_rides_contract
ON public.rides(contract_id)
WHERE contract_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_user_tier
ON public.profiles(user_tier);

CREATE INDEX IF NOT EXISTS idx_posts_audio
ON public.posts(created_at DESC)
WHERE audio_url IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────
-- BLOCO 9 — Storage para mensagens de voz (RideTalk)
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'voice-messages',
  'voice-messages',
  true,
  5242880,
  ARRAY['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "authenticated_upload_voice" ON storage.objects;
CREATE POLICY "authenticated_upload_voice"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'voice-messages');

DROP POLICY IF EXISTS "public_read_voice" ON storage.objects;
CREATE POLICY "public_read_voice"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'voice-messages');


-- ─────────────────────────────────────────────────────────────────────
-- BLOCO 10 — Jobs automáticos (pg_cron)
-- ATENÇÃO: Se der erro "extensão não existe", podes ignorar este bloco.
-- Vai ao Supabase Dashboard → Database → Extensions → activar pg_cron
-- ─────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'timeout-searching-rides',
  '*/3 * * * *',
  $$
    UPDATE public.rides
    SET status = 'cancelled', updated_at = NOW()
    WHERE status = 'searching'
      AND created_at < NOW() - INTERVAL '15 minutes';
  $$
);

SELECT cron.schedule(
  'cleanup-stale-drivers',
  '*/10 * * * *',
  $$
    UPDATE public.driver_locations
    SET status = 'offline'
    WHERE status = 'available'
      AND updated_at < NOW() - INTERVAL '10 minutes';
  $$
);


-- ─────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO FINAL — confirmar o que foi criado
-- ─────────────────────────────────────────────────────────────────────
SELECT
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'calculate_fare_engine_pro',
    'accept_ride_atomic',
    'get_active_ride'
  )
ORDER BY routine_name;
