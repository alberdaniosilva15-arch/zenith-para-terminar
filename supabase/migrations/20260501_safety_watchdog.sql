-- =============================================================================
-- ZENITH RIDE — Migração: Safety Watchdog + pg_cron
-- Tabela para registar alertas enviados (evitar spam)
-- Cron job a cada 1 hora para verificar corridas >4h
-- =============================================================================

-- ── Tabela de alertas do Safety Watchdog ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.safety_watchdog_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id         UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  passenger_id    UUID NOT NULL,
  driver_id       UUID,
  alerted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  emergency_phone_notified TEXT,
  resolved        BOOLEAN NOT NULL DEFAULT false,
  resolved_at     TIMESTAMPTZ,
  notes           TEXT
);

-- Índice para evitar alertas duplicados (1 alerta por corrida)
CREATE UNIQUE INDEX IF NOT EXISTS idx_watchdog_ride_unique 
  ON public.safety_watchdog_alerts(ride_id);

-- Índice para queries do admin
CREATE INDEX IF NOT EXISTS idx_watchdog_alerted_at 
  ON public.safety_watchdog_alerts(alerted_at DESC);

-- RLS: Apenas service_role pode ler/escrever (Edge Function)
ALTER TABLE public.safety_watchdog_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON public.safety_watchdog_alerts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Admin pode ler e resolver
CREATE POLICY "admin_read_resolve" ON public.safety_watchdog_alerts
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  );

-- ── pg_cron: Safety Watchdog a cada 1 hora ───────────────────────────────────
-- NOTA: pg_cron + pg_net precisam estar activados no Supabase Dashboard:
--   Database → Extensions → Activar "pg_cron" e "pg_net"
--
-- Após activar as extensões, executar este SELECT:

SELECT cron.schedule(
  'safety-watchdog-hourly',
  '0 * * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.settings.supabase_url', true) || '/functions/v1/safety-watchdog',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);

-- ── Cache de respostas IA (para poupar tokens em escala) ─────────────────────
CREATE TABLE IF NOT EXISTS public.ai_response_cache (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action          TEXT NOT NULL,
  prompt_hash     TEXT NOT NULL,
  response_text   TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 hour'),
  hit_count       INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_cache_lookup 
  ON public.ai_response_cache(action, prompt_hash);

CREATE INDEX IF NOT EXISTS idx_ai_cache_expiry 
  ON public.ai_response_cache(expires_at);

-- Limpar cache expirado automaticamente (1x por dia)
SELECT cron.schedule(
  'cleanup-ai-cache-daily',
  '0 3 * * *',
  $$DELETE FROM public.ai_response_cache WHERE expires_at < now()$$
);

-- RLS: Apenas service_role
ALTER TABLE public.ai_response_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON public.ai_response_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);
