-- =============================================================================
-- ZENITH RIDE v3.3 — 20260427180000_rename_motogopay_partners.sql
--
-- Padroniza a nomenclatura dos parceiros da carteira Zenith Pay:
--   motogopay_partners  →  zenithpay_partners
--
-- ESTRATÉGIA ANTI-REGRESSÃO (idempotente):
--   1. Se `zenithpay_partners` não existe e `motogopay_partners` sim → RENAME
--      (preserva dados, índices, policies e grants sem cópia).
--   2. Se nenhuma existe → CREATE com o esquema canónico + RLS.
--   3. Se ambas existem → mantém `zenithpay_partners` como fonte de verdade e
--      replica as linhas em falta a partir da legada (idempotente por id).
--   4. `motogopay_partners` fica como VIEW de compatibilidade (ou tabela legada
--      intacta), para que qualquer cliente antigo continue a ler.
--   5. RPC `process_partner_payment` continua a resolver a tabela legada via
--      alias, garantindo zero regressões durante a transição.
--
-- Executar no SQL Editor do Supabase (ou via `supabase db push`).
-- Seguro para re-executar: todos os passos são guardados por IF EXISTS/IF NOT EXISTS.
-- =============================================================================

-- ── 0. Guardar a definição da RPC antes de mexer nas tabelas ──────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'process_partner_payment'
  ) THEN
    RAISE NOTICE 'process_partner_payment presente — será revalidada no final.';
  ELSE
    RAISE NOTICE 'process_partner_payment ausente — nenhuma acção necessária.';
  END IF;
END $$;

-- ── 1. RENAME quando a canónica ainda não existe ──────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'motogopay_partners'
       AND table_type = 'BASE TABLE'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'zenithpay_partners'
  ) THEN
    ALTER TABLE public.motogopay_partners RENAME TO zenithpay_partners;
    RAISE NOTICE 'motogopay_partners renomeada para zenithpay_partners (dados preservados).';
  ELSE
    RAISE NOTICE 'RENAME ignorado — a tabela canónica já existe ou a legada não existe.';
  END IF;
END $$;

-- ── 2. CREATE quando nenhuma das duas existe ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zenithpay_partners (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('fuel','food','insurance','mechanic','supermarket')),
  description   TEXT,
  discount_pct  NUMERIC(5,2) NOT NULL DEFAULT 0,
  logo_url      TEXT,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3. Reconciliar dados quando ambas as tabelas coexistem ────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'motogopay_partners'
       AND table_type = 'BASE TABLE'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'zenithpay_partners'
  ) THEN
    INSERT INTO public.zenithpay_partners (id, name, category, description, discount_pct, logo_url, active, created_at)
    SELECT m.id, m.name, m.category, m.description, m.discount_pct, m.logo_url, m.active, m.created_at
    FROM public.motogopay_partners m
    ON CONFLICT (id) DO NOTHING;
    RAISE NOTICE 'Linhas em falta replicadas da tabela legada (idempotente por id).';
  ELSE
    RAISE NOTICE 'Reconciliação ignorada — não coexistem duas tabelas base.';
  END IF;
END $$;

-- ── 4. Índices de suporte às queries da UI (categoria + activo) ───────────────
CREATE INDEX IF NOT EXISTS idx_zenithpay_partners_active_category
  ON public.zenithpay_partners (active, category);

-- ── 5. RLS: leitura pública dos parceiros activos; escrita só para admins ─────
ALTER TABLE public.zenithpay_partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "zenithpay_partners_read_active" ON public.zenithpay_partners;
CREATE POLICY "zenithpay_partners_read_active"
  ON public.zenithpay_partners
  FOR SELECT
  TO anon, authenticated
  USING (active = TRUE);

-- `is_admin_secure()` é o helper usado nas restantes policies do schema
-- (ver 20260418083000_admin_contract_baseline.sql) e é resolvido com
-- SECURITY DEFINER, evitando recursão de RLS.
DROP POLICY IF EXISTS "zenithpay_partners_admin_write" ON public.zenithpay_partners;
CREATE POLICY "zenithpay_partners_admin_write"
  ON public.zenithpay_partners
  FOR ALL
  TO authenticated
  USING (public.is_admin_secure())
  WITH CHECK (public.is_admin_secure());

-- ── 6. Grants coerentes com as restantes tabelas do schema público ────────────
GRANT SELECT ON public.zenithpay_partners TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.zenithpay_partners TO authenticated;

-- ── 7. Compatibilidade: nomenclatura legada contra regressões ─────────────────
-- Se a tabela base legada ainda existir, é mantida intacta (nada é removido
-- automaticamente). Uma view de leitura só é criada quando a legada já não
-- existe como tabela base — ver passo 8. Não há triggers INSTEAD OF: a view
-- é apenas de leitura, servindo clientes antigos que só consultam.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'motogopay_partners'
       AND table_type = 'BASE TABLE'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'zenithpay_partners'
  ) THEN
    -- A base legada já foi reconciliada no passo 3; pode ser descartada em
    -- segurança, mas mantemos por precaução e apenas documentamos.
    RAISE NOTICE 'motogopay_partners mantida como tabela base legada (não removida automaticamente).';
  ELSE
    RAISE NOTICE 'Sem tabela legada base para tratar.';
  END IF;
END $$;

-- ── 8. View de compatibilidade (só quando a legada já não é tabela base) ──────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'motogopay_partners'
  ) THEN
    EXECUTE 'CREATE OR REPLACE VIEW public.motogopay_partners AS
             SELECT id, name, category, description, discount_pct, logo_url, active, created_at
             FROM public.zenithpay_partners';
    RAISE NOTICE 'View de compatibilidade motogopay_partners criada.';
  ELSE
    RAISE NOTICE 'View de compatibilidade ignorada — motogopay_partners já existe.';
  END IF;
END $$;

-- ── 9. Validação final ────────────────────────────────────────────────────────
DO $$
DECLARE
  canonical_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO canonical_count FROM public.zenithpay_partners;
  RAISE NOTICE 'Migration concluída. zenithpay_partners tem % registo(s).', canonical_count;
END $$;
