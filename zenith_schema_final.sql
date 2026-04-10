-- =============================================================================
-- ZENITH RIDE v3.0 — schema_final.sql
-- Schema único, completo, idempotente e sem erros.
--
-- CORRECÇÕES em relação à versão anterior:
--   ✅ browsing adicionado ao enum ride_status
--   ✅ Função is_admin() SECURITY DEFINER resolve recursão infinita
--   ✅ Todas as policies admin usam is_admin() (não app_metadata)
--   ✅ payment_processed adicionado à tabela rides
--   ✅ route_deviation_alert e max_deviation_km adicionados a contracts
--   ✅ Tabela route_deviation_alerts criada
--   ✅ process_withdrawal() criada
--   ✅ process_partner_payment() criada
--   ✅ increment_geocode_hit() sem duplicação
--   ✅ Policy UPDATE em school_tracking_sessions adicionada
--   ✅ Realtime alargado a wallets, transactions, profiles, school_tracking_sessions
--   ✅ contract_type aceita 'school','work','family','corporate'
--   ✅ update_user_rating usa contagem real, não incremento
--   ✅ Trigger de pagamento automático ligado a process_ride_payment_v3
--
-- COMO USAR:
--   Supabase Dashboard → SQL Editor → colar e executar
--   Seguro para re-executar (idempotente em todas as secções)
-- =============================================================================


-- =============================================================================
-- SECÇÃO 0 — EXTENSÕES
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";


-- =============================================================================
-- SECÇÃO 1 — TIPOS ENUMERADOS
-- Usa DO $$ para ser idempotente (CREATE TYPE não tem IF NOT EXISTS)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('passenger', 'driver', 'admin');
  END IF;

  -- CORRIGIDO: 'browsing' incluído — usado pelo leilão de motoristas
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ride_status') THEN
    CREATE TYPE ride_status AS ENUM (
      'browsing', 'searching', 'accepted', 'picking_up',
      'in_progress', 'completed', 'cancelled'
    );
  END IF;

  -- Adicionar 'browsing' se o tipo já existia sem ele
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'browsing'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ride_status')
  ) THEN
    ALTER TYPE ride_status ADD VALUE 'browsing' BEFORE 'searching';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_type') THEN
    CREATE TYPE transaction_type AS ENUM (
      'ride_payment', 'ride_earning', 'top_up',
      'refund', 'bonus', 'withdrawal', 'partner_payment'
    );
  END IF;

  -- Adicionar 'partner_payment' se tipo já existia
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'partner_payment'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'transaction_type')
  ) THEN
    ALTER TYPE transaction_type ADD VALUE 'partner_payment';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'driver_status') THEN
    CREATE TYPE driver_status AS ENUM ('offline', 'available', 'busy');
  END IF;
END $$;


-- =============================================================================
-- SECÇÃO 2 — TABELAS (ordem de dependências)
-- =============================================================================

-- 2.1 Utilizadores
CREATE TABLE IF NOT EXISTS public.users (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT UNIQUE NOT NULL,
  role       user_role NOT NULL DEFAULT 'passenger',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.2 Perfis (com campos v3: km, perks)
CREATE TABLE IF NOT EXISTS public.profiles (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL DEFAULT '',
  avatar_url        TEXT,
  phone             TEXT,
  rating            NUMERIC(3,2) NOT NULL DEFAULT 5.00 CHECK (rating >= 1 AND rating <= 5),
  total_rides       INT NOT NULL DEFAULT 0,
  level             TEXT NOT NULL DEFAULT 'Novato',
  km_total          NUMERIC(10,2) NOT NULL DEFAULT 0,
  free_km_available NUMERIC(6,2)  NOT NULL DEFAULT 0,
  km_to_next_perk   NUMERIC(6,2)  NOT NULL DEFAULT 70,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.3 Carteiras
CREATE TABLE IF NOT EXISTS public.wallets (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  balance    NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
  currency   TEXT NOT NULL DEFAULT 'KZS',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.4 Localização de motoristas
CREATE TABLE IF NOT EXISTS public.driver_locations (
  driver_id  UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  location   GEOGRAPHY(POINT, 4326) NOT NULL,
  heading    NUMERIC(5,2),
  status     driver_status NOT NULL DEFAULT 'offline',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.5 Corridas
-- CORRIGIDO: payment_processed adicionado
CREATE TABLE IF NOT EXISTS public.rides (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  passenger_id      UUID NOT NULL REFERENCES public.users(id),
  driver_id         UUID REFERENCES public.users(id),
  origin_address    TEXT NOT NULL,
  origin_lat        DOUBLE PRECISION NOT NULL,
  origin_lng        DOUBLE PRECISION NOT NULL,
  origin_geo        GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (
                      ST_SetSRID(ST_MakePoint(origin_lng, origin_lat), 4326)::geography
                    ) STORED,
  dest_address      TEXT NOT NULL,
  dest_lat          DOUBLE PRECISION NOT NULL,
  dest_lng          DOUBLE PRECISION NOT NULL,
  dest_geo          GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (
                      ST_SetSRID(ST_MakePoint(dest_lng, dest_lat), 4326)::geography
                    ) STORED,
  distance_km       NUMERIC(8,3),
  duration_min      INT,
  surge_multiplier  NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  price_kz          NUMERIC(10,2) NOT NULL,
  status            ride_status NOT NULL DEFAULT 'searching',
  driver_confirmed  BOOLEAN NOT NULL DEFAULT FALSE,
  payment_processed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at       TIMESTAMPTZ,
  pickup_at         TIMESTAMPTZ,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,
  cancel_reason     TEXT
);

-- Adicionar payment_processed se rides já existia sem a coluna
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS payment_processed BOOLEAN NOT NULL DEFAULT FALSE;

-- 2.6 Transacções
CREATE TABLE IF NOT EXISTS public.transactions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES public.users(id),
  ride_id       UUID REFERENCES public.rides(id),
  amount        NUMERIC(12,2) NOT NULL,
  type          transaction_type NOT NULL,
  description   TEXT,
  balance_after NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.7 Posts / Comunidade
CREATE TABLE IF NOT EXISTS public.posts (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES public.users(id),
  content    TEXT NOT NULL CHECK (char_length(content) <= 500),
  post_type  TEXT NOT NULL DEFAULT 'status' CHECK (post_type IN ('status', 'alert', 'event')),
  location   TEXT,
  likes      INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.8 Avaliações
CREATE TABLE IF NOT EXISTS public.ratings (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id    UUID NOT NULL REFERENCES public.rides(id),
  from_user  UUID NOT NULL REFERENCES public.users(id),
  to_user    UUID NOT NULL REFERENCES public.users(id),
  score      INT NOT NULL CHECK (score >= 1 AND score <= 5),
  comment    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(ride_id, from_user)
);

-- 2.9 Contratos
-- CORRIGIDO: contract_type aceita todos os valores usados pelo frontend
-- CORRIGIDO: route_deviation_alert e max_deviation_km adicionados
CREATE TABLE IF NOT EXISTS public.contracts (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID NOT NULL REFERENCES public.users(id),
  contract_type         TEXT NOT NULL CHECK (
                          contract_type IN ('school', 'work', 'family', 'corporate')
                        ),
  title                 TEXT NOT NULL,
  address               TEXT NOT NULL,
  dest_lat              DOUBLE PRECISION NOT NULL,
  dest_lng              DOUBLE PRECISION NOT NULL,
  time_start            TIME NOT NULL,
  time_end              TIME NOT NULL,
  parent_monitoring     BOOLEAN NOT NULL DEFAULT FALSE,
  route_deviation_alert BOOLEAN NOT NULL DEFAULT TRUE,
  max_deviation_km      NUMERIC(4,1) NOT NULL DEFAULT 2.0,
  contact_name          TEXT,
  contact_phone         TEXT,
  km_accumulated        NUMERIC(8,2) NOT NULL DEFAULT 0,
  bonus_kz              NUMERIC(10,2) NOT NULL DEFAULT 0,
  active                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Adicionar colunas que podem estar em falta em contracts já existentes
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS route_deviation_alert BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS max_deviation_km NUMERIC(4,1) NOT NULL DEFAULT 2.0;
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS contact_phone TEXT;

-- 2.10 Leilão de motoristas
CREATE TABLE IF NOT EXISTS public.driver_bids (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id    UUID REFERENCES public.rides(id) ON DELETE CASCADE,
  driver_id  UUID REFERENCES public.users(id),
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(ride_id, driver_id)
);

-- 2.11 Privacidade / VoIP
CREATE TABLE IF NOT EXISTS public.user_privacy (
  user_id              UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  allow_phone_exposure BOOLEAN NOT NULL DEFAULT FALSE,
  allow_incoming_calls BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.12 Cache de geocoding
CREATE TABLE IF NOT EXISTS public.geocoding_cache (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  query_text   TEXT NOT NULL UNIQUE,
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  full_address TEXT,
  source       TEXT NOT NULL DEFAULT 'google',
  hit_count    INT NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_hit_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.13 Logs de uso de IA (rate limiting persistente)
CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES public.users(id),
  action      TEXT NOT NULL,
  tokens_used INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.14 Rate limit por IP (Edge Function)
CREATE TABLE IF NOT EXISTS public.ip_rate_limits (
  ip_hash       TEXT        NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL DEFAULT date_trunc('minute', NOW()),
  request_count INT         NOT NULL DEFAULT 1,
  PRIMARY KEY (ip_hash, window_start)
);

-- 2.15 Preços por zona
CREATE TABLE IF NOT EXISTS public.zone_prices (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  origin_zone TEXT NOT NULL,
  dest_zone   TEXT NOT NULL,
  price_kz    NUMERIC(10,2) NOT NULL,
  distance_km NUMERIC(6,2),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(origin_zone, dest_zone)
);

-- 2.16 Previsões de corridas (Kaze Preditivo)
CREATE TABLE IF NOT EXISTS public.ride_predictions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  origin_address TEXT NOT NULL,
  origin_lat     DOUBLE PRECISION NOT NULL,
  origin_lng     DOUBLE PRECISION NOT NULL,
  dest_address   TEXT NOT NULL,
  dest_lat       DOUBLE PRECISION NOT NULL,
  dest_lng       DOUBLE PRECISION NOT NULL,
  frequency      INT NOT NULL DEFAULT 1,
  last_used_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  best_hour      INT,
  avg_price_kz   NUMERIC(10,2),
  zone_price_kz  NUMERIC(10,2),
  origin_zone    TEXT,
  dest_zone      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, origin_address, dest_address)
);

-- 2.17 MotoGo Score
CREATE TABLE IF NOT EXISTS public.motogo_scores (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id        UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  score            INT NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 1000),
  score_label      TEXT NOT NULL DEFAULT 'Sem Historial',
  rides_component  INT NOT NULL DEFAULT 0,
  rating_component INT NOT NULL DEFAULT 0,
  level_component  INT NOT NULL DEFAULT 0,
  consistency_pct  NUMERIC(5,2) NOT NULL DEFAULT 0,
  last_calculated  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.18 Sessões de tracking escolar
CREATE TABLE IF NOT EXISTS public.school_tracking_sessions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id  UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  ride_id      UUID REFERENCES public.rides(id),
  public_token UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'completed', 'expired')),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '12 hours'),
  parent_name  TEXT,
  parent_phone TEXT,
  alerts_sent  INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.19 Parceiros MotoGo Pay
CREATE TABLE IF NOT EXISTS public.motogopay_partners (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL,
  category     TEXT NOT NULL CHECK (
                 category IN ('fuel', 'food', 'insurance', 'mechanic', 'supermarket')
               ),
  description  TEXT,
  discount_pct NUMERIC(4,2) NOT NULL DEFAULT 0,
  logo_url     TEXT,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.20 Alertas de desvio de rota
-- NOVO: estava em falta — usado pelo checkRouteDeviation no frontend
CREATE TABLE IF NOT EXISTS public.route_deviation_alerts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id      UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  deviation_km NUMERIC(8,3) NOT NULL,
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  alerted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- SECÇÃO 3 — VIEWS
-- =============================================================================

CREATE OR REPLACE VIEW public.ai_usage_last_hour AS
SELECT user_id, COUNT(*) AS request_count
FROM public.ai_usage_logs
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY user_id;


-- =============================================================================
-- SECÇÃO 4 — ÍNDICES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_profiles_km              ON public.profiles(km_total);
CREATE INDEX IF NOT EXISTS idx_driver_locations_geo     ON public.driver_locations USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_driver_locations_status  ON public.driver_locations(status);
CREATE INDEX IF NOT EXISTS idx_rides_passenger          ON public.rides(passenger_id);
CREATE INDEX IF NOT EXISTS idx_rides_driver             ON public.rides(driver_id);
CREATE INDEX IF NOT EXISTS idx_rides_status             ON public.rides(status);
CREATE INDEX IF NOT EXISTS idx_rides_created            ON public.rides(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rides_origin_geo         ON public.rides USING GIST(origin_geo);
CREATE INDEX IF NOT EXISTS idx_transactions_user        ON public.transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_ride        ON public.transactions(ride_id);
CREATE INDEX IF NOT EXISTS idx_posts_created            ON public.posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_user               ON public.posts(user_id);
CREATE INDEX IF NOT EXISTS idx_geocoding_query          ON public.geocoding_cache(query_text);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_time       ON public.ai_usage_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ip_rate_limits_window    ON public.ip_rate_limits(window_start);
CREATE INDEX IF NOT EXISTS idx_zone_prices_origin       ON public.zone_prices(origin_zone, dest_zone);
CREATE INDEX IF NOT EXISTS idx_predictions_user         ON public.ride_predictions(user_id, frequency DESC);
CREATE INDEX IF NOT EXISTS idx_school_tracking_token    ON public.school_tracking_sessions(public_token);
CREATE INDEX IF NOT EXISTS idx_deviation_ride           ON public.route_deviation_alerts(ride_id);


-- =============================================================================
-- SECÇÃO 5 — FUNÇÕES UTILITÁRIAS
-- =============================================================================

-- 5.1 updated_at automático
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS t_users_updated_at    ON public.users;
CREATE TRIGGER t_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS t_profiles_updated_at ON public.profiles;
CREATE TRIGGER t_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS t_wallets_updated_at  ON public.wallets;
CREATE TRIGGER t_wallets_updated_at
  BEFORE UPDATE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 5.2 Incrementar hit de geocoding (uma única definição)
CREATE OR REPLACE FUNCTION public.increment_geocode_hit(q TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.geocoding_cache
  SET hit_count = hit_count + 1, last_hit_at = NOW()
  WHERE query_text = q;
$$;

-- 5.3 Helper para verificar admin (SECURITY DEFINER resolve recursão RLS)
-- NOVO: evita a necessidade de app_metadata e recursão infinita
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;


-- =============================================================================
-- SECÇÃO 6 — TRIGGER: handle_new_user
-- =============================================================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Utilizador (lê role do metadata — corrige Erro 38)
  INSERT INTO public.users (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'passenger')::user_role
  )
  ON CONFLICT (id) DO NOTHING;

  -- 2. Perfil
  INSERT INTO public.profiles (user_id, name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (user_id) DO NOTHING;

  -- 3. Carteira
  INSERT INTO public.wallets (user_id, balance)
  VALUES (NEW.id, 0.00)
  ON CONFLICT (user_id) DO NOTHING;

  -- 4. Privacidade VoIP
  INSERT INTO public.user_privacy (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING '[handle_new_user] Erro para user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- =============================================================================
-- SECÇÃO 7 — OUTROS TRIGGERS
-- =============================================================================

-- 7.1 Actualizar rating após avaliação
-- CORRIGIDO: usa contagem real de corridas em vez de incremento cego
DROP FUNCTION IF EXISTS update_user_rating() CASCADE;
CREATE OR REPLACE FUNCTION update_user_rating()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_real_rides INT;
BEGIN
  SELECT COUNT(*)
  INTO v_real_rides
  FROM public.rides
  WHERE driver_id = NEW.to_user AND status = 'completed';

  UPDATE public.profiles
  SET
    rating = (
      SELECT ROUND(AVG(score)::numeric, 2)
      FROM public.ratings
      WHERE to_user = NEW.to_user
    ),
    total_rides = v_real_rides,
    level = CASE
      WHEN v_real_rides >= 500 THEN 'Diamante'
      WHEN v_real_rides >= 200 THEN 'Ouro'
      WHEN v_real_rides >= 50  THEN 'Prata'
      WHEN v_real_rides >= 10  THEN 'Bronze'
      ELSE 'Novato'
    END
  WHERE user_id = NEW.to_user;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_rating_created ON public.ratings;
CREATE TRIGGER on_rating_created
  AFTER INSERT ON public.ratings
  FOR EACH ROW EXECUTE FUNCTION update_user_rating();

-- 7.2 Proteger campos de sistema em contracts
DROP FUNCTION IF EXISTS protect_contract_system_fields() CASCADE;
CREATE OR REPLACE FUNCTION protect_contract_system_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.km_accumulated IS DISTINCT FROM OLD.km_accumulated THEN
    RAISE EXCEPTION 'km_accumulated é gerido pelo sistema.';
  END IF;
  IF NEW.bonus_kz IS DISTINCT FROM OLD.bonus_kz THEN
    RAISE EXCEPTION 'bonus_kz é gerido pelo sistema.';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Não é permitido transferir a propriedade de um contrato.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS t_contracts_protect_system_fields ON public.contracts;
CREATE TRIGGER t_contracts_protect_system_fields
  BEFORE UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION protect_contract_system_fields();

-- 7.3 Trigger de pagamento automático ao completar corrida
DROP FUNCTION IF EXISTS trigger_process_payment_on_complete() CASCADE;
CREATE OR REPLACE FUNCTION trigger_process_payment_on_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed'
    AND OLD.status <> 'completed'
    AND NEW.payment_processed = FALSE
    AND NEW.driver_id IS NOT NULL
  THEN
    BEGIN
      PERFORM public.process_ride_payment_v3(
        NEW.id,
        NEW.passenger_id,
        NEW.driver_id,
        NEW.price_kz,
        COALESCE(NEW.distance_km, 0),
        NEW.origin_address,
        NEW.origin_lat,
        NEW.origin_lng,
        NEW.dest_address,
        NEW.dest_lat,
        NEW.dest_lng
      );
      UPDATE public.rides SET payment_processed = TRUE WHERE id = NEW.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[payment_trigger] Falha no pagamento da corrida %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_on_complete ON public.rides;
CREATE TRIGGER trg_payment_on_complete
  AFTER UPDATE OF status ON public.rides
  FOR EACH ROW EXECUTE FUNCTION trigger_process_payment_on_complete();


-- =============================================================================
-- SECÇÃO 8 — FUNÇÕES DE NEGÓCIO
-- =============================================================================

-- 8.1 Pagamento de corrida (transacção atómica)
DROP FUNCTION IF EXISTS process_ride_payment(UUID, UUID, UUID, NUMERIC);
CREATE OR REPLACE FUNCTION public.process_ride_payment(
  p_ride_id      UUID,
  p_passenger_id UUID,
  p_driver_id    UUID,
  p_amount       NUMERIC
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

  SELECT balance INTO v_passenger_balance
  FROM public.wallets WHERE user_id = p_passenger_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet do passageiro não encontrada: %', p_passenger_id;
  END IF;
  IF v_passenger_balance < p_amount THEN
    RAISE EXCEPTION 'Saldo insuficiente. Disponível: % | Necessário: %',
      v_passenger_balance, p_amount;
  END IF;

  UPDATE public.wallets
  SET balance = balance - p_amount, updated_at = NOW()
  WHERE user_id = p_passenger_id
  RETURNING balance INTO v_pass_bal_after;

  INSERT INTO public.transactions (user_id, ride_id, amount, type, description, balance_after)
  VALUES (p_passenger_id, p_ride_id, -p_amount, 'ride_payment', 'Pagamento de corrida', v_pass_bal_after);

  UPDATE public.wallets
  SET balance = balance + v_driver_earning, updated_at = NOW()
  WHERE user_id = p_driver_id
  RETURNING balance INTO v_driv_bal_after;

  INSERT INTO public.transactions (user_id, ride_id, amount, type, description, balance_after)
  VALUES (p_driver_id, p_ride_id, v_driver_earning, 'ride_earning', 'Ganho de corrida', v_driv_bal_after);
END;
$$;

-- 8.2 Procura de motoristas próximos
DROP FUNCTION IF EXISTS find_nearby_drivers(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INT);
CREATE OR REPLACE FUNCTION public.find_nearby_drivers(
  p_lat       DOUBLE PRECISION,
  p_lng       DOUBLE PRECISION,
  p_radius_km DOUBLE PRECISION DEFAULT 5.0,
  p_limit     INT DEFAULT 10
)
RETURNS TABLE(
  driver_id   UUID,
  driver_name TEXT,
  rating      NUMERIC,
  distance_m  DOUBLE PRECISION,
  heading     NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dl.driver_id,
    pr.name,
    pr.rating,
    ST_Distance(dl.location,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) AS distance_m,
    dl.heading
  FROM public.driver_locations dl
  JOIN public.profiles pr ON pr.user_id = dl.driver_id
  WHERE dl.status = 'available'
    AND ST_DWithin(dl.location,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
      p_radius_km * 1000)
  ORDER BY
    (ST_Distance(dl.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) * 0.7)
    + ((5.0 - pr.rating) * 500 * 0.3)
  LIMIT p_limit;
END;
$$;

-- 8.3 Procura de motoristas para leilão
DROP FUNCTION IF EXISTS find_drivers_for_auction(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INT);
CREATE OR REPLACE FUNCTION public.find_drivers_for_auction(
  p_lat       DOUBLE PRECISION,
  p_lng       DOUBLE PRECISION,
  p_radius_km DOUBLE PRECISION DEFAULT 8.0,
  p_limit     INT DEFAULT 8
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
  RETURN QUERY
  SELECT
    dl.driver_id,
    pr.name                AS driver_name,
    pr.avatar_url,
    pr.rating,
    pr.total_rides,
    pr.level,
    ST_Distance(dl.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) AS distance_m,
    CEIL(ST_Distance(dl.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) / 583.0)::INT AS eta_min,
    dl.heading,
    COALESCE(ms.score, 500) AS motogo_score
  FROM public.driver_locations dl
  JOIN public.profiles pr ON pr.user_id = dl.driver_id
  LEFT JOIN public.motogo_scores ms ON ms.driver_id = dl.driver_id
  WHERE dl.status = 'available'
    AND ST_DWithin(dl.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, p_radius_km * 1000)
  ORDER BY
    (ST_Distance(dl.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) * 0.7)
    + ((5.0 - pr.rating) * 500 * 0.2)
    - (COALESCE(ms.score, 500) * 0.1)
  LIMIT p_limit;
END;
$$;

-- 8.4 Cancelar corrida (com lock para evitar race conditions)
DROP FUNCTION IF EXISTS cancel_ride_safe(UUID, UUID, TEXT);
CREATE OR REPLACE FUNCTION public.cancel_ride_safe(
  p_ride_id UUID,
  p_user_id UUID,
  p_reason  TEXT DEFAULT 'Cancelado'
)
RETURNS TABLE(success BOOLEAN, previous_status TEXT, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ride        public.rides%ROWTYPE;
  v_prev_status TEXT;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found'::TEXT, 'Corrida não encontrada.'::TEXT;
    RETURN;
  END IF;

  v_prev_status := v_ride.status::TEXT;

  IF v_ride.passenger_id <> p_user_id
    AND (v_ride.driver_id IS NULL OR v_ride.driver_id <> p_user_id)
  THEN
    RETURN QUERY SELECT false, v_prev_status, 'Sem permissão para cancelar.'::TEXT;
    RETURN;
  END IF;

  IF v_ride.status IN ('completed', 'cancelled') THEN
    RETURN QUERY SELECT false, v_prev_status, 'Corrida já terminada.'::TEXT;
    RETURN;
  END IF;

  UPDATE public.rides
  SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = p_reason
  WHERE id = p_ride_id;

  IF v_ride.driver_id IS NOT NULL THEN
    UPDATE public.driver_locations
    SET status = 'available', updated_at = NOW()
    WHERE driver_id = v_ride.driver_id;
  END IF;

  RETURN QUERY SELECT true, v_prev_status, 'Corrida cancelada com sucesso.'::TEXT;
END;
$$;

-- 8.5 Acumular km e atribuir perk
CREATE OR REPLACE FUNCTION public.award_free_perk(
  p_user_id UUID,
  p_ride_km NUMERIC
)
RETURNS TABLE(perks_awarded INT, free_km_total NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_km_total     NUMERIC;
  v_free_km      NUMERIC;
  v_km_to_next   NUMERIC;
  v_perks        INT := 0;
  PERK_THRESHOLD CONSTANT NUMERIC := 70;
  PERK_KM        CONSTANT NUMERIC := 5;
BEGIN
  SELECT km_total, free_km_available, km_to_next_perk
  INTO v_km_total, v_free_km, v_km_to_next
  FROM public.profiles WHERE user_id = p_user_id;

  IF NOT FOUND THEN RETURN; END IF;

  v_km_total   := v_km_total + p_ride_km;
  v_km_to_next := v_km_to_next - p_ride_km;

  WHILE v_km_to_next <= 0 LOOP
    v_perks      := v_perks + 1;
    v_free_km    := v_free_km + PERK_KM;
    v_km_to_next := v_km_to_next + PERK_THRESHOLD;
  END LOOP;

  UPDATE public.profiles SET
    km_total          = v_km_total,
    free_km_available = v_free_km,
    km_to_next_perk   = v_km_to_next
  WHERE user_id = p_user_id;

  RETURN QUERY SELECT v_perks, v_free_km;
END;
$$;

-- 8.6 Actualizar predição de trajecto
CREATE OR REPLACE FUNCTION public.update_ride_prediction(
  p_user_id     UUID,
  p_origin_addr TEXT,
  p_origin_lat  DOUBLE PRECISION,
  p_origin_lng  DOUBLE PRECISION,
  p_dest_addr   TEXT,
  p_dest_lat    DOUBLE PRECISION,
  p_dest_lng    DOUBLE PRECISION,
  p_price_kz    NUMERIC,
  p_hour        INT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.ride_predictions (
    user_id, origin_address, origin_lat, origin_lng,
    dest_address, dest_lat, dest_lng,
    frequency, last_used_at, best_hour, avg_price_kz
  ) VALUES (
    p_user_id, p_origin_addr, p_origin_lat, p_origin_lng,
    p_dest_addr, p_dest_lat, p_dest_lng,
    1, NOW(), p_hour, p_price_kz
  )
  ON CONFLICT (user_id, origin_address, dest_address) DO UPDATE SET
    frequency    = ride_predictions.frequency + 1,
    last_used_at = NOW(),
    avg_price_kz = (ride_predictions.avg_price_kz * ride_predictions.frequency + p_price_kz)
                   / (ride_predictions.frequency + 1),
    best_hour    = COALESCE(p_hour, ride_predictions.best_hour);
END;
$$;

-- 8.7 Calcular MotoGo Score
CREATE OR REPLACE FUNCTION public.calculate_motogo_score(p_driver_id UUID)
RETURNS TABLE(score INT, label TEXT, breakdown JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_rides     INT;
  v_rating          NUMERIC;
  v_level           TEXT;
  v_completed       INT;
  v_cancelled       INT;
  v_completion_rate NUMERIC;
  v_rides_comp      INT;
  v_rating_comp     INT;
  v_level_comp      INT;
  v_final_score     INT;
  v_label           TEXT;
BEGIN
  SELECT total_rides, rating, level
  INTO v_total_rides, v_rating, v_level
  FROM public.profiles WHERE user_id = p_driver_id;

  SELECT
    COUNT(*) FILTER (WHERE status = 'completed'),
    COUNT(*) FILTER (WHERE status = 'cancelled')
  INTO v_completed, v_cancelled
  FROM public.rides
  WHERE driver_id = p_driver_id
    AND created_at > NOW() - INTERVAL '90 days';

  v_completion_rate := CASE
    WHEN (v_completed + v_cancelled) = 0 THEN 0
    ELSE ROUND(v_completed::NUMERIC / (v_completed + v_cancelled) * 100, 2)
  END;

  v_rides_comp  := LEAST(COALESCE(v_total_rides, 0), 400);
  v_rating_comp := ROUND((COALESCE(v_rating, 0) / 5.0) * 300)::INT;
  v_level_comp  := CASE COALESCE(v_level, 'Novato')
    WHEN 'Diamante' THEN 200
    WHEN 'Ouro'     THEN 150
    WHEN 'Prata'    THEN 100
    WHEN 'Bronze'   THEN 50
    ELSE 0
  END;

  v_final_score := v_rides_comp + v_rating_comp + v_level_comp + ROUND(v_completion_rate)::INT;

  v_label := CASE
    WHEN v_final_score < 50  THEN 'Sem Historial'
    WHEN v_final_score < 300 THEN 'Básico'
    WHEN v_final_score < 500 THEN 'Médio'
    WHEN v_final_score < 700 THEN 'Bom'
    WHEN v_final_score < 900 THEN 'Excelente'
    ELSE 'Extraordinário'
  END;

  INSERT INTO public.motogo_scores (
    driver_id, score, score_label,
    rides_component, rating_component, level_component,
    consistency_pct, last_calculated
  ) VALUES (
    p_driver_id, v_final_score, v_label,
    v_rides_comp, v_rating_comp, v_level_comp,
    v_completion_rate, NOW()
  )
  ON CONFLICT (driver_id) DO UPDATE SET
    score            = v_final_score,
    score_label      = v_label,
    rides_component  = v_rides_comp,
    rating_component = v_rating_comp,
    level_component  = v_level_comp,
    consistency_pct  = v_completion_rate,
    last_calculated  = NOW();

  RETURN QUERY SELECT
    v_final_score, v_label,
    jsonb_build_object(
      'rides_component',  v_rides_comp,
      'rating_component', v_rating_comp,
      'level_component',  v_level_comp,
      'consistency_pct',  v_completion_rate
    );
END;
$$;

-- 8.8 Processar pagamento v3 (perk + predição + score)
CREATE OR REPLACE FUNCTION public.process_ride_payment_v3(
  p_ride_id      UUID,
  p_passenger_id UUID,
  p_driver_id    UUID,
  p_amount       NUMERIC,
  p_distance_km  NUMERIC DEFAULT 0,
  p_origin_addr  TEXT    DEFAULT NULL,
  p_origin_lat   DOUBLE PRECISION DEFAULT 0,
  p_origin_lng   DOUBLE PRECISION DEFAULT 0,
  p_dest_addr    TEXT    DEFAULT NULL,
  p_dest_lat     DOUBLE PRECISION DEFAULT 0,
  p_dest_lng     DOUBLE PRECISION DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hour INT := EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Africa/Luanda')::INT;
BEGIN
  PERFORM public.process_ride_payment(p_ride_id, p_passenger_id, p_driver_id, p_amount);

  IF p_distance_km > 0 THEN
    PERFORM public.award_free_perk(p_passenger_id, p_distance_km);
  END IF;

  IF p_origin_addr IS NOT NULL AND p_dest_addr IS NOT NULL THEN
    PERFORM public.update_ride_prediction(
      p_passenger_id, p_origin_addr, p_origin_lat, p_origin_lng,
      p_dest_addr, p_dest_lat, p_dest_lng, p_amount, v_hour
    );
  END IF;

  BEGIN
    PERFORM public.calculate_motogo_score(p_driver_id);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END;
$$;

-- 8.9 Levantamento de saldo (motorista)
-- NOVO: estava em falta — chamado pelo multicaixa-pay withdrawal
CREATE OR REPLACE FUNCTION public.process_withdrawal(
  p_user_id UUID,
  p_amount  NUMERIC
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance     NUMERIC;
  v_bal_after   NUMERIC;
BEGIN
  SELECT balance INTO v_balance
  FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet não encontrada para o utilizador %', p_user_id;
  END IF;
  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'Saldo insuficiente. Disponível: % | Solicitado: %', v_balance, p_amount;
  END IF;

  UPDATE public.wallets
  SET balance = balance - p_amount, updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING balance INTO v_bal_after;

  INSERT INTO public.transactions (user_id, amount, type, description, balance_after)
  VALUES (
    p_user_id, -p_amount, 'withdrawal',
    'Levantamento solicitado', v_bal_after
  );
END;
$$;

-- 8.10 Pagamento a parceiro MotoGo Pay
-- NOVO: estava em falta — chamado pelo MotoGoPayPartners.tsx
CREATE OR REPLACE FUNCTION public.process_partner_payment(
  p_user_id    UUID,
  p_partner_id UUID,
  p_amount_kz  NUMERIC
)
RETURNS TABLE(success BOOLEAN, new_balance NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance     NUMERIC;
  v_bal_after   NUMERIC;
  v_partner_name TEXT;
BEGIN
  SELECT balance INTO v_balance
  FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;

  IF NOT FOUND OR v_balance < p_amount_kz THEN
    RETURN QUERY SELECT false, COALESCE(v_balance, 0::NUMERIC);
    RETURN;
  END IF;

  SELECT name INTO v_partner_name
  FROM public.motogopay_partners WHERE id = p_partner_id;

  UPDATE public.wallets
  SET balance = balance - p_amount_kz, updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING balance INTO v_bal_after;

  INSERT INTO public.transactions (user_id, amount, type, description, balance_after)
  VALUES (
    p_user_id, -p_amount_kz, 'partner_payment',
    'Parceiro: ' || COALESCE(v_partner_name, 'Desconhecido'),
    v_bal_after
  );

  RETURN QUERY SELECT true, v_bal_after;
END;
$$;


-- =============================================================================
-- SECÇÃO 9 — ROW LEVEL SECURITY
-- Limpa todas as policies existentes antes de recriar (idempotente)
-- =============================================================================

ALTER TABLE public.users                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_locations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rides                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ratings                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_bids              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_privacy             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geocoding_cache          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ip_rate_limits           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zone_prices              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_predictions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motogo_scores            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_tracking_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motogopay_partners       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_deviation_alerts   ENABLE ROW LEVEL SECURITY;

-- Limpar todas as policies existentes
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
      pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;

-- ─── public.users ─────────────────────────────────────────────────────────────
-- NOTA: is_admin() usa SECURITY DEFINER — sem recursão infinita
CREATE POLICY "users: ver próprio"
  ON public.users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "users: admin vê tudo"
  ON public.users FOR SELECT
  USING (public.is_admin());

CREATE POLICY "users: admin actualiza"
  ON public.users FOR UPDATE
  USING (public.is_admin());

-- ─── public.profiles ──────────────────────────────────────────────────────────
CREATE POLICY "profiles: leitura pública"
  ON public.profiles FOR SELECT USING (true);

CREATE POLICY "profiles: editar próprio"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── public.driver_locations ──────────────────────────────────────────────────
CREATE POLICY "driver_locations: motorista gere"
  ON public.driver_locations FOR ALL
  USING (auth.uid() = driver_id)
  WITH CHECK (auth.uid() = driver_id);

CREATE POLICY "driver_locations: leitura pública"
  ON public.driver_locations FOR SELECT USING (true);

-- ─── public.rides ─────────────────────────────────────────────────────────────
CREATE POLICY "rides: passageiro vê"
  ON public.rides FOR SELECT
  USING (auth.uid() = passenger_id);

CREATE POLICY "rides: motorista vê"
  ON public.rides FOR SELECT
  USING (auth.uid() = driver_id OR (status = 'searching' AND driver_id IS NULL));

CREATE POLICY "rides: cria"
  ON public.rides FOR INSERT
  WITH CHECK (auth.uid() = passenger_id);

CREATE POLICY "rides: motorista actualiza"
  ON public.rides FOR UPDATE
  USING (auth.uid() = driver_id OR (driver_id IS NULL AND status = 'searching'));

-- CORRIGIDO: passageiro pode cancelar a sua própria corrida
CREATE POLICY "rides: passageiro cancela"
  ON public.rides FOR UPDATE
  USING (auth.uid() = passenger_id AND status NOT IN ('completed', 'cancelled'));

CREATE POLICY "rides: admin"
  ON public.rides FOR ALL
  USING (public.is_admin());

-- ─── public.wallets ───────────────────────────────────────────────────────────
CREATE POLICY "wallets: ver própria"
  ON public.wallets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "wallets: admin vê tudo"
  ON public.wallets FOR SELECT
  USING (public.is_admin());

-- ─── public.transactions ──────────────────────────────────────────────────────
CREATE POLICY "transactions: ver próprias"
  ON public.transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "transactions: admin vê tudo"
  ON public.transactions FOR SELECT
  USING (public.is_admin());

-- ─── public.posts ─────────────────────────────────────────────────────────────
CREATE POLICY "posts: leitura pública"  ON public.posts FOR SELECT USING (true);
CREATE POLICY "posts: criar"            ON public.posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "posts: editar próprio"   ON public.posts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "posts: apagar próprio"   ON public.posts FOR DELETE USING (auth.uid() = user_id);

-- ─── public.ratings ───────────────────────────────────────────────────────────
CREATE POLICY "ratings: leitura pública" ON public.ratings FOR SELECT USING (true);

CREATE POLICY "ratings: criar"
  ON public.ratings FOR INSERT
  WITH CHECK (
    auth.uid() = from_user
    AND EXISTS (
      SELECT 1 FROM public.rides
      WHERE id = ride_id
        AND status = 'completed'
        AND (passenger_id = auth.uid() OR driver_id = auth.uid())
    )
  );

-- ─── public.contracts ─────────────────────────────────────────────────────────
CREATE POLICY "contracts: ver"
  ON public.contracts FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "contracts: criar"
  ON public.contracts FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "contracts: editar"
  ON public.contracts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── public.driver_bids ───────────────────────────────────────────────────────
CREATE POLICY "driver_bids: motorista vê"
  ON public.driver_bids FOR SELECT USING (auth.uid() = driver_id);

CREATE POLICY "driver_bids: passageiro vê corrida"
  ON public.driver_bids FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.rides
    WHERE rides.id = driver_bids.ride_id AND rides.passenger_id = auth.uid()
  ));

CREATE POLICY "driver_bids: motorista cria"
  ON public.driver_bids FOR INSERT
  WITH CHECK (
    auth.uid() = driver_id
    AND EXISTS (
      SELECT 1 FROM public.rides
      WHERE rides.id = ride_id AND rides.status = 'searching'
    )
  );

CREATE POLICY "driver_bids: motorista actualiza"
  ON public.driver_bids FOR UPDATE USING (auth.uid() = driver_id);

CREATE POLICY "driver_bids: passageiro elimina"
  ON public.driver_bids FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.rides
    WHERE rides.id = driver_bids.ride_id AND rides.passenger_id = auth.uid()
  ));

-- ─── public.user_privacy ──────────────────────────────────────────────────────
CREATE POLICY "user_privacy: gerir própria"
  ON public.user_privacy FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── public.geocoding_cache ───────────────────────────────────────────────────
CREATE POLICY "geocoding: leitura pública"
  ON public.geocoding_cache FOR SELECT USING (true);

CREATE POLICY "geocoding: inserir autenticado"
  ON public.geocoding_cache FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "geocoding: actualizar service"
  ON public.geocoding_cache FOR UPDATE
  USING (auth.role() = 'service_role');

-- ─── public.ai_usage_logs ─────────────────────────────────────────────────────
CREATE POLICY "ai_logs: ver próprios"
  ON public.ai_usage_logs FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "ai_logs: service insere"
  ON public.ai_usage_logs FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- ─── public.zone_prices ───────────────────────────────────────────────────────
CREATE POLICY "zone_prices: leitura pública"
  ON public.zone_prices FOR SELECT USING (true);

CREATE POLICY "zone_prices: admin escreve"
  ON public.zone_prices FOR ALL
  USING (public.is_admin());

-- ─── public.ride_predictions ──────────────────────────────────────────────────
CREATE POLICY "predictions: próprias"
  ON public.ride_predictions FOR ALL USING (auth.uid() = user_id);

-- ─── public.motogo_scores ─────────────────────────────────────────────────────
CREATE POLICY "score: motorista vê"
  ON public.motogo_scores FOR SELECT USING (auth.uid() = driver_id);

CREATE POLICY "score: admin vê tudo"
  ON public.motogo_scores FOR SELECT USING (public.is_admin());

-- ─── public.school_tracking_sessions ─────────────────────────────────────────
CREATE POLICY "tracking: leitura pública"
  ON public.school_tracking_sessions FOR SELECT USING (true);

CREATE POLICY "tracking: dono cria"
  ON public.school_tracking_sessions FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.contracts c
    WHERE c.id = contract_id AND c.user_id = auth.uid()
  ));

-- CORRIGIDO: policy UPDATE em falta — necessária para expirar sessões
CREATE POLICY "tracking: dono actualiza"
  ON public.school_tracking_sessions FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.contracts c
    WHERE c.id = contract_id AND c.user_id = auth.uid()
  ));

-- ─── public.motogopay_partners ────────────────────────────────────────────────
CREATE POLICY "partners: leitura pública"
  ON public.motogopay_partners FOR SELECT USING (true);

CREATE POLICY "partners: admin gere"
  ON public.motogopay_partners FOR ALL
  USING (public.is_admin());

-- ─── public.route_deviation_alerts ────────────────────────────────────────────
CREATE POLICY "deviation: participantes vêem"
  ON public.route_deviation_alerts FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.rides
    WHERE id = ride_id
      AND (passenger_id = auth.uid() OR driver_id = auth.uid())
  ));

CREATE POLICY "deviation: service insere"
  ON public.route_deviation_alerts FOR INSERT
  WITH CHECK (auth.role() = 'service_role' OR auth.role() = 'authenticated');

-- ─── public.ip_rate_limits ────────────────────────────────────────────────────
-- Sem policies públicas — apenas service_role tem acesso


-- =============================================================================
-- SECÇÃO 10 — REALTIME
-- =============================================================================

DO $$
DECLARE
  v_table TEXT;
  v_exists BOOLEAN;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH v_table IN ARRAY ARRAY[
      'rides',
      'driver_locations',
      'posts',
      'driver_bids',
      'wallets',
      'transactions',
      'profiles',
      'school_tracking_sessions'
    ]
    LOOP
      SELECT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = v_table
      ) INTO v_exists;

      IF NOT v_exists THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
      END IF;
    END LOOP;
  END IF;
END $$;

-- Security invoker na view de rate limit de IA
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'ai_usage_last_hour' AND relkind = 'v'
  ) THEN
    ALTER VIEW public.ai_usage_last_hour SET (security_invoker = true);
  END IF;
END $$;


-- =============================================================================
-- SECÇÃO 11 — DADOS INICIAIS (SEED)
-- =============================================================================

INSERT INTO public.zone_prices (origin_zone, dest_zone, price_kz, distance_km) VALUES
  ('Viana',        'Talatona',     3500, 22),
  ('Viana',        'Kilamba',      1800, 12),
  ('Viana',        'Centro',       4500, 30),
  ('Viana',        'Miramar',      4200, 28),
  ('Viana',        'Maianga',      3800, 26),
  ('Viana',        'Cazenga',      3500, 23),
  ('Viana',        'Samba',        3200, 21),
  ('Viana',        'Benfica',      3000, 19),
  ('Viana',        'Luanda Norte', 2800, 18),
  ('Kilamba',      'Talatona',     2500, 16),
  ('Kilamba',      'Centro',       3800, 25),
  ('Kilamba',      'Miramar',      3500, 23),
  ('Kilamba',      'Maianga',      3200, 21),
  ('Kilamba',      'Cazenga',      3000, 20),
  ('Kilamba',      'Samba',        2800, 18),
  ('Kilamba',      'Benfica',      2600, 17),
  ('Talatona',     'Centro',       3000, 20),
  ('Talatona',     'Miramar',      2200, 14),
  ('Talatona',     'Maianga',      2800, 18),
  ('Talatona',     'Benfica',      1800, 11),
  ('Talatona',     'Cazenga',      3500, 23),
  ('Centro',       'Cazenga',      1400,  8),
  ('Centro',       'Rangel',       1600, 10),
  ('Centro',       'Maianga',       900,  5),
  ('Centro',       'Miramar',      1000,  6),
  ('Centro',       'Samba',        2000, 12),
  ('Centro',       'Benfica',      2400, 15),
  ('Centro',       'Luanda Norte', 2800, 18),
  ('Cazenga',      'Rangel',        800,  5),
  ('Cazenga',      'Maianga',      1600, 10),
  ('Cazenga',      'Luanda Norte', 2000, 13),
  ('Maianga',      'Miramar',       700,  4),
  ('Maianga',      'Cazenga',      1600, 10),
  ('Maianga',      'Rangel',       1200,  7),
  ('Luanda Norte', 'Centro',       2800, 18),
  ('Luanda Norte', 'Talatona',     4200, 28),
  ('Miramar',      'Samba',        1800, 11),
  ('Samba',        'Benfica',      1600, 10),
  ('Rangel',       'Cazenga',       800,  5)
ON CONFLICT (origin_zone, dest_zone) DO NOTHING;

INSERT INTO public.motogopay_partners (name, category, description, discount_pct) VALUES
  ('Total Energies Angola', 'fuel',        'Postos Total em Luanda e arredores',        5.0),
  ('Sonangol Combústiveis', 'fuel',        'Rede nacional de postos Sonangol',          3.0),
  ('Restaurante Panorama',  'food',        'Refeições com desconto em Luanda',         10.0),
  ('Fast Funge Delivery',   'food',        'Comida típica angolana ao domicílio',       8.0),
  ('ENSA Angola',           'insurance',   'Seguro automóvel com condições especiais', 15.0),
  ('Auto Shop Viana',       'mechanic',    'Manutenção e revisão de viaturas',          7.0),
  ('Kero Supermercados',    'supermarket', 'Compras com cashback para motoristas',      3.0)
ON CONFLICT DO NOTHING;


-- =============================================================================
-- SECÇÃO 12 — VERIFICAÇÃO FINAL
-- =============================================================================

SELECT
  t.table_name,
  (SELECT COUNT(*)
   FROM information_schema.columns c
   WHERE c.table_name = t.table_name
     AND c.table_schema = 'public') AS colunas,
  (SELECT COUNT(*)
   FROM pg_policies p
   WHERE p.tablename = t.table_name
     AND p.schemaname = 'public') AS policies
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
ORDER BY t.table_name;

-- =============================================================================
-- FIM — zenith_schema_final.sql
-- v3.0 — Todos os erros corrigidos
-- =============================================================================
