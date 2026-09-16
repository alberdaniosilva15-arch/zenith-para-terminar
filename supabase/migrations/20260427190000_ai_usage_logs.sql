-- =============================================================================
-- ZENITH RIDE v3.3 — Migração de Auditoria e Rate Limiting de IA (ai_usage_logs)
-- Ficheiro: supabase/migrations/20260427190000_ai_usage_logs.sql
--
-- Regista todas as invocações das Edge Functions (gemini-proxy, calculate-price, admin-ai-proxy)
-- com granularidade por utilizador, ação, custo estimado, tokens e eventuais erros.
-- Idempotente: adapta-se tanto a bases novas como a tabelas existentes com user_id uuid.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        TEXT NOT NULL,
  action         TEXT NOT NULL,
  tokens_used    INTEGER DEFAULT 0,
  estimated_cost NUMERIC(10, 6) DEFAULT 0,
  error_returned TEXT,
  request_count  INTEGER DEFAULT 1,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- Garantir colunas adicionais caso a tabela já existisse
ALTER TABLE public.ai_usage_logs
  ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC(10, 6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_returned TEXT,
  ADD COLUMN IF NOT EXISTS request_count  INTEGER DEFAULT 1;

-- Converter user_id para TEXT se for UUID (permite registar 'anonymous' em falhas de auth)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_usage_logs'
      AND column_name = 'user_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE public.ai_usage_logs ALTER COLUMN user_id TYPE TEXT;
  END IF;
END $$;

-- Índices de alta performance para rate limiting com sliding window
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_user_action_time
  ON public.ai_usage_logs (user_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created_at
  ON public.ai_usage_logs (created_at DESC);

-- RLS
ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own ai usage" ON public.ai_usage_logs;
CREATE POLICY "Users can read own ai usage"
  ON public.ai_usage_logs
  FOR SELECT
  TO authenticated
  USING (user_id::text = auth.uid()::text);

DROP POLICY IF EXISTS "Service role full access to ai_usage_logs" ON public.ai_usage_logs;
CREATE POLICY "Service role full access to ai_usage_logs"
  ON public.ai_usage_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
