-- =============================================================================
-- ZENITH RIDE — o papel no registo passa a ter lista branca
--
-- 🔴 VULNERABILIDADE CORRIGIDA AQUI (encontrada e provada em 20/09/2026)
--
-- O `handle_new_user` fazia:
--
--     COALESCE(NEW.raw_user_meta_data->>'role', 'passenger')::user_role
--
-- O papel vinha do que o CLIENTE enviasse no registo. Sem validação nenhuma.
-- E o enum `user_role` aceita: passenger, driver, admin, fleet_owner.
--
-- PROVADO, não deduzido: com a chave `anon` — que é PÚBLICA, vai dentro do
-- bundle do browser — criei uma conta nova pedindo `role: 'admin'` e o papel
-- gravado foi **admin**:
--
--     Conta criada: 80c72191-aa6d-4d92-87f4-9b5584a4557c
--     PAPEL GRAVADO: admin
--     >>> VULNERAVEL: a conta deu-se a si mesma ADMIN.
--
-- Qualquer pessoa podia tornar-se administrador da Zenith. E `is_admin_secure()`
-- é o que abre o painel de admin, o áudio de emergência e o fecho de alertas.
--
-- Foi o Dánio que reparou primeiro, por outra via: achou estranho haver 27
-- "motoristas". Eram 26 contas de teste com `role='driver'`, várias delas
-- chamadas "Passageiro Teste" — porque quem as criou pediu esse papel no
-- registo e o servidor limitou-se a acreditar.
--
-- ════════════════════════════════════════════════════════════════════════════
-- A CORRECÇÃO
-- ════════════════════════════════════════════════════════════════════════════
--
-- Lista branca. Do registo público só podem sair dois papéis:
--
--   passenger  — o normal, e o que fica por omissão
--   driver     — legítimo: a app deixa escolher "Motorista" ao criar conta
--
-- `admin` e `fleet_owner` NUNCA vêm do cliente. Passam a ser atribuídos só
-- por quem já é admin, a partir do painel. Um pedido de `role: 'admin'` no
-- registo passa a produzir um `passenger` comum — não um erro, para não dar
-- pistas a quem está a tentar.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  -- 1. Utilizador — com LISTA BRANCA de papéis.
  --
  -- ⚠️ NÃO voltar a escrever `(NEW.raw_user_meta_data->>'role')::user_role`
  -- sem o CASE. Foi essa linha que deixou qualquer pessoa dar-se a si mesma
  -- `admin` com a chave pública.
  INSERT INTO public.users (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    CASE
      WHEN NEW.raw_user_meta_data->>'role' IN ('passenger', 'driver')
        THEN (NEW.raw_user_meta_data->>'role')::user_role
      ELSE 'passenger'::user_role
    END
  )
  ON CONFLICT (id) DO NOTHING;

  -- 2. Perfil
  INSERT INTO public.profiles (user_id, name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (user_id) DO NOTHING;

  -- 3. Carteira
  INSERT INTO public.wallets (user_id, balance)
  VALUES (NEW.id, 0.00)
  ON CONFLICT (user_id) DO NOTHING;

  -- 4. Privacidade VoIP
  INSERT INTO public.user_privacy (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING '[handle_new_user] Erro para user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$fn$;

-- ── Prova, na própria migração ───────────────────────────────────────────────
-- `supabase db query --linked` só mostra o resultado da ÚLTIMA instrução.

SELECT
  CASE
    WHEN pg_get_functiondef(oid) LIKE '%raw_user_meta_data->>''role'' IN (''passenger'', ''driver'')%'
      THEN 'OK  lista branca aplicada'
    ELSE 'FALHOU  a lista branca nao esta no corpo da funcao'
  END
  || ' | expressao insegura removida: ' ||
  CASE
    WHEN pg_get_functiondef(oid) LIKE '%COALESCE(NEW.raw_user_meta_data->>''role'', ''passenger'')%'
      THEN 'NAO  ainda la esta!'
    ELSE 'sim'
  END
  || ' | admins na base: ' ||
  (SELECT count(*)::text FROM public.users WHERE role = 'admin')
  AS resultado
FROM pg_proc
WHERE proname = 'handle_new_user';
