-- ═══════════════════════════════════════════════════════════════
-- CORRECÇÃO: 5 tabelas em falta + 4 tabelas sem policies
-- Zenith Ride v3.1 — 2026-05-04
-- Cola TUDO no SQL Editor do Supabase e executa de uma vez.
-- ═══════════════════════════════════════════════════════════════


-- ┌─────────────────────────────────────────────────────────────┐
-- │ 1. admin_knowledge (CRÍTICO — Kaze memory/save_memory)     │
-- └─────────────────────────────────────────────────────────────┘
CREATE TABLE IF NOT EXISTS public.admin_knowledge (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key        TEXT NOT NULL UNIQUE,
  value      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.admin_knowledge ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access knowledge"
  ON public.admin_knowledge FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Service role bypass knowledge"
  ON public.admin_knowledge FOR ALL
  USING (true)
  WITH CHECK (true);
-- Nota: service_role já bypassa RLS, esta policy é redundante mas segura.


-- ┌─────────────────────────────────────────────────────────────┐
-- │ 2. app_settings (CRM Settings page)                        │
-- └─────────────────────────────────────────────────────────────┘
CREATE TABLE IF NOT EXISTS public.app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.app_settings (key, value) VALUES
  ('matching_radius_km', '7'::jsonb),
  ('matching_expansion', 'true'::jsonb),
  ('max_searching_minutes', '5'::jsonb),
  ('notif_expiry_minutes', '5'::jsonb),
  ('max_drivers_to_notify', '3'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins controlam configuracoes"
  ON public.app_settings FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Todos podem ler configuracoes"
  ON public.app_settings FOR SELECT USING (true);


-- ┌─────────────────────────────────────────────────────────────┐
-- │ 3. motogo_scores (Zenith Score dos motoristas)             │
-- └─────────────────────────────────────────────────────────────┘
CREATE TABLE IF NOT EXISTS public.motogo_scores (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

CREATE POLICY "score: driver le o proprio"
  ON public.motogo_scores FOR SELECT
  USING (auth.uid() = driver_id);

CREATE POLICY "score: admin le todos"
  ON public.motogo_scores FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));


-- ┌─────────────────────────────────────────────────────────────┐
-- │ 4. pending_payments (Multicaixa Pay)                       │
-- └─────────────────────────────────────────────────────────────┘
CREATE TABLE IF NOT EXISTS public.pending_payments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference        TEXT NOT NULL UNIQUE,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount           NUMERIC(12,2) NOT NULL,
  phone_number     TEXT,
  provider         TEXT NOT NULL DEFAULT 'multicaixa',
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','confirmed','failed','cancelled')),
  provider_payload JSONB,
  callback_payload JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_payments_user
  ON public.pending_payments(user_id, status);
CREATE INDEX IF NOT EXISTS idx_pending_payments_ref
  ON public.pending_payments(reference);

ALTER TABLE public.pending_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "User le os seus pagamentos"
  ON public.pending_payments FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "User pode inserir pagamentos"
  ON public.pending_payments FOR INSERT
  WITH CHECK (auth.uid() = user_id);
-- Nota: updates e callbacks são feitos via service_role na Edge Function.


-- ┌─────────────────────────────────────────────────────────────┐
-- │ 5. zone_surge_overrides (Pricing Engine — surge manual)    │
-- └─────────────────────────────────────────────────────────────┘
CREATE TABLE IF NOT EXISTS public.zone_surge_overrides (
  zone       TEXT PRIMARY KEY,
  multiplier NUMERIC NOT NULL DEFAULT 1.0,
  active     BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.zone_surge_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins controlam surge"
  ON public.zone_surge_overrides FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Todos podem ler surges ativos"
  ON public.zone_surge_overrides FOR SELECT USING (true);


-- ┌─────────────────────────────────────────────────────────────┐
-- │ 6. CORRIGIR: Tabelas com RLS ON mas 0 policies             │
-- │    (dados estão trancados — ninguém consegue aceder)        │
-- └─────────────────────────────────────────────────────────────┘

-- demand_heatmap: leitura pública, escrita admin
CREATE POLICY "heatmap: leitura publica"
  ON public.demand_heatmap FOR SELECT USING (true);
CREATE POLICY "heatmap: admin write"
  ON public.demand_heatmap FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- ip_rate_limits: apenas service_role (Edge Functions) — desligar RLS
ALTER TABLE public.ip_rate_limits DISABLE ROW LEVEL SECURITY;

-- pricing_config: leitura pública, escrita admin
CREATE POLICY "pricing: leitura publica"
  ON public.pricing_config FOR SELECT USING (true);
CREATE POLICY "pricing: admin write"
  ON public.pricing_config FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- tenants: apenas admins
CREATE POLICY "tenants: admin full"
  ON public.tenants FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));


-- ═══════════════════════════════════════════════════════════════
-- FIM — Após executar, corre o diagnostico_tabelas.sql de novo
-- para confirmar que tudo ficou ✅ EXISTE com policies > 0.
-- ═══════════════════════════════════════════════════════════════
