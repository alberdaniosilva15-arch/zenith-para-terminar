-- ═══════════════════════════════════════════════════════════════
-- BLOCO 5: Schema — Contratos Premium, Multi-Stop, Pass, Business
-- Zenith Ride v4.0 — 2026-05-05
-- ═══════════════════════════════════════════════════════════════

-- 1. CONTRATOS PREMIUM — novas colunas
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS monthly_credit_kz NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_remaining_kz NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_pct NUMERIC(4,2) DEFAULT 25,
  ADD COLUMN IF NOT EXISTS billing_day INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending'
    CHECK (payment_status IN ('active','expired','pending'));

-- 2. MULTI-STOP — novas colunas em rides
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS extra_passengers INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_drop_address TEXT,
  ADD COLUMN IF NOT EXISTS extra_drop_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS extra_drop_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS extra_drop_fee_kz NUMERIC(10,2) DEFAULT 500;

-- 3. ZENITH PASS — novas colunas em profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS has_pass BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pass_rides_remaining INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pass_expires_at TIMESTAMPTZ;

-- 4. ZENITH BUSINESS — conta empresarial
CREATE TABLE IF NOT EXISTS public.business_accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  nif         TEXT UNIQUE,
  admin_user  UUID REFERENCES auth.users(id),
  monthly_budget_kz NUMERIC(14,2) DEFAULT 0,
  spent_this_month  NUMERIC(14,2) DEFAULT 0,
  billing_email     TEXT,
  active      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.business_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "business: admin full" ON public.business_accounts
  FOR ALL USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "business: own admin" ON public.business_accounts
  FOR SELECT USING (admin_user = auth.uid());

-- Ligação empresa ↔ funcionários
CREATE TABLE IF NOT EXISTS public.business_employees (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES public.business_accounts(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  monthly_limit_kz NUMERIC(12,2) DEFAULT 50000,
  spent_kz      NUMERIC(12,2) DEFAULT 0,
  active        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id, user_id)
);

ALTER TABLE public.business_employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "employees: admin full" ON public.business_employees
  FOR ALL USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "employees: business admin" ON public.business_employees
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.business_accounts ba
    WHERE ba.id = business_id AND ba.admin_user = auth.uid()
  ));
CREATE POLICY "employees: own read" ON public.business_employees
  FOR SELECT USING (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════
-- FIM — Cola no SQL Editor do Supabase e executa
-- ═══════════════════════════════════════════════════════════════
