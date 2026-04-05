-- =============================================================================
-- MOTOGO AI v3.0 — schema_additions.sql (CORRIGIDO FINAL)
-- Executar DEPOIS de schema.sql no Supabase SQL Editor
-- =============================================================================

-- 1. CACHE DE GEOCODING
CREATE TABLE IF NOT EXISTS public.geocoding_cache (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  query_text   TEXT NOT NULL UNIQUE,
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  full_address TEXT,
  source       TEXT DEFAULT 'google',
  hit_count    INT NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_hit_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_geocoding_query ON public.geocoding_cache(query_text);
ALTER TABLE public.geocoding_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "geocoding: read all"   ON public.geocoding_cache FOR SELECT USING (true);
CREATE POLICY "geocoding: insert auth" ON public.geocoding_cache FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "geocoding: update service only" ON public.geocoding_cache FOR UPDATE USING (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION increment_geocode_hit(q TEXT)
RETURNS void AS $$
  UPDATE public.geocoding_cache
  SET hit_count = hit_count + 1, last_hit_at = NOW()
  WHERE query_text = q;
$$ LANGUAGE sql SECURITY DEFINER;

-- 2. AI RATE LIMIT
CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES public.users(id),
  action      TEXT NOT NULL,
  tokens_used INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_time ON public.ai_usage_logs(user_id, created_at DESC);

CREATE OR REPLACE VIEW public.ai_usage_last_hour AS
SELECT user_id, COUNT(*) AS request_count
FROM public.ai_usage_logs
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY user_id;

ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_logs: read own"       ON public.ai_usage_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "ai_logs: service insert" ON public.ai_usage_logs FOR INSERT WITH CHECK (auth.role() = 'service_role');

ALTER VIEW public.ai_usage_last_hour SET (security_invoker = true);

-- 3. DRIVER BIDS (Removido - Erro 47: Unused em frontend)
-- CREATE TABLE IF NOT EXISTS public.driver_bids (
--   id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
--   ride_id    UUID REFERENCES public.rides(id) ON DELETE CASCADE,
--   driver_id  UUID REFERENCES public.users(id),
--   status     TEXT DEFAULT 'pending',
--   created_at TIMESTAMPTZ DEFAULT NOW(),
--   UNIQUE(ride_id, driver_id)
-- );
-- ALTER TABLE public.driver_bids ENABLE ROW LEVEL SECURITY;

-- 4. ✅ FIX: find_drivers_for_auction retorna TODOS os campos que o frontend precisa
--    (avatar_url, total_rides, level, eta_min, heading além dos básicos)
CREATE OR REPLACE FUNCTION find_drivers_for_auction(
  p_lat       DOUBLE PRECISION,
  p_lng       DOUBLE PRECISION,
  p_radius_km DOUBLE PRECISION DEFAULT 8.0,
  p_limit     INT DEFAULT 8
)
RETURNS TABLE(
  driver_id   UUID,
  driver_name TEXT,
  avatar_url  TEXT,
  rating      NUMERIC,
  total_rides INT,
  level       TEXT,
  distance_m  DOUBLE PRECISION,
  eta_min     INT,
  heading     NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    dl.driver_id,
    pr.name                                                                          AS driver_name,
    pr.avatar_url,
    pr.rating,
    pr.total_rides,
    pr.level,
    ST_Distance(dl.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) AS distance_m,
    -- eta: distância a ~35 km/h médio em Luanda, arredondado para cima
    CEIL(ST_Distance(dl.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) / 583.0)::INT AS eta_min,
    dl.heading
  FROM public.driver_locations dl
  JOIN public.profiles pr ON pr.user_id = dl.driver_id
  WHERE dl.status = 'available'
    AND ST_DWithin(
      dl.location,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
      p_radius_km * 1000
    )
  ORDER BY
    (ST_Distance(dl.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) * 0.7)
    + ((5.0 - pr.rating) * 500 * 0.3)
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. ✅ FIX: cancel_ride_safe — usado pelo rideService.cancelRide
--    Suporta todos os estados, WITH FOR UPDATE lock, liberta motorista
CREATE OR REPLACE FUNCTION cancel_ride_safe(
  p_ride_id UUID,
  p_user_id UUID,
  p_reason  TEXT DEFAULT 'Cancelado'
)
RETURNS TABLE(success BOOLEAN, previous_status TEXT, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ride        public.rides%ROWTYPE;
  v_prev_status TEXT;
BEGIN
  -- Bloquear a linha para evitar race conditions
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found'::TEXT, 'Corrida não encontrada.'::TEXT;
    RETURN;
  END IF;

  v_prev_status := v_ride.status::TEXT;

  -- Só o passageiro ou motorista associado podem cancelar
  IF v_ride.passenger_id <> p_user_id AND (v_ride.driver_id IS NULL OR v_ride.driver_id <> p_user_id) THEN
    RETURN QUERY SELECT false, v_prev_status, 'Sem permissão para cancelar esta corrida.'::TEXT;
    RETURN;
  END IF;

  -- Não cancelar corridas já terminadas
  IF v_ride.status IN ('completed', 'cancelled') THEN
    RETURN QUERY SELECT false, v_prev_status, 'Corrida já terminada.'::TEXT;
    RETURN;
  END IF;

  -- Actualizar corrida
  UPDATE public.rides
  SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = p_reason
  WHERE id = p_ride_id;

  -- Libertar motorista se estava associado
  IF v_ride.driver_id IS NOT NULL THEN
    UPDATE public.driver_locations SET status = 'available', updated_at = NOW()
    WHERE driver_id = v_ride.driver_id;
  END IF;

  RETURN QUERY SELECT true, v_prev_status, 'Corrida cancelada com sucesso.'::TEXT;
END;
$$;

-- 6. ÍNDICES GEO
CREATE INDEX IF NOT EXISTS idx_driver_locations_geo    ON public.driver_locations USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_driver_locations_status ON public.driver_locations(status);

-- 7. TABELA DE PRIVACIDADE (VoIP Agora)
CREATE TABLE IF NOT EXISTS public.user_privacy (
  user_id              UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  allow_phone_exposure BOOLEAN DEFAULT false,
  allow_incoming_calls BOOLEAN DEFAULT true,
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.user_privacy ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_privacy' AND policyname = 'users manage own privacy'
  ) THEN
    CREATE POLICY "users manage own privacy" ON public.user_privacy
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Inserir linha padrão quando utilizador é criado
CREATE OR REPLACE FUNCTION handle_new_user_privacy()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.user_privacy (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_privacy ON auth.users;
CREATE TRIGGER on_auth_user_created_privacy
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE handle_new_user_privacy();

-- 8. IP RATE LIMITS
CREATE TABLE IF NOT EXISTS public.ip_rate_limits (
  ip_hash       TEXT        NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL DEFAULT date_trunc('minute', NOW()),
  request_count INT         NOT NULL DEFAULT 1,
  PRIMARY KEY (ip_hash, window_start)
);
CREATE INDEX IF NOT EXISTS idx_ip_rate_limits_window ON public.ip_rate_limits(window_start);
ALTER TABLE public.ip_rate_limits ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- PATCH 01 — driver_bids: políticas RLS (portadas do zenith patch_01_security.sql)
-- A tabela existia mas sem políticas → INSERT de motoristas falhava silenciosamente
-- =============================================================================

-- -- Motorista pode ver os seus próprios bids
-- CREATE POLICY "driver_bids: motorista vê próprios"
-- ON public.driver_bids FOR SELECT
-- USING (auth.uid() = driver_id);

-- -- Passageiro vê bids da sua corrida
-- CREATE POLICY "driver_bids: passageiro vê corrida"
-- ON public.driver_bids FOR SELECT
-- USING (
--   EXISTS (
--     SELECT 1 FROM public.rides
--     WHERE rides.id = driver_bids.ride_id
--       AND rides.passenger_id = auth.uid()
--   )
-- );

-- -- Motorista pode criar bid (apenas uma por corrida — UNIQUE já existe)
-- CREATE POLICY "driver_bids: motorista cria"
-- ON public.driver_bids FOR INSERT
-- WITH CHECK (
--   auth.uid() = driver_id
--   AND EXISTS (
--     SELECT 1 FROM public.rides
--     WHERE rides.id = ride_id
--       AND rides.status = 'searching'
--   )
-- );

-- -- Motorista pode atualizar o seu próprio bid (ex: accepted → declined)
-- CREATE POLICY "driver_bids: motorista atualiza próprio"
-- ON public.driver_bids FOR UPDATE
-- USING (auth.uid() = driver_id);

-- -- Passageiro pode eliminar bids da sua corrida (ex: ao cancelar corrida)
-- CREATE POLICY "driver_bids: passageiro elimina"
-- ON public.driver_bids FOR DELETE
-- USING (
--   EXISTS (
--     SELECT 1 FROM public.rides
--     WHERE rides.id = driver_bids.ride_id
--       AND rides.passenger_id = auth.uid()
--   )
-- );

-- =============================================================================
-- FIM
-- =============================================================================
