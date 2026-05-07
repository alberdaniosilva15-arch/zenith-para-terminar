-- Tabelas para o bot (message dedup, rate limit, memory, profiles, elevenlabs usage)
CREATE TABLE IF NOT EXISTS message_dedup (
  id BIGSERIAL PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rate_limit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  message_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_memory (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT,
  role TEXT NOT NULL,
  content TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_profiles (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  display_name TEXT,
  username TEXT,
  email TEXT,
  language TEXT DEFAULT 'pt',
  preferences JSONB DEFAULT '{}',
  known_facts JSONB DEFAULT '[]',
  total_messages INT DEFAULT 0,
  channel TEXT,
  last_interaction TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS elevenlabs_usage (
  id BIGSERIAL PRIMARY KEY,
  month TEXT NOT NULL UNIQUE,
  chars_used INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Função RPC para incrementar mensagens
CREATE OR REPLACE FUNCTION increment_messages(p_user_id TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE user_profiles SET total_messages = total_messages + 1 WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- Tabela de sessões WhatsApp
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES auth.users(id),
  state TEXT NOT NULL DEFAULT 'IDLE',
  origin_address TEXT,
  origin_lat DOUBLE PRECISION,
  origin_lng DOUBLE PRECISION,
  dest_address TEXT,
  dest_lat DOUBLE PRECISION,
  dest_lng DOUBLE PRECISION,
  ride_id UUID,
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Cache de geocoding
CREATE TABLE IF NOT EXISTS geocoding_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  query_text TEXT NOT NULL UNIQUE,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  full_address TEXT,
  source TEXT DEFAULT 'mapbox',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS para tabelas do bot (permitir acesso via anon key para o n8n)
ALTER TABLE message_dedup ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE elevenlabs_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE geocoding_cache ENABLE ROW LEVEL SECURITY;

-- Policies para anon (o bot n8n usa anon key)
CREATE POLICY "anon_all" ON message_dedup FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON rate_limit_log FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON conversation_memory FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON user_profiles FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON elevenlabs_usage FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON whatsapp_sessions FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all" ON geocoding_cache FOR ALL TO service_role USING (true);

-- Limpeza automática de dedup (manter apenas 24h)
CREATE INDEX IF NOT EXISTS idx_dedup_created ON message_dedup(created_at);
CREATE INDEX IF NOT EXISTS idx_rate_limit_created ON rate_limit_log(created_at, user_id);
CREATE INDEX IF NOT EXISTS idx_memory_user ON conversation_memory(user_id, created_at DESC);
