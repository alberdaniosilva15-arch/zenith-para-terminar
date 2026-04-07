-- =============================================================================
-- ZENITH RIDE v3.1 — Migration: driver_notifications
-- Substitui o broadcast Supabase que se perdia quando o motorista estava offline
-- Executar no Supabase SQL Editor
-- =============================================================================

-- 1. Criar tabela de notificações persistentes
CREATE TABLE IF NOT EXISTS public.driver_notifications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ride_id    UUID        NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  type       TEXT        NOT NULL DEFAULT 'new_ride'
               CHECK (type IN ('new_ride', 'ride_cancelled', 'system')),
  payload    JSONB       NOT NULL DEFAULT '{}',
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Índices para performance (motorista lê as suas notificações não lidas)
CREATE INDEX IF NOT EXISTS idx_driver_notifs_driver_unread
  ON public.driver_notifications(driver_id, read_at)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_driver_notifs_ride
  ON public.driver_notifications(ride_id);

CREATE INDEX IF NOT EXISTS idx_driver_notifs_created
  ON public.driver_notifications(created_at DESC);

-- 3. Activar RLS
ALTER TABLE public.driver_notifications ENABLE ROW LEVEL SECURITY;

-- 4. Políticas RLS

-- Motorista vê APENAS as suas próprias notificações
DROP POLICY IF EXISTS "driver_notifs_select_own" ON public.driver_notifications;
CREATE POLICY "driver_notifs_select_own"
  ON public.driver_notifications
  FOR SELECT
  USING (driver_id = auth.uid());

-- Motorista pode marcar as suas notificações como lidas (UPDATE read_at)
DROP POLICY IF EXISTS "driver_notifs_update_own" ON public.driver_notifications;
CREATE POLICY "driver_notifs_update_own"
  ON public.driver_notifications
  FOR UPDATE
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());

-- Sistema (service role) pode inserir notificações para qualquer motorista
-- O INSERT vem da Edge Function match-driver que usa SERVICE_ROLE_KEY
DROP POLICY IF EXISTS "driver_notifs_insert_system" ON public.driver_notifications;
CREATE POLICY "driver_notifs_insert_system"
  ON public.driver_notifications
  FOR INSERT
  WITH CHECK (true); -- Protegido ao nível da Edge Function (service role only)

-- 5. Activar Realtime para que DriverHome receba INSERT imediatamente
ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_notifications;

-- 6. Limpeza automática — apagar notificações lidas com mais de 7 dias
-- (Opcional: executar via pg_cron se disponível no plano Supabase)
-- SELECT cron.schedule(
--   'clean-driver-notifications',
--   '0 3 * * *',
--   $$DELETE FROM public.driver_notifications WHERE read_at < now() - interval '7 days'$$
-- );

-- Verificação
SELECT 'driver_notifications criada com sucesso' AS status;
SELECT COUNT(*) AS total_notificacoes FROM public.driver_notifications;
