-- =============================================================================
-- ZENITH RIDE v3.1 — Migration: CRM SaaS & Settings
-- Tabelas auxiliares para o funcionamento completo do Painel CRM
-- =============================================================================

-- 1. Tabela para overrides manuais de Surge por Zona (Pricing Engine)
CREATE TABLE IF NOT EXISTS public.zone_surge_overrides (
  zone       TEXT PRIMARY KEY,
  multiplier NUMERIC NOT NULL DEFAULT 1.0,
  active     BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Habilitar Realtime para actualizações de pricing mais rápidas (opcional)
ALTER PUBLICATION supabase_realtime ADD TABLE zone_surge_overrides;

-- 2. Tabela de configurações globais da plataforma (Settings)
CREATE TABLE IF NOT EXISTS public.app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Inserir os parâmetros padrão da aplicação
INSERT INTO public.app_settings (key, value) VALUES 
  ('matching_radius_km', '7'::jsonb),
  ('matching_expansion', 'true'::jsonb),
  ('max_searching_minutes', '5'::jsonb),
  ('notif_expiry_minutes', '5'::jsonb),
  ('max_drivers_to_notify', '3'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- POLÍTICAS RLS (Row Level Security)
-- Apenas utilizadores com role = 'admin' podem mexer nestas tabelas
-- =============================================================================

ALTER TABLE public.zone_surge_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- zone_surge_overrides
CREATE POLICY "Admins controlam surge" ON public.zone_surge_overrides 
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );

-- No entanto, a base de dados em leitura (para as funções de backend RPC) bypassa o RLS
-- se for chamada por uma função SECURITY DEFINER. Mas por precaução, vamos permitir
-- aos passageiros e motoristas a leitura do surge da sua zona atual.
CREATE POLICY "Todos podem ler surges ativos" ON public.zone_surge_overrides
  FOR SELECT USING (true);


-- app_settings
CREATE POLICY "Admins controlam configuracoes" ON public.app_settings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );

CREATE POLICY "Todos podem ler configuracoes" ON public.app_settings
  FOR SELECT USING (true);

-- =============================================================================
-- FIM DA MIGRATION
-- =============================================================================
