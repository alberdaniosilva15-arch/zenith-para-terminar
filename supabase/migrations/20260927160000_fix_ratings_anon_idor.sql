-- =============================================================================
-- F-03 — IDOR: a tabela `ratings` era legível sem sessão nenhuma
--
-- 🔴 PROVADO AO VIVO (pentest do Dánio, 27/09/2026)
--
-- Com a chave `anon` (pública, vai no bundle do browser) e SEM qualquer sessão,
-- era possível ler `ratings` por inteiro: `from_user`, `to_user`, `score`,
-- `comment`. UUIDs reais de quem avaliou e de quem foi avaliado.
--
-- A política que o permitia (lida da BD, não deduzida):
--
--     policyname: "ratings: leitura pública"
--     cmd:        SELECT
--     roles:      {public}      <-- inclui `anon`
--     qual:       true          <-- sem restrição nenhuma
--
-- Uma política chamada "leitura pública" é o desenho, não um descuido: alguém
-- quis que a reputação fosse visível. Mas num serviço de transporte o
-- `to_user`/`from_user` são identificadores de pessoas reais, e o `comment` é
-- texto livre — que pode conter tudo, incluindo moradas ou telefones.
--
-- ⚠️ O que NÃO se faz aqui: apagar ou esconder a reputação. Um passageiro
-- precisa de ver a nota de um motorista ANTES de entrar no carro — isso é
-- segurança da pessoa, e tirá-lo seria pior do que o problema. A correcção
-- muda QUEM pode ler, não O QUE existe:
--
--     antes:  qualquer pessoa, sem sessão  -> tudo
--     agora:  só com sessão                -> tudo
--
-- Quem não tem conta deixa de ver. Quem tem, continua a ver exactamente o mesmo.
--
-- Requerido: `npx supabase db query --linked --file <este ficheiro>`
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Retirar a política que abre a tabela a anónimos.
--    Nome exacto lido da BD antes de escrever isto (duas políticas em `ratings`).
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "ratings: leitura pública" ON public.ratings;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Leitura passa a exigir sessão autenticada.
--
--    `TO authenticated` em vez de `TO public`: é a diferença que fecha o IDOR.
--    A chave `anon` deixa de ter qualquer caminho para esta tabela.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "ratings: leitura autenticada" ON public.ratings;
CREATE POLICY "ratings: leitura autenticada"
  ON public.ratings
  FOR SELECT
  TO authenticated
  USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. O INSERT já existia como `ratings: criar` (roles {public}). Apertar também:
--    uma avaliação tem de vir de alguém com sessão — senão não se sabe quem
--    avaliou, e `from_user` passaria a ser forjável.
--
--    ⚠️ Não se adiciona `WITH CHECK (from_user = auth.uid())` por agora: seria
--    o correcto, mas se alguma chamada da app gravar avaliações em nome de
--    outro utilizador (ex.: fluxo de avaliação pelo motorista), o INSERT
--    começaria a falhar em produção. Apertar `roles` já fecha o anónimo; o
--    `WITH CHECK` fica registado como seguimento, para decidir com a app à
--    frente.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "ratings: criar" ON public.ratings;
CREATE POLICY "ratings: criar"
  ON public.ratings
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. REVOKE ao nível da tabela — a rede por baixo da RLS.
--    Mesmo que uma política futura se engane, `anon` não tem GRANT.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON TABLE public.ratings FROM anon;

-- =============================================================================
-- 5. PROVA — tem de dizer "nao" em anon e "sim" em authenticated.
--
--    `has_table_privilege` não vê a RLS, por isso isto confirma o GRANT. A
--    contagem de políticas TO anon confirma a RLS. As duas juntas provam-no.
-- =============================================================================
SELECT
  'GRANT anon: ' ||
  CASE WHEN has_table_privilege('anon', 'public.ratings', 'SELECT') THEN 'PODE (mau)' ELSE 'nao' END
  || '  | GRANT authenticated: ' ||
  CASE WHEN has_table_privilege('authenticated', 'public.ratings', 'SELECT') THEN 'sim' ELSE 'NAO (mau)' END
  || '  | políticas SELECT para anon: ' ||
  (SELECT count(*)::text FROM pg_policies
    WHERE tablename = 'ratings' AND cmd = 'SELECT' AND 'anon' = ANY(roles))
  || '  | políticas SELECT total: ' ||
  (SELECT count(*)::text FROM pg_policies
    WHERE tablename = 'ratings' AND cmd = 'SELECT')
  AS resultado;
