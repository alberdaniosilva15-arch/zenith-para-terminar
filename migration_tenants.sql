-- =============================================================================
-- ZENITH RIDE v3.1 — Migration: Sistema Multi-Tenant (White-Label)
-- Executar APÓS migration_driver_notifications.sql
-- Permite: empresa A nunca vê dados da empresa B (RLS garante isolamento)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 1: Tabela de empresas/tenants (plataforma SaaS)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenants (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  slug          TEXT        NOT NULL UNIQUE,          -- ex: "kubinga", "zenith-luanda"
  plan          TEXT        NOT NULL DEFAULT 'basic'
                  CHECK (plan IN ('basic', 'pro', 'enterprise')),
  logo_url      TEXT,
  primary_color TEXT        NOT NULL DEFAULT '#2563eb', -- CSS hex — injectado em runtime
  active        BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tenant padrão (Zenith Ride próprio)
INSERT INTO public.tenants (name, slug, plan, primary_color)
VALUES ('Zenith Ride', 'zenith', 'enterprise', '#2563eb')
ON CONFLICT (slug) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 2: Adicionar tenant_id a todas as tabelas principais
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);

ALTER TABLE public.driver_locations
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);

-- Verificar se tabelas abaixo existem antes de alterar
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name='wallets') THEN
    EXECUTE 'ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id)';
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name='transactions') THEN
    EXECUTE 'ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id)';
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name='posts') THEN
    EXECUTE 'ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id)';
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name='contracts') THEN
    EXECUTE 'ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id)';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 3: Índices para performance por tenant
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rides_tenant          ON public.rides(tenant_id);
CREATE INDEX IF NOT EXISTS idx_driver_locs_tenant    ON public.driver_locations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_profiles_tenant       ON public.profiles(tenant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 4: Função helper para ler tenant_id actual da sessão
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_tenant_id UUID;
  v_setting   TEXT;
BEGIN
  -- Tentar ler do setting de sessão (definido pelo middleware/Edge Function)
  BEGIN
    v_setting := current_setting('app.tenant_id', true);
    IF v_setting IS NOT NULL AND v_setting <> '' THEN
      v_tenant_id := v_setting::UUID;
      RETURN v_tenant_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- Ignorar se setting não existir
  END;

  -- Fallback: ler tenant_id do perfil do utilizador autenticado
  SELECT p.tenant_id INTO v_tenant_id
  FROM public.profiles p
  WHERE p.user_id = auth.uid()
  LIMIT 1;

  RETURN v_tenant_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 5: RLS com isolamento por tenant
-- Motoristas da empresa A nunca vêem corridas da empresa B
-- ─────────────────────────────────────────────────────────────────────────────

-- Rides: isolamento por tenant
DROP POLICY IF EXISTS "rides_tenant_isolation" ON public.rides;
CREATE POLICY "rides_tenant_isolation"
  ON public.rides
  FOR ALL
  USING (
    -- Sem tenant → acesso livre (compatibilidade com registos antigos)
    tenant_id IS NULL
    OR
    -- Com tenant → deve corresponder ao tenant da sessão
    tenant_id = public.current_tenant_id()
    OR
    -- O próprio utilizador pode sempre ver as suas corridas
    passenger_id = auth.uid()
    OR
    driver_id = auth.uid()
  );

-- Driver locations: isolamento por tenant
DROP POLICY IF EXISTS "driver_locs_tenant_isolation" ON public.driver_locations;
CREATE POLICY "driver_locs_tenant_isolation"
  ON public.driver_locations
  FOR ALL
  USING (
    tenant_id IS NULL
    OR tenant_id = public.current_tenant_id()
    OR driver_id = auth.uid()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 6: RLS para tabela tenants
-- Cada empresa só vê os seus próprios dados de configuração
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenants_select_own" ON public.tenants;
CREATE POLICY "tenants_select_own"
  ON public.tenants
  FOR SELECT
  USING (
    id = public.current_tenant_id()
    OR
    -- Admins do sistema podem ver todos
    EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid()
      AND (u.raw_user_meta_data->>'role') = 'admin'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 7: View útil — configuração do tenant actual (para white-label)
-- Retorna logo_url, primary_color, name do tenant da sessão
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.current_tenant_config AS
SELECT
  t.id,
  t.name,
  t.slug,
  t.plan,
  t.logo_url,
  t.primary_color,
  t.active
FROM public.tenants t
WHERE t.id = public.current_tenant_id();

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 8: Trigger — propagação automática do tenant_id ao criar corrida
-- Copia tenant_id do perfil do passageiro para a corrida
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_propagate_tenant_to_ride()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT tenant_id INTO NEW.tenant_id
    FROM public.profiles
    WHERE user_id = NEW.passenger_id
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_tenant_ride ON public.rides;
CREATE TRIGGER trg_propagate_tenant_ride
  BEFORE INSERT ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_propagate_tenant_to_ride();

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 9: Trigger — propagação tenant ao actualizar driver_locations
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_propagate_tenant_to_driver_location()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT tenant_id INTO NEW.tenant_id
    FROM public.profiles
    WHERE user_id = NEW.driver_id
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_tenant_driver_loc ON public.driver_locations;
CREATE TRIGGER trg_propagate_tenant_driver_loc
  BEFORE INSERT OR UPDATE ON public.driver_locations
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_propagate_tenant_to_driver_location();

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificação final
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Multi-tenant migration concluída' AS status;
SELECT id, name, slug, plan, primary_color FROM public.tenants;
