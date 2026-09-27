-- ============================================================================
-- F-05 — `award_free_perk`: IDOR por parâmetro + injecção de quilómetros
-- Data: 27/09/2026
-- ============================================================================
--
-- PROVA AO VIVO (27/09/2026 15:58 UTC, por HTTP com anon key + sessão):
--
--   POST /rest/v1/rpc/award_free_perk
--     {"p_user_id":"<sonda>","p_ride_km":500}
--   -> 200 [{"perks_awarded":7,"free_km_total":35.00}]
--   profiles: km_total=500.00  free_km_available=35.00  (de 0, sem conduzir)
--
--   IDOR provado: com o token da conta A, p_user_id = conta B
--   -> 200 e, na BD, a conta B ficou com km_total=500.00 / free_km=35.00.
--
--   Limite superior medido: p_ride_km = 139999 passa e grava
--   139999.00 km + 9995.00 km grátis numa ÚNICA chamada.
--   (140000 estoura: `free_km_available` é NUMERIC(6,2), teto 9999.99)
--
--   contas anon -> 401 (o hardening de 15/09 fechou esse caminho).
--   O vector é `authenticated`, e o signup é aberto (F-04) — logo qualquer
--   pessoa na Internet chega aqui em segundos.
--
-- CADEIA REAL (isto não é uma função isolada):
--   process_ride_payment_v3(p_ride_id, p_passenger_id, p_driver_id, p_amount,
--                           p_distance_km, ...)
--     -> PERFORM award_free_perk(p_passenger_id, p_distance_km)
--   Ou seja, `p_distance_km` do cliente entra em `award_free_perk` como
--   `p_ride_km` sem nunca ser validado. O F-05 e o F-07 partilham a raiz.
--   Nenhuma destas RPCs é chamada pelo frontend (verificado por grep em src/):
--   a superfície é REST directo.
--
-- ESTRATÉGIA DA CORRECÇÃO
--   Não posso simplesmente substituir `p_user_id` por `auth.uid()`: a função
--   é chamada INTERNAMENTE por `process_ride_payment_v3`, onde o argumento é
--   legítimo. Alterar a assinatura criaria uma sobrecarga (o bug clássico do
--   `CREATE OR REPLACE` com assinatura errada) e deixaria a original viva.
--
--   Correção escolhida: manter a assinatura intacta e acrescentar, dentro do
--   corpo existente, (a) uma guarda de `p_ride_km` — a raiz do abuso — e
--   (b) uma verificação de identidade que só se aplica quando há uma sessão
--   de utilizador (caminho REST). Quando não há sessão (chamada interna a
--   partir de outra SECURITY DEFINER, onde `auth.uid()` é NULL) a chamada é
--   considerada de confiança, porque o hardening de 15/09 já garante que
--   `anon` e `authenticated` não podem executá-la directamente com
--   auth.uid() NULL.
--
--   A guarda de limite é a que fecha o abuso de forma dura: sem ela, mesmo um
--   utilizador legítimo a percorrer apenas os seus próprios kms poderia
--   inflacionar. LIMITE_MAX_KM_POR_CORRIDA = 500 é folgado face a qualquer
--   corrida real em Luanda.
--
-- NOTA: o hardening de 15/09 já revogou EXECUTE a `anon`. Esta migração
-- acrescenta a defesa em profundidade dentro do corpo e reafirma o REVOKE.
-- ============================================================================

DO $$
DECLARE
  v_def      TEXT;
  v_novo     TEXT;
  v_guarda   TEXT;
  v_antes    INT;
  v_depois   INT;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'award_free_perk';

  IF v_def IS NULL THEN
    RAISE NOTICE '[F-05] award_free_perk nao encontrada — nada a fazer.';
    RETURN;
  END IF;

  -- Idempotência: se a guarda já lá está, não voltar a injectar.
  IF v_def LIKE '%[F-05]%' THEN
    RAISE NOTICE '[F-05] guarda ja presente — nada a fazer.';
    RETURN;
  END IF;

  -- Sem retorno antecipado: um p_ride_km inválido tem de ser VISÍVEL.
  -- (`RETURN;` silencioso esconderia o ataque de quem observa os logs.)
  v_guarda :=
       E'  -- [F-05] guarda contra injecção de km (27/09/2026)\n'
    || E'  -- Sem isto, qualquer conta autenticada grava kms que nunca conduziu.\n'
    || E'  IF p_ride_km IS NULL OR p_ride_km <= 0 THEN\n'
    || E'    RAISE EXCEPTION ''[F-05] p_ride_km invalido: % (tem de ser > 0)'', p_ride_km;\n'
    || E'  END IF;\n'
    || E'  IF p_ride_km > 500 THEN\n'
    || E'    RAISE EXCEPTION ''[F-05] p_ride_km acima do limite por corrida: % (max 500)'', p_ride_km;\n'
    || E'  END IF;\n'
    || E'  -- [F-05] IDOR: quando ha sessao, so a propria conta pode receber perks.\n'
    || E'  -- (auth.uid() e NULL nas chamadas internas de process_ride_payment_v3,\n'
    || E'  --  onde o argumento e legitimo e ja vem de uma funcao de confianca.)\n'
    || E'  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN\n'
    || E'    RAISE EXCEPTION ''[F-05] nao podes atribuir perks a outra conta'';\n'
    || E'  END IF;\n\n';

  -- Ancoragem MEDIDA: `pg_get_functiondef` devolve CRLF.
  -- Confirmado nesta sessao: position('BEGIN'||chr(10)) = 0 mas
  -- position('BEGIN'||chr(13)||chr(10)) = 243.
  -- O padrão `(BEGIN[ \t\r\n]+)` casa exactamente uma vez em cada função.
  v_antes  := length(v_def);

  v_novo := regexp_replace(v_def, E'(BEGIN[ \\t\\r\\n]+)', E'BEGIN\n' || v_guarda, '');

  v_depois := length(v_novo);

  IF v_depois <= v_antes THEN
    RAISE EXCEPTION '[F-05] ancoragem falhou: o corpo nao foi alterado (antes=% depois=%).',
      v_antes, v_depois;
  END IF;

  EXECUTE v_novo;

  RAISE NOTICE '[F-05] award_free_perk corrigida (+% bytes).', v_depois - v_antes;
END $$;

-- Reafirmar: `anon` não executa. Defesa em profundidade face ao hardening.
REVOKE ALL ON FUNCTION public.award_free_perk(uuid, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.award_free_perk(uuid, numeric) TO authenticated;

-- ============================================================================
-- VERIFICAÇÃO
-- ============================================================================
SELECT
  CASE WHEN pg_get_functiondef(p.oid) LIKE '%[F-05]%'
       THEN 'OK guarda presente' ELSE 'FALHOU' END        AS guarda,
  CASE WHEN pg_get_functiondef(p.oid) LIKE '%p_ride_km > 500%'
       THEN 'OK limite' ELSE 'FALHOU' END                 AS limite,
  CASE WHEN pg_get_functiondef(p.oid) LIKE '%auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid()%'
       THEN 'OK IDOR' ELSE 'FALHOU' END                   AS idor,
  has_function_privilege('anon', p.oid, 'EXECUTE')        AS anon_pode,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_pode
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'award_free_perk';
