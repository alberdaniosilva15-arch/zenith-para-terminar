-- ============================================================================
-- 20260915180000_security_hardening.sql
--
-- Correcção de segurança — auditoria de 2026-09-15
-- Base: `supabase db advisors --type security` (146 achados) + testes HTTP reais
--       com a chave pública (anon), que é a que vai no bundle do browser.
--
-- IDEMPOTENTE e NAO-DESTRUTIVA: não apaga tabelas, colunas nem dados.
-- Segue-se o princípio de só ACRESCENTAR restrições, nunca remover conteúdo.
-- ============================================================================


-- ============================================================================
-- 1. ESCALADA DE PRIVILÉGIOS — o achado mais grave
-- ============================================================================
-- 56 funções de `public` eram executáveis pelo role `anon`. Algumas são
-- SECURITY DEFINER e NÃO verificam quem as chama:
--
--   promote_user_to_admin   -> provado por HTTP: devolveu "User ... not found",
--                              ou seja, CORREU. Com um UUID real, qualquer
--                              visitante anónimo promove-se a admin.
--   award_free_perk         -> provado por HTTP: devolveu 200 a partir de anon.
--   process_withdrawal      -> funções de DINHEIRO abertas a anónimos.
--   _test_setup/_test_cleanup -> funções de teste em produção.
--
-- Fix: retirar o EXECUTE ao `anon` e deixar o `authenticated` (a app exige
-- login em todo o lado) e o `service_role` (Edge Functions) como estavam.
-- Não se altera nenhum corpo de função — só permissões. Assim o comportamento
-- para utilizadores com sessão fica exactamente igual.
-- ============================================================================

DO $$
DECLARE
  r record;
  alvos text[] := ARRAY[
    -- Escalada de privilégios / bypass de onboarding
    'promote_user_to_admin', 'award_free_perk', 'auto_confirm_users',
    'admin_set_user_role', 'admin_set_user_suspension', 'approve_driver_document',
    'set_my_role_fleet_owner',

    -- Funções de teste deixadas em produção
    '_test_setup', '_test_cleanup',

    -- Dinheiro
    'process_withdrawal', 'process_ride_payment', 'process_ride_payment_v3',
    'process_partner_payment', 'recharge_chat_quota', 'decrement_chat_quota',

    -- Manutenção / limpeza (podem destruir dados)
    'purge_old_ai_logs', 'delete_old_panic_audio', 'cleanup_bot_runtime_tables',
    'cleanup_gate_attempts', 'rls_auto_enable',

    -- Triggers e internos de escrita
    'handle_new_user', 'handle_new_user_privacy', 'trigger_process_payment_on_complete',
    'update_user_rating', 'update_ride_prediction', 'update_contract_protected',
    'protect_contract_system_fields', 'sync_kaze_chat_quota_live',
    'sync_ride_prediction_from_completed_ride', 'mark_notification_accepted',
    'notify_driver_on_ride', 're_dispatch_ride', 'fn_update_driver_acceptance_rate',
    'fn_update_driver_ride_stats', 'increment_messages', 'increment_geocode_hit',
    'bump_ride_prediction_dismissal', 'bump_ride_prediction_impressions',
    'set_rides_updated_at', 'touch_scheduled_ride_updated_at', 'update_updated_at',

    -- Lógica de negócio que exige sessão
    'find_drivers_for_auction', 'find_drivers_h3', 'get_cascade_drivers',
    'get_zones_demand', 'get_nearby_drivers', 'get_available_drivers',
    'get_searching_rides', 'get_active_ride', 'get_driver_wallet_status',
    'create_selected_ride_atomic', 'ensure_user_exists',
    'calculate_fare_engine_pro', 'calculate_fare_engine_pro_with_rate_limit',
    'calculate_passenger_score', 'calculate_zenith_score', 'check_rate_limit',
    'validate_premium_booking_price', 'validate_contract_coords',
    'accept_ride', 'accept_ride_atomic', 'cancel_ride_safe', 'complete_ride',
    'confirm_pickup', 'decline_ride_atomic', 'start_ride'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname = ANY (alvos)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
  END LOOP;
END $$;

-- promote_user_to_admin só deve ser chamada pela Edge Function `admin-gate`,
-- que corre com service_role depois de validar a chave mestra. O
-- `authenticated` nunca a deve poder chamar (já não podia; garantimos que
-- continua assim depois do REVOKE acima).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'promote_user_to_admin'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.sig);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- NOTA DELIBERADA: `validate_tracking_token` mantém-se executável por `anon`.
-- É o que permite a um familiar abrir um link de rastreio partilhado sem ter
-- conta. Retirá-lo partiria essa funcionalidade.


-- ============================================================================
-- 2. TABELAS SEM RLS — escritas abertas a qualquer visitante
-- ============================================================================
-- Seis tabelas foram criadas sem `ENABLE ROW LEVEL SECURITY` em nenhuma
-- migration. Sem RLS, o PostgREST expõe-nas por inteiro à chave pública.
-- Confirmado por HTTP: DELETE e UPDATE devolviam 204 a partir de `anon`.
--
-- Estão todas vazias neste momento, por isso não houve fuga de dados — mas
-- bastava a primeira linha entrar para ficar legível e apagável por qualquer um.
-- ============================================================================

ALTER TABLE IF EXISTS public.ip_rate_limits          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.api_rate_limits         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cash_advances           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.demand_heatmap          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.driver_insurance        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ride_prediction_sources ENABLE ROW LEVEL SECURITY;

-- ip_rate_limits: controlo anti-abuso interno. Ninguém além do servidor.
-- Sem política de propósito: nega tudo a anon e authenticated.
DROP POLICY IF EXISTS "service_role_all" ON public.ip_rate_limits;
CREATE POLICY "service_role_all" ON public.ip_rate_limits
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- api_rate_limits: cada utilizador vê apenas o seu próprio histórico.
DROP POLICY IF EXISTS "own_rows_select" ON public.api_rate_limits;
CREATE POLICY "own_rows_select" ON public.api_rate_limits
  FOR SELECT TO authenticated
  USING (user_id::text = auth.uid()::text);
DROP POLICY IF EXISTS "service_role_all" ON public.api_rate_limits;
CREATE POLICY "service_role_all" ON public.api_rate_limits
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- cash_advances: adiantamentos de motorista — só o próprio motorista.
DROP POLICY IF EXISTS "own_rows_select" ON public.cash_advances;
CREATE POLICY "own_rows_select" ON public.cash_advances
  FOR SELECT TO authenticated
  USING (driver_id::text = auth.uid()::text);
DROP POLICY IF EXISTS "service_role_all" ON public.cash_advances;
CREATE POLICY "service_role_all" ON public.cash_advances
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- demand_heatmap: agregado por célula H3, sem dados pessoais. A app
-- (src/services/rideService.ts) lê isto para mostrar zonas de procura.
DROP POLICY IF EXISTS "authenticated_read" ON public.demand_heatmap;
CREATE POLICY "authenticated_read" ON public.demand_heatmap
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "service_role_all" ON public.demand_heatmap;
CREATE POLICY "service_role_all" ON public.demand_heatmap
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- driver_insurance: apólices — só o próprio motorista.
DROP POLICY IF EXISTS "own_rows_select" ON public.driver_insurance;
CREATE POLICY "own_rows_select" ON public.driver_insurance
  FOR SELECT TO authenticated
  USING (driver_id::text = auth.uid()::text);
DROP POLICY IF EXISTS "service_role_all" ON public.driver_insurance;
CREATE POLICY "service_role_all" ON public.driver_insurance
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ride_prediction_sources: proveniência de previsões — só o próprio utilizador.
DROP POLICY IF EXISTS "own_rows_select" ON public.ride_prediction_sources;
CREATE POLICY "own_rows_select" ON public.ride_prediction_sources
  FOR SELECT TO authenticated
  USING (user_id::text = auth.uid()::text);
DROP POLICY IF EXISTS "service_role_all" ON public.ride_prediction_sources;
CREATE POLICY "service_role_all" ON public.ride_prediction_sources
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ============================================================================
-- 3. VIEW SECURITY DEFINER — ignora o RLS de quem consulta
-- ============================================================================
-- `public.motogopay_partners` é a view de compatibilidade da antiga tabela
-- MotoGoPay. Como SECURITY DEFINER, corre com os privilégios do CRIADOR:
-- quem a consulta vê tudo, independentemente do RLS da tabela base.
-- `security_invoker` faz a view respeitar as permissões de quem pergunta.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'motogopay_partners'
  ) THEN
    EXECUTE 'ALTER VIEW public.motogopay_partners SET (security_invoker = true)';
  END IF;
END $$;


-- ============================================================================
-- 4. search_path MUTÁVEL — vector de sequestro de funções
-- ============================================================================
-- Uma função SECURITY DEFINER com search_path não fixo pode ser desviada: o
-- atacante cria um objecto com o mesmo nome num schema que venha primeiro no
-- caminho e a função passa a chamar o dele, com privilégios de definer.
-- Fix padrão: fixar o caminho. Não altera o corpo de nenhuma função.
-- ============================================================================

DO $$
DECLARE
  r record;
  alvos text[] := ARRAY[
    'update_contract_protected', 'validate_contract_coords', 'handle_new_user_privacy',
    'update_updated_at', 'get_zones_demand', 'mark_notification_accepted',
    'fn_update_driver_acceptance_rate', 'fn_update_driver_ride_stats', 're_dispatch_ride',
    'find_drivers_h3', 'calculate_fare_engine_pro_with_rate_limit', 'auto_confirm_users',
    'notify_driver_on_ride', 'purge_old_ai_logs', 'increment_messages',
    'delete_old_panic_audio', 'set_rides_updated_at'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = ANY (alvos)
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.sig);
  END LOOP;
END $$;


-- ============================================================================
-- 5. spatial_ref_sys — tabela do PostGIS exposta sem RLS
-- ============================================================================
-- É uma tabela de referência do PostGIS (sistemas de coordenadas), não é dado
-- da aplicação. O PostGIS lê-a internamente como dono da extensão, por isso
-- activar RLS não parte nada — só a fecha à API pública.
-- ============================================================================

-- `spatial_ref_sys` pertence ao PostGIS, não ao role `postgres`. Um ALTER
-- directo falha com 42501 ("must be owner of table") e, como o ficheiro corre
-- numa transacção, faria reverter TUDO o que está acima. Por isso fica dentro
-- de um bloco que tolera o erro: se não der, registamos e seguimos.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'spatial_ref_sys'
  ) THEN
    EXECUTE 'ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY';
    RAISE NOTICE 'spatial_ref_sys: RLS activado.';
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'spatial_ref_sys: sem permissao (dono e o PostGIS). '
                 'Fechar pelo SQL Editor do painel, que corre como supabase_admin.';
  WHEN OTHERS THEN
    RAISE NOTICE 'spatial_ref_sys: ignorado (%).', SQLERRM;
END $$;


-- ============================================================================
-- FIM
-- ============================================================================
-- Não coberto aqui, por não ser corrigível por SQL (ficam como pendência
-- registada para o Dánio):
--
--   auth_leaked_password_protection
--     -> Painel Supabase > Authentication > Policies > "Leaked password
--        protection" (verificação contra HaveIBeenPwned). Um clique.
--
--   extension_in_public (postgis)
--     -> Mover a extensão para o schema `extensions` exige recriar índices e
--        colunas dependentes. Numa base com dados vivos, o risco de partir
--        tudo é maior do que o benefício. Não se toca sem janela de manutenção.
--
--   anon_security_definer_function_executable / authenticated_...
--     -> As restantes ~40 funções executáveis por anon são helpers do PostGIS
--        (st_*, geometry_*, geography_*). NÃO foram revogadas de propósito:
--        são usadas dentro de políticas de RLS e triggers, e retirar-lhes o
--        EXECUTE ao `anon` faria consultas legítimas darem ERRO em vez de
--        devolverem zero linhas.
-- ============================================================================
