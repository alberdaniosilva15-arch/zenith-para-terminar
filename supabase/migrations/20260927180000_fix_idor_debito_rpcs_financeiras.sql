-- ============================================================================
-- F-07 (reclassificado) — IDOR de DÉBITO nas RPCs financeiras
-- Data: 27/09/2026
-- ============================================================================
--
-- O relatório original classificou o F-07 como "mesma falha de validação de
-- sinal do F-01". Essa parte JÁ estava fechada pela migração das 15:00
-- (`p_amount_kz <= 0 -> RAISE`, visível no corpo). O risco real é OUTRO, e
-- foi provado hoje:
--
--   IDOR POR `p_user_id` DEBITADO DE OUTRA CONTA
--
--   POST /rest/v1/rpc/process_partner_payment
--     {"p_user_id":"5f8099e3-...","p_partner_id":"...","p_amount_kz":1}
--   -> 200 [{"success":true,"new_balance":49999.00}]
--      (a carteira de OUTRO utilizador caiu de 50000.00 para 49999.00)
--
--   POST /rest/v1/rpc/process_withdrawal
--     {"p_user_id":"5f8099e3-...","p_amount":1}
--   -> 204 e, na BD, balance 50000.00 -> 49999.00
--
--   Ou seja: QUALQUER conta autenticada pode esvaziar a carteira de QUALQUER
--   utilizador, chamando a RPC em ciclo com o UUID da vítima. Com o signup
--   aberto (F-04), isto é alcançável por um desconhecido em segundos.
--   Ambos os débitos foram revertidos (saldo de volta a 50000.00).
--
-- AUDITORIA `auth.uid()` (antes desta migração):
--   process_withdrawal        false  <-- corrigida aqui
--   process_partner_payment   false  <-- corrigida aqui
--   process_ride_payment      false  <-- corrigida aqui
--   process_ride_payment_v3   false  <-- corrigida aqui
--   award_free_perk           true   (migração das 17:00)
--
-- ESTRATÉGIA (igual à do award_free_perk)
--   Assinaturas intactas — sem `CREATE OR REPLACE` com assinatura nova, que
--   criaria uma SOBRECARGA e deixaria a versão insegura viva.
--   Injecta-se no corpo existente, ancorando em `(BEGIN[ \t\r\n]+)`
--   (`pg_get_functiondef` devolve CRLF — medido: `position('BEGIN'||chr(10))`
--   = 0, `position('BEGIN'||chr(13)||chr(10))` > 0).
--
--   A guarda usa o parâmetro de identidade REAL de cada função:
--     process_withdrawal        -> p_user_id
--     process_partner_payment   -> p_user_id
--     process_ride_payment      -> p_passenger_id
--     process_ride_payment_v3   -> p_passenger_id
--   (as duas últimas são as que debitam o passageiro)
--
--   A verificação só dispara quando existe sessão (auth.uid() NOT NULL).
--   `process_ride_payment_v3` chama `process_ride_payment` internamente; nesse
--   caminho o auth.uid() é o do passageiro que originou a chamada, portanto
--   mantém-se correcto para o caso legítimo do frontend.
-- ============================================================================

DO $$
DECLARE
  -- (nome, parametro de identidade, tem parametro de montante?)
  v_alvos CONSTANT TEXT[][] := ARRAY[
    ['process_withdrawal',      'p_user_id'],
    ['process_partner_payment', 'p_user_id'],
    ['process_ride_payment',    'p_passenger_id'],
    ['process_ride_payment_v3', 'p_passenger_id']
  ];
  v_i     INT;
  v_nome  TEXT;
  v_param TEXT;
  v_def   TEXT;
  v_novo  TEXT;
  v_antes INT;
  v_depois INT;
  v_feitas INT := 0;
BEGIN
  FOR v_i IN 1 .. array_length(v_alvos, 1) LOOP
    v_nome  := v_alvos[v_i][1];
    v_param := v_alvos[v_i][2];

    SELECT pg_get_functiondef(p.oid) INTO v_def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_nome
     LIMIT 1;

    IF v_def IS NULL THEN
      RAISE NOTICE '[F-07] % nao encontrada — ignorada.', v_nome;
      CONTINUE;
    END IF;

    IF v_def LIKE '%[F-07]%' THEN
      RAISE NOTICE '[F-07] % ja corrigida — ignorada.', v_nome;
      CONTINUE;
    END IF;

    -- Guardar o resultado da regra num bloco para não repetir a expressão.
    v_antes := length(v_def);

    v_novo := regexp_replace(
      v_def,
      E'(BEGIN[ \t\r\n]+)',
      E'BEGIN\n'
        || E'  -- [F-07] IDOR de debito (27/09/2026)\n'
        || E'  -- Sem isto, um atacante autenticado debita a carteira de outro\n'
        || E'  -- utilizador passando o UUID da vitima neste parametro.\n'
        || E'  IF auth.uid() IS NOT NULL AND ' || v_param || E' IS DISTINCT FROM auth.uid() THEN\n'
        || E'    RAISE EXCEPTION ''[F-07] nao podes operar a carteira de outra conta'';\n'
        || E'  END IF;\n\n',
      ''
    );

    v_depois := length(v_novo);

    IF v_depois <= v_antes THEN
      RAISE EXCEPTION '[F-07] ancoragem falhou em % (antes=% depois=%).',
        v_nome, v_antes, v_depois;
    END IF;

    EXECUTE v_novo;
    v_feitas := v_feitas + 1;
    RAISE NOTICE '[F-07] % corrigida (+% bytes).', v_nome, v_depois - v_antes;
  END LOOP;

  RAISE NOTICE '[F-07] total corrigidas: %', v_feitas;
END $$;

-- `anon` não executa nenhuma delas.
REVOKE ALL ON FUNCTION public.process_withdrawal(uuid, numeric) FROM anon;
REVOKE ALL ON FUNCTION public.process_partner_payment(uuid, uuid, numeric) FROM anon;
REVOKE ALL ON FUNCTION public.process_ride_payment(uuid, uuid, uuid, numeric) FROM anon;
REVOKE ALL ON FUNCTION public.process_ride_payment_v3(
  uuid, uuid, uuid, numeric, numeric, text, double precision, double precision,
  text, double precision, double precision) FROM anon;

-- ============================================================================
-- VERIFICAÇÃO
-- ============================================================================
SELECT
  p.proname,
  CASE WHEN pg_get_functiondef(p.oid) LIKE '%[F-07]%'
       THEN 'OK guarda' ELSE 'FALHOU' END                     AS guarda,
  CASE WHEN pg_get_functiondef(p.oid) LIKE '%IS DISTINCT FROM auth.uid()%'
       THEN 'OK compara' ELSE 'FALHOU' END                    AS compara_uid,
  has_function_privilege('anon', p.oid, 'EXECUTE')            AS anon_pode
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('process_withdrawal','process_partner_payment',
                    'process_ride_payment','process_ride_payment_v3')
ORDER BY p.proname;
