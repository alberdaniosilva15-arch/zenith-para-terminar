-- =============================================================================
-- ZENITH RIDE — panic_alerts entra na publicação realtime
-- =============================================================================
-- Data: 2026-09-16
--
-- O PROBLEMA (encontrado ao auditar o realtime, não reportado por ninguém)
-- ─────────────────────────────────────────────────────────────────────────────
-- `src/components/admin/AdminSOSPanel.tsx` subscreve `panic_alerts`:
--
--     .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'panic_alerts' }, …)
--     .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'panic_alerts' }, …)
--
-- Mas `panic_alerts` não estava em publicação nenhuma. Auditado contra a base
-- de dados real:
--
--     SELECT pubname, tablename FROM pg_publication_tables WHERE tablename='panic_alerts';
--     -> (nenhuma linha)
--
-- Consequência: aqueles callbacks NUNCA dispararam. O painel de SOS do admin
-- só mostra um alerta se for recarregado à mão. Num botão de pânico isso é o
-- pior sítio possível para uma actualização em falta — o admin pode estar com
-- o painel aberto, o alerta entrar, e o ecrã ficar parado.
--
-- A AUDITORIA COMPLETA (para não corrigir só o que se viu)
-- ─────────────────────────────────────────────────────────────────────────────
-- Comparei todas as tabelas subscritas no código com as publicadas:
--
--   subscritas em src/  : driver_locations, kaze_chat_quota_live, panic_alerts,
--                         posts, profiles, ride_messages, ride_safety_checks,
--                         rides, school_tracking_sessions, transactions, wallets
--   publicadas          : as mesmas MENOS `panic_alerts`, mais `driver_bids` e
--                         `driver_notifications` (subscritas por outros meios)
--
-- `panic_alerts` era a única em falta. Esta migração fecha a lacuna.
--
-- NOTA: para o Realtime entregar eventos com RLS activo, o cliente precisa de
-- SELECT. O admin tem-no (`is_admin()`, `is_admin_secure()`) — verificado em
-- pg_policies. Portanto publicar a tabela é suficiente; não é preciso mexer em
-- políticas.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'panic_alerts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.panic_alerts;
    RAISE NOTICE 'panic_alerts adicionada a supabase_realtime';
  ELSE
    RAISE NOTICE 'panic_alerts ja estava publicada (ou supabase_realtime nao existe) — nada a fazer';
  END IF;
END;
$$;
