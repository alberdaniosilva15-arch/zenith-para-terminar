-- ════════════════════════════════════════════════════════════════════
-- ZENITH RIDE — Migration 2.3: Colunas de Gamificação em profiles
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS km_total            NUMERIC          DEFAULT 0,
ADD COLUMN IF NOT EXISTS free_km_available   NUMERIC          DEFAULT 0,
ADD COLUMN IF NOT EXISTS km_to_next_perk     NUMERIC          DEFAULT 70,
ADD COLUMN IF NOT EXISTS last_known_lat      DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS last_known_lng      DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS user_tier           TEXT             DEFAULT 'standard'
  CHECK (user_tier IN ('new', 'standard', 'vip', 'problematic'));

COMMENT ON COLUMN public.profiles.km_total        IS 'Total km acumulados (perk a cada 70km)';
COMMENT ON COLUMN public.profiles.km_to_next_perk IS 'km restantes para próximo perk (começa em 70)';
COMMENT ON COLUMN public.profiles.user_tier       IS 'Tier do utilizador para o Engine Pro';
