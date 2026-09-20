-- =============================================================================
-- ZENITH RIDE — retenção do histórico do pg_cron
-- =============================================================================
-- Data: 2026-09-20
--
-- O PROBLEMA
-- ─────────────────────────────────────────────────────────────────────────────
-- `cron.job_run_details` guardava TODAS as execuções desde 07/04/2026 e nunca
-- era limpa. Em 20/09/2026:
--
--     377.129 linhas · 241,7 MB · 84 % da base de dados inteira
--
-- Os maiores ofensores são os jobs que correm a cada minuto:
--
--     dispatch-timeout-handler      230.183 execuções
--     timeout-searching-rides        79.968
--     cleanup-stale-drivers          23.992
--     cleanup_expired_posts          14.861
--     cleanup-expired-posts          14.859
--
-- 79.504 dessas execuções estavam em estado `failed` — informação útil, mas que
-- não precisa de ficar 5 meses.
--
-- A CORRECÇÃO
-- ─────────────────────────────────────────────────────────────────────────────
--   1. `public.purge_cron_history(p_dias)` — apaga execuções com mais de N dias;
--   2. job diário às 04:15 que a corre, com 7 dias de retenção.
--
-- ⚠️ PORQUE É QUE NÃO HÁ ÍNDICE EM `start_time`
-- ─────────────────────────────────────────────────────────────────────────────
-- A tabela só tem índice na chave primária (`runid`), por isso a poda faz
-- varrimento sequencial. Seria bom ter índice em `start_time`, mas **não é
-- possível criar**: o dono da tabela é `supabase_admin` e o papel disponível
-- (`postgres`, via CLI) não é superuser nem membro desse papel —
--
--     ERROR: 42501: must be owner of table job_run_details
--
-- Verificado: `SET ROLE supabase_admin` responde `permission denied`.
--
-- E não faz falta. Depois da primeira poda a tabela fica com ~15.000 linhas
-- (7 dias), onde um varrimento sequencial custa menos do que o próprio índice
-- a manter-se actualizado. A primeira poda, essa, varre 241 MB uma única vez —
-- alguns segundos, aceitável para uma operação de manutenção.
--
-- O papel tem `DELETE` sobre a tabela (verificado), que é o que a poda precisa.
--
-- ⚠️ O QUE NÃO SE FAZ AQUI, DE PROPÓSITO
-- ─────────────────────────────────────────────────────────────────────────────
--   • NÃO se desliga `cron.log_run`. Parava o inchaço mas perdia o registo de
--     falhas — e foi pelas falhas que descobrimos que a limpeza de áudio estava
--     partida há semanas. Poda-se, não se deixa de registar.
--   • NÃO se altera a periodicidade de nenhum job. Os que correm a cada minuto
--     correm a cada minuto porque é disso que precisam.
--   • NÃO se remove o job duplicado `cleanup-expired-posts` (que faz o mesmo
--     que `cleanup_expired_posts`). É desperdício, mas é inofensivo e não é
--     esta migração que deve decidir isso.
-- =============================================================================

-- ── 1. Função de poda ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_cron_history(p_dias INTEGER DEFAULT 7)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_apagadas INTEGER;
  v_dias     INTEGER;
BEGIN
  IF to_regclass('cron.job_run_details') IS NULL THEN
    RETURN 0;
  END IF;

  -- Nunca aceitar 0 ou negativo: isso apagaria o histórico de hoje e deixaria
  -- o operador sem forma de ver o que acabou de correr.
  v_dias := GREATEST(COALESCE(p_dias, 7), 1);

  DELETE FROM cron.job_run_details
  WHERE start_time < now() - make_interval(days => v_dias);

  GET DIAGNOSTICS v_apagadas = ROW_COUNT;
  RETURN v_apagadas;
END;
$fn$;

COMMENT ON FUNCTION public.purge_cron_history(INTEGER) IS
  'Apaga execucoes do pg_cron com mais de N dias (minimo 1). Devolve quantas apagou. Corre diariamente pelo job purge_cron_history_daily.';

-- Só o cron (que corre como owner do job) deve poder chamar isto.
REVOKE ALL ON FUNCTION public.purge_cron_history(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_cron_history(INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.purge_cron_history(INTEGER) FROM authenticated;

-- ── 2. Job diário ────────────────────────────────────────────────────────────
DO $job$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron ausente — job de retencao nao criado.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge_cron_history_daily') THEN
    PERFORM cron.unschedule('purge_cron_history_daily');
    RAISE NOTICE 'job purge_cron_history_daily substituido';
  END IF;

  -- 04:15 — depois das limpezas da noite (00:00 ai_logs, 03:00 audio/cache,
  -- 03:30 track_points), para que o histórico dessas execuções ainda exista
  -- quando este job corre. Se corresse antes delas, apagava a prova do dia.
  PERFORM cron.schedule(
    'purge_cron_history_daily',
    '15 4 * * *',
    'SELECT public.purge_cron_history(7)'
  );

  RAISE NOTICE 'job purge_cron_history_daily criado (04:15, retencao 7 dias)';
END
$job$;
