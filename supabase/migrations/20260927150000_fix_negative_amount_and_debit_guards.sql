-- =============================================================================
-- F-01 — PASSO 1: guarda nas funções de débito
--
-- Separado do CHECK em `transactions` de propósito. O CHECK não pode ser
-- adicionado enquanto existirem 2 linhas de pentest com `amount` negativo
-- (vestígios da exploração, 27/09 14:07–14:08). Essas linhas NÃO se apagam
-- por migração — é o Dánio que decide, no SQL editor, e preferencialmente
-- depois de exportar.
--
-- Este passo não depende dessas linhas: só reescreve as funções. É esta parte
-- que fecha a vulnerabilidade. O CHECK é a segunda rede, e fica para o passo 2.
--
-- Requerido: `npx supabase db query --linked --file <este ficheiro>`
-- =============================================================================

DO $$
DECLARE
  v_alvo  RECORD;
  v_def   TEXT;
  v_novo  TEXT;
  v_param TEXT;
  v_feito INTEGER := 0;
BEGIN
  FOR v_alvo IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'process_withdrawal', 'process_ride_payment',
        'process_ride_payment_v3', 'process_partner_payment'
      )
    ORDER BY p.proname
  LOOP
    v_param := CASE
      WHEN v_alvo.proname = 'process_partner_payment' THEN 'p_amount_kz'
      ELSE 'p_amount'
    END;

    v_def := pg_get_functiondef(v_alvo.oid);

    IF v_def LIKE '%[F-01] guarda%' THEN
      RAISE NOTICE '[F-01] % já protegida — intacta', v_alvo.proname;
      CONTINUE;
    END IF;

    -- Âncora: `BEGIN` + espaços/fins de linha, sem exigir o que vem depois.
    --
    -- Medido: `pg_get_functiondef` devolve o corpo com CRLF, e as quatro
    -- funções têm corpos diferentes (umas abrem com `SELECT balance INTO
    -- v_balance`, as de ride_payment usam `v_passenger_balance`). Uma âncora
    -- que exigisse uma instrução concreta só casaria em duas.
    --
    -- Testado antes de aplicar: o regex casa exactamente 1× em cada uma das
    -- quatro funções (diferença de 8 bytes = um `BEGIN\r\n`). Isso importa —
    -- um padrão que casasse 2× injectaria a guarda duas vezes.
    --
    -- `v_param` é o argumento da própria função: existe sempre, seja qual for
    -- o corpo. É por isso que a guarda não depende de nomes de variáveis.
    v_novo := regexp_replace(
      v_def,
      E'(BEGIN[ \\t\\r\\n]+)',
      E'BEGIN\n'
        || E'  -- [F-01] guarda contra montante negativo (27/09/2026)\n'
        || E'  -- Sem isto, `balance - p_amount` com p_amount negativo SOMA.\n'
        || E'  IF ' || v_param || E' IS NULL OR ' || v_param || E' <= 0 THEN\n'
        || E'    RAISE EXCEPTION ''Montante inválido: % (tem de ser maior que zero)'', ' || v_param || E';\n'
        || E'  END IF;\n\n',
      ''
    );

    IF v_novo = v_def THEN
      -- Não se inventa alternativa. Injecção cega de SQL em funções de dinheiro
      -- cria bugs piores do que o que se está a corrigir.
      RAISE WARNING '[F-01] NÃO consegui injectar em % — REVER À MÃO', v_alvo.proname;
    ELSE
      EXECUTE v_novo;
      v_feito := v_feito + 1;
      RAISE NOTICE '[F-01] % protegida (valida %)', v_alvo.proname, v_param;
    END IF;
  END LOOP;

  IF v_feito = 0 THEN
    RAISE WARNING '[F-01] NENHUMA função foi alterada — verificar antes de assumir sucesso';
  END IF;
END $$;

-- PROVA
SELECT
  CASE
    WHEN pg_get_functiondef(p.oid) LIKE '%[F-01] guarda%' THEN 'OK   guarda'
    ELSE 'FALHOU  SEM guarda'
  END
  || '  | anon: ' ||
  CASE WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'PODE (mau)' ELSE 'nao' END
  || '  | authenticated: ' ||
  CASE WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'sim' ELSE 'NAO (mau)' END
  || '  | ' || p.proname
  AS resultado
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'process_withdrawal', 'process_ride_payment',
    'process_ride_payment_v3', 'process_partner_payment'
  )
ORDER BY p.proname;
