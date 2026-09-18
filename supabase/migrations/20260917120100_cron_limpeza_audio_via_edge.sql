-- =============================================================================
-- ZENITH RIDE — o cron da limpeza de áudio passa a tocar a campainha
-- =============================================================================
-- Data: 2026-09-17
--
-- O job `limpeza_diaria_audio` chamava `SELECT public.delete_old_panic_audio()`,
-- que apagava directamente de `storage.objects` — bloqueado pelo Supabase.
-- Falhava todos os dias às 03:00.
--
-- Agora o job faz o mesmo que os outros: lê o segredo do Vault e chama o Edge
-- Function `sos-escalation` com `?tarefa=limpar-audio`. O Postgres deixa de
-- tentar pensar; a limpeza acontece onde a Storage API está disponível.
--
-- A função SQL antiga é REMOVIDA — deixá-la ficar era manter uma armadilha
-- armada para quem a chamasse a seguir.
-- =============================================================================

DO $$
DECLARE
  v_segredo TEXT;
BEGIN
  -- ── 1. Desligar o job antigo (o que chamava a função SQL) ────────────────
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'limpeza_diaria_audio') THEN
    PERFORM cron.unschedule('limpeza_diaria_audio');
    RAISE NOTICE 'job antigo limpeza_diaria_audio removido';
  END IF;

  -- ── 2. Ler o segredo do Vault ────────────────────────────────────────────
  SELECT decrypted_secret INTO v_segredo
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;

  IF v_segredo IS NULL OR v_segredo = '' THEN
    RAISE EXCEPTION 'Segredo cron_secret em falta no Vault — a limpeza de audio nao pode ser accionada';
  END IF;

  -- ── 3. Criar o job novo: diário às 03:00, via pg_net ─────────────────────
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'limpeza_audio_panico') THEN
    PERFORM cron.schedule(
      'limpeza_audio_panico',
      '0 3 * * *',
      format(
        $cmd$
        SELECT net.http_post(
          url     := 'https://mhahnhnsaquqgqvnnwld.supabase.co/functions/v1/sos-escalation?tarefa=limpar-audio',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', %L),
          body    := '{}'::jsonb,
          timeout_milliseconds := 30000
        );
        $cmd$,
        v_segredo
      )
    );
    RAISE NOTICE 'job limpeza_audio_panico criado (diario as 03:00)';
  ELSE
    RAISE NOTICE 'job limpeza_audio_panico ja existia';
  END IF;
END;
$$;

-- ── 4. Remover a função SQL que apagava directamente do storage ─────────────
-- Já não é chamada por ninguém e não pode voltar a ser: apontar uma função a
-- `storage.objects` é exactamente o erro que esta migração corrige.
DROP FUNCTION IF EXISTS public.delete_old_panic_audio();
