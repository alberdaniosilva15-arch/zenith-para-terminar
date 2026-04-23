-- =============================================================================
-- ZENITH RIDE v3.4 — SQL Setup
-- Executar no Supabase SQL Editor (na ordem)
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════
-- 1. CONTAS DE TESTE (temporário — desenvolvimento)
-- ═══════════════════════════════════════════════════════════════

-- NOTA: Para criar utilizadores com password no Supabase, use o Dashboard:
--   Authentication → Users → Add User → Email + Password
--
-- Conta Passageiro: alberdaniosilva22@gmail.com / 123456789
-- Conta Motorista:  alberdaniosilva23@gmail.com / 123456789
--
-- Se os utilizadores já existem, basta fazer reset da password no Dashboard.
-- Depois de criados, o profile é feito automaticamente pelo AuthContext.

-- 2. Garantir que o profile do motorista tem role 'driver'
-- (executar DEPOIS de criar as contas e eles fazerem primeiro login)
UPDATE profiles 
SET name = 'Motorista Teste'
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'alberdaniosilva23@gmail.com')
AND name IS NULL;

-- ═══════════════════════════════════════════════════════════════
-- 3. MENSAGENS AUTO-DESTRUTIVAS (se ainda não executado)
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE posts ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '24 hours');

-- Cron job para limpar posts expirados (requer pg_cron)
-- SELECT cron.schedule('cleanup-expired-posts', '*/15 * * * *',
--   $$DELETE FROM posts WHERE expires_at < now()$$
-- );

-- ═══════════════════════════════════════════════════════════════
-- 4. TABELA SCHEDULED_RIDES (corridas agendadas)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS scheduled_rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  pickup_address TEXT NOT NULL,
  pickup_lat DOUBLE PRECISION NOT NULL,
  pickup_lng DOUBLE PRECISION NOT NULL,
  dest_address TEXT NOT NULL,
  dest_lat DOUBLE PRECISION NOT NULL,
  dest_lng DOUBLE PRECISION NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  recurrence TEXT DEFAULT 'none',
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- 5. PREÇOS POR ZONA — BASE DE REFERÊNCIA (negociáveis via leilão)
-- NOTA: Estes preços são o preço SUGERIDO. O passageiro pode 
--       negociar (botão "Podemos negociar?") e propor preço menor.
--       Os motoristas próximos vêem a proposta e decidem aceitar.
-- ═══════════════════════════════════════════════════════════════

-- Primeiro limpar preços antigos e inserir correctos
DELETE FROM zone_prices WHERE true;

INSERT INTO zone_prices (origin_zone, dest_zone, price_kz, distance_km, active) VALUES
-- Rotas CURTAS (< 5 km) — preço base
('Centro',     'Maianga',       450,   1.5,  true),
('Centro',     'Miramar',       550,   2.0,  true),
('Centro',     'Cazenga',       850,   3.5,  true),
('Centro',     'Rangel',        750,   3.0,  true),
('Maianga',    'Miramar',       350,   1.0,  true),
('Maianga',    'Cazenga',       650,   2.5,  true),
('Maianga',    'Rangel',        550,   2.0,  true),
('Cazenga',    'Rangel',        550,   2.0,  true),
('Miramar',    'Cazenga',       750,   3.0,  true),

-- Rotas MÉDIAS (5-15 km) — preço base
('Centro',     'Samba',        1150,   5.0,  true),
('Centro',     'Benfica',      2550,  12.0,  true),
('Centro',     'Talatona',     3150,  15.0,  true),
('Maianga',    'Samba',         950,   4.0,  true),
('Maianga',    'Talatona',    2800,  13.5,  true),
('Samba',      'Talatona',    1950,   9.0,  true),
('Samba',      'Benfica',     1550,   7.0,  true),
('Cazenga',    'Samba',       1350,   6.0,  true),
('Rangel',     'Samba',        950,   4.0,  true),
('Benfica',    'Talatona',     750,   3.5,  true),

-- Rotas LONGAS (> 15 km) — preço base premium
('Centro',     'Kilamba',      5750,  18.0,  true),
('Centro',     'Viana',        4150,  20.0,  true),
('Centro',     'Luanda Norte', 3500,  16.0,  true),
('Talatona',   'Kilamba',      1350,   6.0,  true),
('Talatona',   'Viana',        4150,  20.0,  true),
('Kilamba',    'Viana',        3150,  15.0,  true),
('Maianga',    'Kilamba',      3500,  17.0,  true),
('Maianga',    'Viana',        3800,  18.5,  true),
('Cazenga',    'Kilamba',      3200,  15.5,  true),
('Cazenga',    'Viana',        2800,  13.0,  true),
('Samba',      'Kilamba',      2800,  13.0,  true),
('Samba',      'Viana',        3200,  15.0,  true),
('Benfica',    'Kilamba',      1950,   9.0,  true),
('Benfica',    'Viana',        3500,  16.5,  true),
('Rangel',     'Kilamba',      3000,  14.5,  true),
('Rangel',     'Viana',        2550,  12.0,  true);

-- ═══════════════════════════════════════════════════════════════
-- 6. TABELA PRICE_FEEDBACK (opinião do utilizador sobre preços)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS price_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  origin_zone TEXT,
  dest_zone TEXT,
  price_kz NUMERIC,
  rating TEXT CHECK (rating IN ('too_cheap', 'fair', 'expensive', 'too_expensive')),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- 7. TABELA PANIC_ALERTS (se ainda não existe)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS panic_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  ride_id UUID,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  driver_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
