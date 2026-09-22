-- ============================================================================
-- Segurança dos papéis e da verificação de motorista
-- Data: 2026-09-22
--
-- Três buracos, todos provados contra a base de dados real, com a anon key
-- pública (a mesma que vai inlined no bundle do browser).
--
-- ── 1. O motorista aprovava-se a si próprio ─────────────────────────────────
-- `rideService.ts` (caminho de ACEITAR uma corrida) fazia, a partir do browser:
--     driver_documents.upsert({ driver_id, status: 'approved' })
--     driver_locations.upsert({ driver_id, status: 'available' })
-- E a policy de `driver_documents` era `ALL` com `auth.uid() = driver_id`,
-- SEM restringir o `status`. Resultado: qualquer pessoa escrevia
-- `status='approved'` na sua própria linha e ficava "verificada".
-- Prova: os 17 documentos da base estão TODOS 'approved' — zero 'pending'.
--
-- ── 2. O botão "Modo Motorista" estava morto ────────────────────────────────
-- A função VIVA em produção (não a do ficheiro de migração) fazia numa só
-- chamada: papel='driver' + driver_locations 'available' + driver_documents
-- 'approved'. Rebentava sempre com 23502:
--     null value in column "car_brand" of relation "driver_documents"
--     violates not-null constraint
-- Como é uma transacção, desfazia tudo: o papel ficava 'passenger'.
-- Ninguém conseguia tornar-se motorista pela app.
--
-- ── 3. Qualquer passageiro virava dono de frota ─────────────────────────────
-- `set_my_role_fleet_owner()` só verificava o papel actual. Provado:
--     POST /rpc/set_my_role_fleet_owner -> HTTP 204, papel final 'fleet_owner'
-- A interface esconde o botão (RoleSwitcher exige uma frota existente);
-- o RPC não verificava nada.
--
-- ── O modelo que passa a valer ──────────────────────────────────────────────
--   * Um documento de motorista nasce SEMPRE 'pending'. Só um admin aprova.
--   * Passar a motorista exige um documento já aprovado.
--   * O papel de motorista NÃO põe ninguém online. Isso é o botão do motorista.
--   * Entrar em modo frota exige ter uma frota.
--   * Criar frota exige o papel `fleet_owner` — que um admin atribui pelo
--     painel de utilizadores (`admin_set_user_role`, que já verifica
--     `is_admin_secure()`). É esta a porta de entrada do B2B, e é deliberada:
--     sem ela, "criar frota" e "ser dono de frota" seriam um ciclo fechado.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Helper: o chamador é dono de frota?
--    SECURITY DEFINER para não depender da RLS de `users` e não recursar.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_fleet_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'fleet_owner'
  );
$fn$;

-- ⚠️ O PostgreSQL dá EXECUTE a PUBLIC por omissão: `REVOKE ... FROM anon`
-- sozinho não chega. Tem de ser de PUBLIC.
REVOKE ALL ON FUNCTION public.is_fleet_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_fleet_owner() TO authenticated;

-- ---------------------------------------------------------------------------
-- 1. Ninguém se aprova a si próprio
--
--    Um gatilho, e não uma policy, porque a RLS não consegue olhar para UMA
--    coluna: a policy decide se a LINHA pode ser escrita, não o que vai lá
--    dentro. Aqui forçamos o valor.
--
--    Compatível com o fluxo legítimo: `DriverDocumentsForm` já grava
--    `status: 'pending'` e `ai_feedback: null`.
--
--    `auth.uid() IS NULL` deixa passar service_role (Edge Functions) e SQL
--    directo — é por aí que o Sentinel IA escreve o parecer dele.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.proteger_documentos_motorista()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  -- Admin, service_role ou SQL directo: passa tudo.
  IF auth.uid() IS NULL OR public.is_admin_secure() THEN
    RETURN NEW;
  END IF;

  -- Qualquer escrita de um utilizador comum volta a 'pending'. Isto inclui
  -- editar o carro depois de aprovado: se o carro muda, a verificação
  -- caduca. Um documento aprovado nunca é escrito pelo próprio.
  NEW.status := 'pending';
  NEW.ai_feedback := NULL;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS proteger_documentos_motorista ON public.driver_documents;
CREATE TRIGGER proteger_documentos_motorista
  BEFORE INSERT OR UPDATE ON public.driver_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_documentos_motorista();

-- ---------------------------------------------------------------------------
-- 2. Passar a motorista exige documento aprovado — e não põe ninguém online
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_my_role_driver()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.driver_documents
    WHERE driver_id = auth.uid() AND status = 'approved'
  ) THEN
    RAISE EXCEPTION 'Os teus documentos de motorista ainda nao foram aprovados.'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.users
  SET role = 'driver', updated_at = NOW()
  WHERE id = auth.uid()
    AND role IN ('passenger', 'fleet_owner');
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.set_my_role_driver() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Entrar em modo frota exige ter uma frota
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_my_role_fleet_owner()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.fleets WHERE owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Precisas de ter uma frota antes de entrares no modo frota.'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.users
  SET role = 'fleet_owner', updated_at = NOW()
  WHERE id = auth.uid()
    AND role IN ('passenger', 'driver');
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.set_my_role_fleet_owner() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Criar frota exige o papel `fleet_owner`
--
--    Sem isto, "criar frota" era um caminho aberto para qualquer conta, e a
--    política de `fleets` (que só olhava `owner_id = auth.uid()`) permitia a
--    um passageiro criar uma frota. Provado: POST /rest/v1/fleets -> HTTP 201.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "fleet owner manage fleets" ON public.fleets;
CREATE POLICY "fleet owner manage fleets" ON public.fleets
  FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (
    owner_id = auth.uid()
    AND (public.is_fleet_owner() OR public.is_admin_secure())
  );

-- ============================================================================
-- PROVA — esta migração termina a provar o que fez.
-- ============================================================================
WITH
  gatilho AS (
    SELECT count(*) AS n
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    WHERE c.relname = 'driver_documents'
      AND tg.tgname = 'proteger_documentos_motorista'
      AND NOT tg.tgisinternal
  ),
  papel_driver AS (
    SELECT pg_get_functiondef(p.oid) AS d
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'set_my_role_driver'
  ),
  papel_frota AS (
    SELECT pg_get_functiondef(p.oid) AS d
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'set_my_role_fleet_owner'
  ),
  policy_frota AS (
    SELECT with_check FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'fleets'
      AND policyname = 'fleet owner manage fleets'
  )
SELECT 'gatilho anti-auto-aprovacao' AS verificacao,
       CASE WHEN (SELECT n FROM gatilho) = 1 THEN 'OK' ELSE 'FALHOU' END AS resultado,
       'pg_trigger em driver_documents' AS detalhe
UNION ALL
SELECT 'set_my_role_driver exige aprovacao',
       CASE WHEN (SELECT d FROM papel_driver) LIKE '%status = ''approved''%' THEN 'OK' ELSE 'FALHOU' END,
       'procura o EXISTS sobre driver_documents'
UNION ALL
SELECT 'set_my_role_driver deixou de auto-aprovar',
       CASE WHEN (SELECT d FROM papel_driver) NOT LIKE '%INSERT INTO public.driver_documents%' THEN 'OK' ELSE 'FALHOU' END,
       'nao pode voltar a inserir documentos'
UNION ALL
SELECT 'set_my_role_driver deixou de forcar online',
       CASE WHEN (SELECT d FROM papel_driver) NOT LIKE '%driver_locations%' THEN 'OK' ELSE 'FALHOU' END,
       'nao pode escrever driver_locations'
UNION ALL
SELECT 'set_my_role_fleet_owner exige frota',
       CASE WHEN (SELECT d FROM papel_frota) LIKE '%FROM public.fleets%' THEN 'OK' ELSE 'FALHOU' END,
       'procura o EXISTS sobre fleets'
UNION ALL
SELECT 'criar frota exige papel ou admin',
       CASE WHEN (SELECT with_check FROM policy_frota) LIKE '%is_fleet_owner%' THEN 'OK' ELSE 'FALHOU' END,
       'WITH CHECK da policy de fleets';
