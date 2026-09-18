-- =============================================================================
-- ZENITH RIDE — limpeza do áudio de pânico passa a funcionar
-- =============================================================================
-- Data: 2026-09-17
--
-- O PROBLEMA
-- ─────────────────────────────────────────────────────────────────────────────
-- O job de cron `limpeza_diaria_audio` (03:00, todos os dias) chama
-- `delete_old_panic_audio()`, que faz:
--
--     DELETE FROM storage.objects WHERE bucket_id = 'panic-audio' AND ...
--
-- O Supabase bloqueia isto por desenho — há um trigger que impede escrita
-- directa nas tabelas de storage:
--
--     ERROR: Direct deletion from storage tables is not allowed. Use the Storage API
--
-- Resultado: o job falha TODOS os dias (confirmado em cron.job_run_details a
-- partir de 13/Set, e provavelmente antes). O áudio de emergência acumula no
-- bucket para sempre. Isto não é só uma questão de espaço: são gravações de
-- áudio de pessoas em situações de perigo, guardadas indefinidamente sem
-- ninguém as olhar.
--
-- A CORRECÇÃO
-- ─────────────────────────────────────────────────────────────────────────────
-- A limpeza passa a ser feita pelo Edge Function `sos-escalation`, que já tem a
-- chave de serviço e pode usar a Storage API como deve ser. O cron deixa de
-- chamar SQL e passa a tocar a campainha (pg_net), como todo o resto.
--
-- Esta migração só acrescenta o ESTADO que falta:
--   • `audio_purged_at` — quando é que a gravação foi apagada do storage.
--
-- Porque é que esta coluna é necessária: ao apagar, `audio_storage_path` fica a
-- NULL. Sem mais nada, um alerta cuja gravação foi purgada aos 7 dias ficava
-- indistinguível de um alerta que nunca teve gravação nenhuma. Num registo de
-- incidente de segurança, "houve prova e foi apagada no prazo" e "nunca houve
-- prova" são coisas diferentes.
-- =============================================================================

ALTER TABLE public.panic_alerts
  ADD COLUMN IF NOT EXISTS audio_purged_at TIMESTAMPTZ;

COMMENT ON COLUMN public.panic_alerts.audio_purged_at IS
  'Quando a gravação foi apagada do storage (retenção de 7 dias). NULL + audio_storage_path NULL = nunca houve gravação.';

-- Índice para a consulta da limpeza: "que gravações antigas ainda existem".
CREATE INDEX IF NOT EXISTS idx_panic_alerts_audio_por_purgar
  ON public.panic_alerts (created_at)
  WHERE audio_storage_path IS NOT NULL AND audio_purged_at IS NULL;
