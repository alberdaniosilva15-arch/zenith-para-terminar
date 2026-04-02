-- =============================================================================
-- MOTOGO v3.0 — migration_v3_features.sql
-- Executa NO Supabase SQL Editor (depois do schema.sql e schema_additions.sql)
-- Inclui: Kaze Preditivo, MotoGo Score, Free Perk, Zona Preços, Escolar
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. COLUNA km_total e free_km_available em profiles
--    (tracking do programa de fidelidade 70km → 5km grátis)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS km_total          NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_km_available NUMERIC(6,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS km_to_next_perk   NUMERIC(6,2)  NOT NULL DEFAULT 70;

-- Índice para queries de perk
CREATE INDEX IF NOT EXISTS idx_profiles_km ON public.profiles(km_total);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. TABELA: zone_prices
--    Preços fixos por par de zonas. A empresa define, os utilizadores vêem.
-- ─────────────────────────────────────────────────────────────────────────────
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

ALTER TABLE public.zone_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "zone_prices: read all" ON public.zone_prices FOR SELECT USING (true);
CREATE POLICY "zone_prices: admin write" ON public.zone_prices
  FOR ALL USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- Preços base de Luanda (tarifa fixa, sem surge)
INSERT INTO public.zone_prices (origin_zone, dest_zone, price_kz, distance_km) VALUES
-- Viana como origem
('Viana',         'Talatona',      3500, 22),
('Viana',         'Kilamba',       1800, 12),
('Viana',         'Centro',        4500, 30),
('Viana',         'Miramar',       4200, 28),
('Viana',         'Maianga',       3800, 26),
('Viana',         'Samba',         3200, 21),
('Viana',         'Benfica',       3000, 19),
-- Kilamba como origem
('Kilamba',       'Talatona',      2500, 16),
('Kilamba',       'Centro',        3800, 25),
('Kilamba',       'Viana',         1800, 12),
('Kilamba',       'Miramar',       3500, 23),
('Kilamba',       'Maianga',       3200, 21),
-- Talatona como origem
('Talatona',      'Centro',        3000, 20),
('Talatona',      'Miramar',       2200, 14),
('Talatona',      'Kilamba',       2500, 16),
('Talatona',      'Benfica',       1800, 11),
('Talatona',      'Maianga',       2800, 18),
-- Centro como origem
('Centro',        'Cazenga',       1400,  8),
('Centro',        'Rangel',        1600, 10),
('Centro',        'Maianga',        900,  5),
('Centro',        'Miramar',       1000,  6),
('Centro',        'Samba',         2000, 12),
('Centro',        'Benfica',       2400, 15),
('Centro',        'Cacuaco',       3500, 22),
('Centro',        'Talatona',      3000, 20),
('Centro',        'Viana',         4500, 30),
-- Cazenga como origem
('Cazenga',       'Centro',        1400,  8),
('Cazenga',       'Rangel',         800,  5),
('Cazenga',       'Maianga',       1600, 10),
('Cazenga',       'Cacuaco',       2000, 13),
-- Maianga como origem
('Maianga',       'Centro',         900,  5),
('Maianga',       'Miramar',        700,  4),
('Maianga',       'Cazenga',       1600, 10),
-- Luanda Norte como origem
('Luanda Norte',  'Centro',        2800, 18),
('Luanda Norte',  'Talatona',      4200, 28),
('Luanda Norte',  'Viana',         3500, 22)
ON CONFLICT (origin_zone, dest_zone) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. TABELA: ride_predictions (Kaze Preditivo)
--    Guarda padrões de corrida por utilizador para sugestões automáticas
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ride_predictions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  origin_address   TEXT NOT NULL,
  origin_lat       DOUBLE PRECISION NOT NULL,
  origin_lng       DOUBLE PRECISION NOT NULL,
  dest_address     TEXT NOT NULL,
  dest_lat         DOUBLE PRECISION NOT NULL,
  dest_lng         DOUBLE PRECISION NOT NULL,
  frequency        INT NOT NULL DEFAULT 1,  -- nº de vezes este trajeto foi feito
  last_used_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  best_hour        INT,                     -- hora do dia mais comum (0-23)
  avg_price_kz     NUMERIC(10,2),
  zone_price_kz    NUMERIC(10,2),           -- preço fixo por zona se disponível
  origin_zone      TEXT,
  dest_zone        TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, origin_address, dest_address)
);

CREATE INDEX IF NOT EXISTS idx_predictions_user ON public.ride_predictions(user_id, frequency DESC);

ALTER TABLE public.ride_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "predictions: own" ON public.ride_predictions FOR ALL USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. FUNÇÃO: update_ride_prediction
--    Chamada após cada corrida concluída — actualiza padrões
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_ride_prediction(
  p_user_id      UUID,
  p_origin_addr  TEXT,
  p_origin_lat   DOUBLE PRECISION,
  p_origin_lng   DOUBLE PRECISION,
  p_dest_addr    TEXT,
  p_dest_lat     DOUBLE PRECISION,
  p_dest_lng     DOUBLE PRECISION,
  p_price_kz     NUMERIC,
  p_hour         INT DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.ride_predictions (
    user_id, origin_address, origin_lat, origin_lng,
    dest_address, dest_lat, dest_lng, frequency, last_used_at, best_hour, avg_price_kz
  ) VALUES (
    p_user_id, p_origin_addr, p_origin_lat, p_origin_lng,
    p_dest_addr, p_dest_lat, p_dest_lng, 1, NOW(), p_hour, p_price_kz
  )
  ON CONFLICT (user_id, origin_address, dest_address)
  DO UPDATE SET
    frequency    = ride_predictions.frequency + 1,
    last_used_at = NOW(),
    avg_price_kz = (ride_predictions.avg_price_kz * ride_predictions.frequency + p_price_kz) / (ride_predictions.frequency + 1),
    best_hour    = COALESCE(p_hour, ride_predictions.best_hour);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. FUNÇÃO: award_free_perk
--    Chamada após corrida completa — acumula km e premia a cada 70km
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.award_free_perk(
  p_user_id    UUID,
  p_ride_km    NUMERIC
)
RETURNS TABLE(perks_awarded INT, free_km_total NUMERIC) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_km_total      NUMERIC;
  v_free_km       NUMERIC;
  v_km_to_next    NUMERIC;
  v_perks         INT := 0;
  PERK_THRESHOLD  CONSTANT NUMERIC := 70;
  PERK_KM         CONSTANT NUMERIC := 5;
BEGIN
  -- Obter estado actual
  SELECT km_total, free_km_available, km_to_next_perk
  INTO v_km_total, v_free_km, v_km_to_next
  FROM public.profiles
  WHERE user_id = p_user_id;

  -- Adicionar km da corrida
  v_km_total  := v_km_total + p_ride_km;
  v_km_to_next := v_km_to_next - p_ride_km;

  -- Verificar se ganhou perk(s)
  WHILE v_km_to_next <= 0 LOOP
    v_perks     := v_perks + 1;
    v_free_km   := v_free_km + PERK_KM;
    v_km_to_next := v_km_to_next + PERK_THRESHOLD;  -- reset para próximo ciclo
  END LOOP;

  -- Actualizar perfil
  UPDATE public.profiles SET
    km_total          = v_km_total,
    free_km_available = v_free_km,
    km_to_next_perk   = v_km_to_next
  WHERE user_id = p_user_id;

  RETURN QUERY SELECT v_perks, v_free_km;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. TABELA: motogo_score (Score de Crédito para Motoristas)
-- ─────────────────────────────────────────────────────────────────────────────
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

ALTER TABLE public.motogo_scores ENABLE ROW LEVEL SECURITY;
-- Driver vê o próprio score, parceiros (bancos) vêem via service_role
CREATE POLICY "score: own read" ON public.motogo_scores FOR SELECT USING (auth.uid() = driver_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. FUNÇÃO: calculate_motogo_score
--    Calcula e actualiza o MotoGo Score de um motorista
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_motogo_score(p_driver_id UUID)
RETURNS TABLE(score INT, label TEXT, breakdown JSONB) LANGUAGE plpgsql SECURITY DEFINER AS $$
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
  v_consist_comp    INT;
  v_final_score     INT;
  v_label           TEXT;
BEGIN
  -- Dados do perfil
  SELECT total_rides, rating, level
  INTO v_total_rides, v_rating, v_level
  FROM public.profiles WHERE user_id = p_driver_id;

  -- Taxa de conclusão (últimas 50 corridas)
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

  -- Componentes (total: 1000 pontos)
  -- Corridas: max 400 (1pt cada corrida até 400)
  v_rides_comp := LEAST(v_total_rides, 400);

  -- Rating: max 300 (rating 5.0 = 300, proporcional)
  v_rating_comp := ROUND((COALESCE(v_rating, 0) / 5.0) * 300)::INT;

  -- Nível: max 200
  v_level_comp := CASE v_level
    WHEN 'Diamante' THEN 200
    WHEN 'Ouro'     THEN 150
    WHEN 'Prata'    THEN 100
    WHEN 'Bronze'   THEN 50
    ELSE 0
  END;

  -- Consistência (taxa conclusão): max 100
  v_consist_comp := ROUND(v_completion_rate)::INT;

  v_final_score := v_rides_comp + v_rating_comp + v_level_comp + v_consist_comp;

  -- Label
  v_label := CASE
    WHEN v_final_score < 50  THEN 'Sem Historial'
    WHEN v_final_score < 300 THEN 'Básico'
    WHEN v_final_score < 500 THEN 'Médio'
    WHEN v_final_score < 700 THEN 'Bom'
    WHEN v_final_score < 900 THEN 'Excelente'
    ELSE 'Extraordinário'
  END;

  -- Upsert
  INSERT INTO public.motogo_scores (
    driver_id, score, score_label,
    rides_component, rating_component, level_component, consistency_pct, last_calculated
  ) VALUES (
    p_driver_id, v_final_score, v_label,
    v_rides_comp, v_rating_comp, v_level_comp, v_completion_rate, NOW()
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
    v_final_score,
    v_label,
    jsonb_build_object(
      'rides_component',  v_rides_comp,
      'rating_component', v_rating_comp,
      'level_component',  v_level_comp,
      'consistency_pct',  v_completion_rate,
      'completion_rate',  v_completion_rate
    );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. TABELA: school_tracking_sessions
--    Sessões de monitorização de contratos escolares para pais
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.school_tracking_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id     UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  ride_id         UUID REFERENCES public.rides(id),
  public_token    UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,  -- link para os pais
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired')),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '12 hours'),
  parent_name     TEXT,
  parent_phone    TEXT,
  alerts_sent     INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Public access via token (sem autenticação — link partilhado com pais)
ALTER TABLE public.school_tracking_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tracking: public read by token"
  ON public.school_tracking_sessions FOR SELECT
  USING (true);  -- filtrado por public_token na query

CREATE POLICY "tracking: owner write"
  ON public.school_tracking_sessions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.contracts c
      JOIN public.users u ON u.id = c.user_id
      WHERE c.id = contract_id AND u.id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. TABELA: motogopay_partners (rede de parceiros MotoGo Pay)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.motogopay_partners (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL,
  category     TEXT NOT NULL CHECK (category IN ('fuel', 'food', 'insurance', 'mechanic', 'supermarket')),
  description  TEXT,
  discount_pct NUMERIC(4,2) NOT NULL DEFAULT 0,  -- desconto para motoristas MotoGo
  logo_url     TEXT,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.motogopay_partners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "partners: read all" ON public.motogopay_partners FOR SELECT USING (true);

-- Parceiros iniciais (Angola)
INSERT INTO public.motogopay_partners (name, category, description, discount_pct) VALUES
  ('Total Energies Angola', 'fuel',       'Postos Total em Luanda e arredores',        5.0),
  ('Sonangol Combústiveis', 'fuel',       'Rede nacional de postos Sonangol',          3.0),
  ('Restaurante Panorama',  'food',       'Refeições com desconto em Luanda',          10.0),
  ('Fast Funge Delivery',   'food',       'Comida típica angolana ao domicílio',       8.0),
  ('ENSA Angola',           'insurance',  'Seguro automóvel com condições especiais',  15.0),
  ('Auto Shop Viana',       'mechanic',   'Manutenção e revisão de viaturas',          7.0),
  ('Kero Supermercados',    'supermarket','Compras com cashback para motoristas',      3.0)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. ACTUALIZAR process_ride_payment para incluir perk e prediction
--     (wrapper que chama funções existentes + novos)
-- ─────────────────────────────────────────────────────────────────────────────
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
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_hour INT := EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Africa/Luanda')::INT;
BEGIN
  -- 1. Pagamento base (chama a função existente se existir)
  BEGIN
    PERFORM public.process_ride_payment(p_ride_id, p_passenger_id, p_driver_id, p_amount);
  EXCEPTION WHEN undefined_function THEN
    -- Fallback: processamento manual se a função antiga não existir
    -- Debita passageiro
    UPDATE public.wallets SET
      balance    = balance - p_amount,
      updated_at = NOW()
    WHERE user_id = p_passenger_id AND balance >= p_amount;

    -- Credita motorista (85% do valor — 15% para MotoGo)
    UPDATE public.wallets SET
      balance    = balance + (p_amount * 0.85),
      updated_at = NOW()
    WHERE user_id = p_driver_id;
  END;

  -- 2. Acumular km e verificar perk do passageiro
  IF p_distance_km > 0 THEN
    PERFORM public.award_free_perk(p_passenger_id, p_distance_km);
  END IF;

  -- 3. Actualizar predição de corrida do passageiro
  IF p_origin_addr IS NOT NULL AND p_dest_addr IS NOT NULL THEN
    PERFORM public.update_ride_prediction(
      p_passenger_id, p_origin_addr, p_origin_lat, p_origin_lng,
      p_dest_addr, p_dest_lat, p_dest_lng, p_amount, v_hour
    );
  END IF;

  -- 4. Recalcular MotoGo Score do motorista (assíncrono — não bloqueia)
  BEGIN
    PERFORM public.calculate_motogo_score(p_driver_id);
  EXCEPTION WHEN OTHERS THEN
    NULL; -- não falhar o pagamento por causa do score
  END;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. ÍNDICES adicionais
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_school_tracking_token
  ON public.school_tracking_sessions(public_token);

CREATE INDEX IF NOT EXISTS idx_zone_prices_origin
  ON public.zone_prices(origin_zone, dest_zone);

-- ─────────────────────────────────────────────────────────────────────────────
-- FIM — executa e verifica no Supabase Table Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- CONTRACTS TABLE (school, family, corporate)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contracts (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  contract_type         TEXT NOT NULL DEFAULT 'school' CHECK (contract_type IN ('school','family','corporate')),
  title                 TEXT NOT NULL,
  address               TEXT NOT NULL,
  dest_lat              DOUBLE PRECISION NOT NULL DEFAULT 0,
  dest_lng              DOUBLE PRECISION NOT NULL DEFAULT 0,
  time_start            TIME NOT NULL DEFAULT '07:30',
  time_end              TIME NOT NULL DEFAULT '13:00',
  parent_monitoring     BOOLEAN NOT NULL DEFAULT true,
  route_deviation_alert BOOLEAN NOT NULL DEFAULT true,
  max_deviation_km      NUMERIC(4,1) NOT NULL DEFAULT 2,
  contact_name          TEXT,
  contact_phone         TEXT,
  km_accumulated        NUMERIC(10,2) NOT NULL DEFAULT 0,
  bonus_kz              NUMERIC(10,2) NOT NULL DEFAULT 0,
  active                BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contracts_user ON public.contracts(user_id, active);
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contracts: own read" ON public.contracts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "contracts: own write" ON public.contracts FOR ALL USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROUTE DEVIATION ALERTS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.route_deviation_alerts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id      UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  deviation_km NUMERIC(6,2) NOT NULL,
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  alerted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.route_deviation_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deviation: read own rides" ON public.route_deviation_alerts
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid()))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- DRIVER KM BONUS TRIGGER (70km → 5km grátis)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION award_km_perk()
RETURNS TRIGGER AS $$
DECLARE
  v_km_before NUMERIC;
  v_km_after  NUMERIC;
  v_perks_before INT;
  v_perks_after  INT;
BEGIN
  v_km_before    := COALESCE(OLD.km_total, 0);
  v_km_after     := COALESCE(NEW.km_total, 0);
  v_perks_before := FLOOR(v_km_before / 70);
  v_perks_after  := FLOOR(v_km_after  / 70);

  IF v_perks_after > v_perks_before THEN
    NEW.free_km_available := COALESCE(NEW.free_km_available, 0) + (5 * (v_perks_after - v_perks_before));
  END IF;

  NEW.km_to_next_perk := 70 - MOD(v_km_after::NUMERIC, 70);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_award_km_perk ON public.profiles;
CREATE TRIGGER trg_award_km_perk
  BEFORE UPDATE OF km_total ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION award_km_perk();
