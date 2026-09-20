-- =============================================================================
-- ZENITH RIDE — retenção das conversas do bot
-- =============================================================================
-- Data: 2026-09-20
--
-- PEDIDO DO DÁNIO
-- ─────────────────────────────────────────────────────────────────────────────
-- "para não enchermos a base de dados ele guarda a última corrida ou sessão de
--  quem fez mas apaga do resto"
--
-- CONTEXTO — porque é que isto faz falta AGORA
-- ─────────────────────────────────────────────────────────────────────────────
-- A partir de hoje o webhook expira sessões por inactividade (30 min) e
-- REAPROVEITA a mesma linha, para haver uma só por telefone. Mas um telefone que
-- nunca mais volta deixaria a sua linha em 'idle' para sempre. Isto apaga-a.
--
-- ⚠️ NOTA — TRAÇOS DE CORRIDA NÃO ESTÃO AQUI, DE PROPÓSITO
-- Já existia `public.purge_ride_track_points()` agendada às 03:30
-- (`purge_ride_track_points_diario`) e faz exactamente o mesmo: apaga
-- `ride_track_points` com `recorded_at` mais antigo que 90 dias. Numa primeira
-- versão desta migração criei uma segunda função e um segundo job a fazer o
-- mesmo — foi um duplicado e foi removido. Não voltar a acrescentar.
--
-- ⚠️ NÃO SE APAGAM CORRIDAS (`rides`).
-- São o registo do dinheiro. São a base do contrato (F6) e do recibo pós-corrida
-- (F7). Apagar corridas para poupar espaço era apagar a contabilidade — e o
-- `bot_conversations.ride_id` tem chave estrangeira para elas.
-- Se o objectivo for reduzir `rides`, isso é uma decisão de negócio do Dánio,
-- com retenção fiscal definida por ele, não um efeito lateral de limpeza.
-- =============================================================================

-- ── Conversas do bot ────────────────────────────────────────────────────────
-- Só estados terminais/neutros. Uma sessão ACTIVA nunca é apagada, mesmo que
-- esteja parada há meses: pode ser uma corrida à espera de resposta, e o
-- passageiro perdia o fio à meada.
CREATE OR REPLACE FUNCTION public.limpar_conversas_bot_antigas(p_dias INTEGER DEFAULT 30)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_apagadas INTEGER;
  v_dias INTEGER := GREATEST(COALESCE(p_dias, 30), 1);
BEGIN
  IF to_regclass('public.bot_conversations') IS NULL THEN RETURN 0; END IF;

  DELETE FROM public.bot_conversations
  WHERE state IN ('idle', 'completed')
    AND COALESCE(updated_at, created_at) < now() - make_interval(days => v_dias);

  GET DIAGNOSTICS v_apagadas = ROW_COUNT;
  RETURN v_apagadas;
END;
$fn$;

COMMENT ON FUNCTION public.limpar_conversas_bot_antigas(INTEGER) IS
  'Apaga conversas do bot em estado idle/completed mais antigas que p_dias. Nunca toca em sessoes activas.';

-- ── Permissões ──────────────────────────────────────────────────────────────
-- ⚠️ O PostgreSQL dá EXECUTE a PUBLIC por omissão — revogar só de anon não chega.
REVOKE ALL ON FUNCTION public.limpar_conversas_bot_antigas(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.limpar_conversas_bot_antigas(INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.limpar_conversas_bot_antigas(INTEGER) FROM authenticated;

-- ── Agendamento ─────────────────────────────────────────────────────────────
-- 04:20: depois das limpezas da meia-noite (00:00 ai_logs), das 03:00 (áudio de
-- pânico e cache de IA), das 03:30 (traços) e das 04:15 (histórico do cron). Se
-- alguma delas falhar, o rasto ainda está lá quando esta corre.
DO $agendar$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'limpeza_conversas_bot') THEN
    PERFORM cron.unschedule('limpeza_conversas_bot');
    RAISE NOTICE 'job limpeza_conversas_bot substituido';
  END IF;
  PERFORM cron.schedule(
    'limpeza_conversas_bot',
    '20 4 * * *',
    'SELECT public.limpar_conversas_bot_antigas(30)'
  );
END
$agendar$;
