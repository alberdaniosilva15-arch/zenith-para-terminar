-- =============================================================================
-- ZENITH RIDE — cron da fila de notificações
-- Escrita: 2026-09-25
--
-- ── Porquê ───────────────────────────────────────────────────────────────────
--
-- A migração 20260924220000 criou `public.notifications_outbox` e um trigger que
-- enfileira uma linha sempre que uma corrida passa a `accepted`. Ficou só isso:
-- nada consumia a fila. As linhas acumulavam-se e a notificação continuava a
-- sair pelo caminho antigo — um `fetch` do telemóvel do motorista. Se ele
-- perdesse rede no instante do aceite, o passageiro nunca sabia.
--
-- Esta migração fecha o circuito: um job de cron, a cada minuto, chama a Edge
-- Function `notifications-worker`, que entrega o que estiver na fila com recuo
-- exponencial e tentativas limitadas.
--
-- Segue o padrão já usado pelos outros jobs do projecto (ver
-- 20260917120100_cron_limpeza_audio_via_edge.sql): lê o segredo `cron_secret`
-- do Vault e passa-o no cabeçalho `x-cron-secret`.
--
-- ⚠️ A função tem de estar deployada com `--no-verify-jwt`. Com a verificação de
-- JWT ligada, a plataforma rejeita o pedido antes de ele chegar ao código — o
-- cron não tem JWT nenhum. É a mesma convenção de `sos-escalation` e
-- `analyze-patterns`.
--
-- ⚠️ ARMADILHA DO NOME DO SEGREDO (paga a 2026-09-25)
--
-- O valor guardado no Vault como `cron_secret` — o que este job envia no
-- cabeçalho `x-cron-secret` — corresponde ao `SOS_CRON_SECRET`, e NÃO ao
-- `CRON_SECRET`. Os dois existem no projecto com valores diferentes.
--
-- Provado por digest, sem revelar o segredo: o sha256 do valor guardado no
-- Vault é igual ao digest do `SOS_CRON_SECRET` (e diferente do `CRON_SECRET`).
-- O digest exacto não fica escrito aqui — o repositório é público.
--
-- O `notifications-worker` lia só o `CRON_SECRET`: o cron batia-lhe a cada
-- minuto e levava 401 sempre, em silêncio. Passou a aceitar os dois candidatos
-- (como `sos-escalation`), e repassa ao `whatsapp-webhook` o mesmo segredo que
-- recebeu — que também aceita os dois.
-- =============================================================================

DO $cron$
DECLARE
  v_segredo TEXT;
BEGIN
  -- ── 1. Ler o segredo do Vault ────────────────────────────────────────────
  SELECT decrypted_secret INTO v_segredo
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;

  IF v_segredo IS NULL OR v_segredo = '' THEN
    RAISE EXCEPTION
      'Segredo cron_secret em falta no Vault — a fila de notificacoes nao pode ser accionada';
  END IF;

  -- ── 2. Recriar o job (idempotente) ───────────────────────────────────────
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notifications_outbox_worker') THEN
    PERFORM cron.unschedule('notifications_outbox_worker');
    RAISE NOTICE 'job antigo notifications_outbox_worker removido';
  END IF;

  PERFORM cron.schedule(
    'notifications_outbox_worker',
    '* * * * *',
    format(
      $cmd$
      SELECT net.http_post(
        url     := 'https://mhahnhnsaquqgqvnnwld.supabase.co/functions/v1/notifications-worker',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', %L),
        body    := '{}'::jsonb,
        timeout_milliseconds := 30000
      );
      $cmd$,
      v_segredo
    )
  );

  RAISE NOTICE 'job notifications_outbox_worker criado (a cada minuto)';
END
$cron$;
