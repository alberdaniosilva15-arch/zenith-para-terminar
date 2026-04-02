-- =============================================================================
-- MOTOGO AI v2.1 — schema.sql (BASE)
-- Executar PRIMEIRO no Supabase SQL Editor
-- =============================================================================

-- 1. EXTENSÕES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- 2. TIPOS
CREATE TYPE user_role AS ENUM ('passenger', 'driver', 'admin');
CREATE TYPE ride_status AS ENUM (
  'searching', 'accepted', 'picking_up',
  'in_progress', 'completed', 'cancelled'
);
CREATE TYPE transaction_type AS ENUM (
  'ride_payment', 'ride_earning', 'top_up',
  'refund', 'bonus', 'withdrawal'
);
CREATE TYPE driver_status AS ENUM ('offline', 'available', 'busy');

-- 3. TABELAS

CREATE TABLE public.users (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT UNIQUE NOT NULL,
  role       user_role NOT NULL DEFAULT 'passenger',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.profiles (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT '',
  avatar_url  TEXT,
  phone       TEXT,
  rating      NUMERIC(3,2) NOT NULL DEFAULT 5.00 CHECK (rating >= 1 AND rating <= 5),
  total_rides INT NOT NULL DEFAULT 0,
  level       TEXT NOT NULL DEFAULT 'Novato',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.driver_locations (
  driver_id  UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  location   GEOGRAPHY(POINT, 4326) NOT NULL,
  heading    NUMERIC(5,2),
  status     driver_status NOT NULL DEFAULT 'offline',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_driver_locations_geo    ON public.driver_locations USING GIST(location);
CREATE INDEX idx_driver_locations_status ON public.driver_locations(status);

CREATE TABLE public.rides (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  passenger_id    UUID NOT NULL REFERENCES public.users(id),
  driver_id       UUID REFERENCES public.users(id),
  origin_address  TEXT NOT NULL,
  origin_lat      DOUBLE PRECISION NOT NULL,
  origin_lng      DOUBLE PRECISION NOT NULL,
  origin_geo      GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (
                    ST_SetSRID(ST_MakePoint(origin_lng, origin_lat), 4326)::geography
                  ) STORED,
  dest_address    TEXT NOT NULL,
  dest_lat        DOUBLE PRECISION NOT NULL,
  dest_lng        DOUBLE PRECISION NOT NULL,
  dest_geo        GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (
                    ST_SetSRID(ST_MakePoint(dest_lng, dest_lat), 4326)::geography
                  ) STORED,
  distance_km      NUMERIC(8,3),
  duration_min     INT,
  surge_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  price_kz         NUMERIC(10,2) NOT NULL,
  status           ride_status NOT NULL DEFAULT 'searching',
  driver_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at      TIMESTAMPTZ,
  pickup_at        TIMESTAMPTZ,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  cancel_reason    TEXT
);
CREATE INDEX idx_rides_passenger  ON public.rides(passenger_id);
CREATE INDEX idx_rides_driver     ON public.rides(driver_id);
CREATE INDEX idx_rides_status     ON public.rides(status);
CREATE INDEX idx_rides_created    ON public.rides(created_at DESC);
CREATE INDEX idx_rides_origin_geo ON public.rides USING GIST(origin_geo);

CREATE TABLE public.wallets (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  balance    NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
  currency   TEXT NOT NULL DEFAULT 'KZS',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.transactions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES public.users(id),
  ride_id       UUID REFERENCES public.rides(id),
  amount        NUMERIC(12,2) NOT NULL,
  type          transaction_type NOT NULL,
  description   TEXT,
  balance_after NUMERIC(12,2) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_transactions_user ON public.transactions(user_id, created_at DESC);
CREATE INDEX idx_transactions_ride ON public.transactions(ride_id);

CREATE TABLE public.posts (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES public.users(id),
  content    TEXT NOT NULL CHECK (char_length(content) <= 500),
  post_type  TEXT NOT NULL DEFAULT 'status' CHECK (post_type IN ('status', 'alert', 'event')),
  location   TEXT,
  likes      INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_posts_created ON public.posts(created_at DESC);
CREATE INDEX idx_posts_user    ON public.posts(user_id);

CREATE TABLE public.ratings (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id    UUID NOT NULL REFERENCES public.rides(id),
  from_user  UUID NOT NULL REFERENCES public.users(id),
  to_user    UUID NOT NULL REFERENCES public.users(id),
  score      INT NOT NULL CHECK (score >= 1 AND score <= 5),
  comment    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(ride_id, from_user)
);

CREATE TABLE public.contracts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES public.users(id),
  contract_type     TEXT NOT NULL CHECK (contract_type IN ('school', 'work')),
  title             TEXT NOT NULL,
  address           TEXT NOT NULL,
  dest_lat          DOUBLE PRECISION NOT NULL,
  dest_lng          DOUBLE PRECISION NOT NULL,
  time_start        TIME NOT NULL,
  time_end          TIME NOT NULL,
  parent_monitoring BOOLEAN NOT NULL DEFAULT FALSE,
  km_accumulated    NUMERIC(8,2) NOT NULL DEFAULT 0,
  bonus_kz          NUMERIC(10,2) NOT NULL DEFAULT 0,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. FUNCTIONS & TRIGGERS

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER t_users_updated_at    BEFORE UPDATE ON public.users    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER t_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER t_wallets_updated_at  BEFORE UPDATE ON public.wallets  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users    (id, email, role) VALUES (NEW.id, NEW.email, 'passenger');
  INSERT INTO public.profiles (user_id, name)   VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)));
  INSERT INTO public.wallets  (user_id, balance) VALUES (NEW.id, 0.00);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

CREATE OR REPLACE FUNCTION update_user_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.profiles
  SET
    rating = (SELECT ROUND(AVG(score)::numeric, 2) FROM public.ratings WHERE to_user = NEW.to_user),
    total_rides = total_rides + 1,
    level = CASE
      WHEN total_rides + 1 >= 500 THEN 'Diamante'
      WHEN total_rides + 1 >= 200 THEN 'Ouro'
      WHEN total_rides + 1 >= 50  THEN 'Prata'
      WHEN total_rides + 1 >= 10  THEN 'Bronze'
      ELSE 'Novato'
    END
  WHERE user_id = NEW.to_user;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_rating_created
  AFTER INSERT ON public.ratings
  FOR EACH ROW EXECUTE FUNCTION update_user_rating();

CREATE OR REPLACE FUNCTION process_ride_payment(
  p_ride_id UUID, p_passenger_id UUID, p_driver_id UUID, p_amount NUMERIC
) RETURNS void AS $$
DECLARE
  v_passenger_balance NUMERIC;
  v_platform_fee      NUMERIC;
  v_driver_earning    NUMERIC;
  v_pass_bal_after    NUMERIC;
  v_driv_bal_after    NUMERIC;
BEGIN
  v_platform_fee   := ROUND(p_amount * 0.15, 2);
  v_driver_earning := p_amount - v_platform_fee;

  SELECT balance INTO v_passenger_balance FROM public.wallets WHERE user_id = p_passenger_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet do passageiro não encontrada: %', p_passenger_id; END IF;
  IF v_passenger_balance < p_amount THEN
    RAISE EXCEPTION 'Saldo insuficiente. Disponível: % KZS | Necessário: % KZS', v_passenger_balance, p_amount;
  END IF;

  UPDATE public.wallets SET balance = balance - p_amount, updated_at = NOW()
    WHERE user_id = p_passenger_id RETURNING balance INTO v_pass_bal_after;
  INSERT INTO public.transactions (user_id, ride_id, amount, type, description, balance_after)
    VALUES (p_passenger_id, p_ride_id, -p_amount, 'ride_payment', 'Pagamento de corrida', v_pass_bal_after);

  UPDATE public.wallets SET balance = balance + v_driver_earning, updated_at = NOW()
    WHERE user_id = p_driver_id RETURNING balance INTO v_driv_bal_after;
  INSERT INTO public.transactions (user_id, ride_id, amount, type, description, balance_after)
    VALUES (p_driver_id, p_ride_id, v_driver_earning, 'ride_earning', 'Ganho de corrida', v_driv_bal_after);

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION find_nearby_drivers(
  p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION,
  p_radius_km DOUBLE PRECISION DEFAULT 5.0, p_limit INT DEFAULT 10
) RETURNS TABLE(driver_id UUID, driver_name TEXT, rating NUMERIC, distance_m DOUBLE PRECISION, heading NUMERIC)
AS $$
BEGIN
  RETURN QUERY
  SELECT dl.driver_id, pr.name, pr.rating,
    ST_Distance(dl.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) AS distance_m,
    dl.heading
  FROM public.driver_locations dl
  JOIN public.profiles pr ON pr.user_id = dl.driver_id
  WHERE dl.status = 'available'
    AND ST_DWithin(dl.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, p_radius_km * 1000)
  ORDER BY
    (ST_Distance(dl.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) * 0.7)
    + ((5.0 - pr.rating) * 500 * 0.3)
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. RLS
ALTER TABLE public.users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_locations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rides             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ratings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracts         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users: ver próprio"   ON public.users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users: admin vê tudo" ON public.users FOR SELECT USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "profiles: leitura pública" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles: editar próprio"  ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "driver_locations: motorista" ON public.driver_locations FOR ALL    USING (auth.uid() = driver_id);
CREATE POLICY "driver_locations: leitura"   ON public.driver_locations FOR SELECT USING (true);

CREATE POLICY "rides: passageiro vê" ON public.rides FOR SELECT USING (auth.uid() = passenger_id);
CREATE POLICY "rides: motorista vê"  ON public.rides FOR SELECT USING (auth.uid() = driver_id OR (status = 'searching' AND driver_id IS NULL));
CREATE POLICY "rides: cria"          ON public.rides FOR INSERT WITH CHECK (auth.uid() = passenger_id);
CREATE POLICY "rides: actualiza"     ON public.rides FOR UPDATE USING (auth.uid() = driver_id OR (driver_id IS NULL AND status = 'searching'));
CREATE POLICY "rides: admin"         ON public.rides FOR ALL    USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "wallets: próprio" ON public.wallets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "wallets: admin"   ON public.wallets FOR SELECT USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "transactions: próprias" ON public.transactions FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "posts: leitura" ON public.posts FOR SELECT USING (true);
CREATE POLICY "posts: criar"   ON public.posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "posts: editar"  ON public.posts FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "ratings: ler"   ON public.ratings FOR SELECT USING (true);
CREATE POLICY "ratings: criar" ON public.ratings FOR INSERT WITH CHECK (
  auth.uid() = from_user
  AND EXISTS (SELECT 1 FROM public.rides WHERE id = ride_id AND status = 'completed' AND (passenger_id = auth.uid() OR driver_id = auth.uid()))
);

CREATE POLICY "contracts: ver"   ON public.contracts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "contracts: criar" ON public.contracts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "contracts: editar" ON public.contracts FOR UPDATE USING (auth.uid() = user_id);

-- 6. REALTIME
ALTER PUBLICATION supabase_realtime ADD TABLE public.rides;
ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_locations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.posts;


-- =============================================================================
-- MOTOGO AI v2.1 — schema.sql PATCH (riscos residuais)
-- Adicionar ao final do schema.sql existente
-- Idempotente: pode ser re-executado sem erros
-- =============================================================================

-- ── RISCO 1: View ai_usage_last_hour sem RLS ────────────────────────────────
-- security_invoker=true → a view corre com as permissões do utilizador chamador
-- A tabela ai_usage_logs tem RLS USING(auth.uid()=user_id)
-- → cada utilizador passa a ver APENAS os seus próprios dados na view
-- (sem este patch, qualquer utilizador autenticado via query directa via a view)
ALTER VIEW public.ai_usage_last_hour SET (security_invoker = true);


-- ── RISCO 2: IP Rate Limiting (infra para o gemini-proxy) ──────────────────
-- Tabela de tracking por IP (hashed por privacidade)
-- gemini-proxy usa service_role para escrever/ler esta tabela
-- Sem policies públicas = negação por defeito (apenas service_role acede)
CREATE TABLE IF NOT EXISTS public.ip_rate_limits (
  ip_hash       TEXT        NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL DEFAULT date_trunc('minute', NOW()),
  request_count INT         NOT NULL DEFAULT 1,
  PRIMARY KEY (ip_hash, window_start)
);

CREATE INDEX IF NOT EXISTS idx_ip_rate_limits_window
  ON public.ip_rate_limits(window_start);

ALTER TABLE public.ip_rate_limits ENABLE ROW LEVEL SECURITY;
-- Sem policies = acesso negado para qualquer role excepto service_role (owner)


-- ── RISCO 3: contracts UPDATE sem WITH CHECK ────────────────────────────────
-- Vulnerabilidade: a policy existente só tinha USING → user podia alterar user_id
-- Fix: recriar com WITH CHECK (garante que os dados escritos também são válidos)
DO $$
BEGIN
  -- Remover policy existente (sem WITH CHECK)
  DROP POLICY IF EXISTS "contracts: editar" ON public.contracts;

  -- Recriar com USING + WITH CHECK
  -- USING   → quais linhas podem ser alvos do UPDATE (condição WHERE)
  -- WITH CHECK → o que pode ser escrito (previne alterar user_id)
  EXECUTE $policy$
    CREATE POLICY "contracts: editar" ON public.contracts
      FOR UPDATE
      USING     (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  $policy$;
END $$;


-- ── BÓNUS: proteger km_accumulated e bonus_kz de escrita directa ────────────
-- Estes campos são métricas do sistema — não devem ser editáveis pelo utilizador
-- Trigger que bloqueia qualquer tentativa de alterar estes campos via UPDATE normal
CREATE OR REPLACE FUNCTION protect_contract_system_fields()
RETURNS TRIGGER AS $$
BEGIN
  -- Prevenir alteração de campos geridos pelo sistema
  IF NEW.km_accumulated IS DISTINCT FROM OLD.km_accumulated THEN
    RAISE EXCEPTION
      'km_accumulated é gerido pelo sistema e não pode ser editado directamente.';
  END IF;

  IF NEW.bonus_kz IS DISTINCT FROM OLD.bonus_kz THEN
    RAISE EXCEPTION
      'bonus_kz é gerido pelo sistema e não pode ser editado directamente.';
  END IF;

  -- Prevenir transferência de contrato para outro utilizador
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION
      'Não é permitido transferir a propriedade de um contrato.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Criar trigger apenas se não existir (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 't_contracts_protect_system_fields'
      AND tgrelid = 'public.contracts'::regclass
  ) THEN
    CREATE TRIGGER t_contracts_protect_system_fields
      BEFORE UPDATE ON public.contracts
      FOR EACH ROW EXECUTE FUNCTION protect_contract_system_fields();
  END IF;
END $$;

-- =============================================================================
-- FIM DO PATCH — riscos residuais corrigidos
-- =============================================================================
