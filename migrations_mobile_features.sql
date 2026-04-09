-- ==============================================================================
-- MIGRAÇÃO ZENITH RIDE — FUNCIONALIDADES MOBILE (CHAT, PANIC, VEÍCULOS, ETC)
-- Executar no Supabase SQL Editor
-- ==============================================================================

-- 1. ATUALIZAR ENUM ride_status
-- Não falha se já existirem graças ao IF NOT EXISTS condicional para enums que o PG não tem por defeito, mas faremos o insert seguro:
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'ride_status' AND e.enumlabel = 'idle') THEN
        ALTER TYPE ride_status ADD VALUE 'idle';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'ride_status' AND e.enumlabel = 'browsing') THEN
        ALTER TYPE ride_status ADD VALUE 'browsing';
    END IF;
END
$$;

-- 2. TABELA DE MENSAGENS DO CHAT DA CORRIDA
CREATE TABLE IF NOT EXISTS public.ride_messages (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id    UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  sender_id  UUID NOT NULL REFERENCES public.users(id),
  text       TEXT NOT NULL CHECK (char_length(text) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ride_messages_ride ON public.ride_messages(ride_id, created_at);

ALTER TABLE public.ride_messages ENABLE ROW LEVEL SECURITY;

-- Política segura: Só os intervenientes da corrida podem ler/escrever
CREATE POLICY "ride_messages: participants only"
  ON public.ride_messages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_id
        AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid())
    )
  );

-- 3. TABELA DE VEÍCULOS DOS MOTORISTAS E TIPOS DE CARRO
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS vehicle_type TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS traffic_factor NUMERIC(4,2) DEFAULT 1.0;

CREATE TABLE IF NOT EXISTS public.driver_vehicles (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id    UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  vehicle_type TEXT NOT NULL DEFAULT 'standard' CHECK (vehicle_type IN ('standard','moto','comfort','xl')),
  plate_number TEXT NOT NULL DEFAULT '',
  model        TEXT,
  color        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.driver_vehicles ENABLE ROW LEVEL SECURITY;
-- Motoristas gerem os próprios veículos
CREATE POLICY "vehicles_manage_own" ON public.driver_vehicles FOR ALL USING (driver_id = auth.uid());
-- Passageiros devem conseguir ler a informação do veículo designado do motorista
CREATE POLICY "vehicles_read_public" ON public.driver_vehicles FOR SELECT USING (true);


-- 4. PRIVACIDADE E CONTACTOS NO PERFIL
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone_privacy BOOLEAN DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;

-- 5. BOTÃO DE PÂNICO
CREATE TABLE IF NOT EXISTS public.panic_alerts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES public.users(id),
  ride_id     UUID REFERENCES public.rides(id),
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  resolved    BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_panic_alerts_user ON public.panic_alerts(user_id);

ALTER TABLE public.panic_alerts ENABLE ROW LEVEL SECURITY;
-- O utilizador pode inserir os próprios alertas
CREATE POLICY "panic_insert_own" ON public.panic_alerts FOR INSERT WITH CHECK (user_id = auth.uid());
-- Apenas admins leem tudo, mas utilizador pode ler os seus (caso tenha um histórico)
CREATE POLICY "panic_read_own" ON public.panic_alerts FOR SELECT USING (user_id = auth.uid());


-- 6. GARANTIR A EXISTÊNCIA DE SCHOOL_TRACKING_SESSIONS (para o passo do Contract)
CREATE TABLE IF NOT EXISTS public.school_tracking_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contract_id UUID NOT NULL, -- fk depends on your tables, omitted for safety if simple schema
    driver_id UUID,
    public_token UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.school_tracking_sessions ENABLE ROW LEVEL SECURITY;
-- O detentor de um contrato ou admin gere. Insere.
CREATE POLICY "tracking_insert_auth" ON public.school_tracking_sessions FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
-- A leitura pode ser pública para quem tem o Token (o próprio token longo serve como autenticação)
CREATE POLICY "tracking_read_public" ON public.school_tracking_sessions FOR SELECT USING (true);
-- Atualizações do motorista
CREATE POLICY "tracking_update_auth" ON public.school_tracking_sessions FOR UPDATE USING (auth.uid() IS NOT NULL);

-- NOTA: O realtime tem de ser ativado para as tabelas necessárias:
-- execute 'ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_messages;' se não possuir uma trigger de alteração padrão.
