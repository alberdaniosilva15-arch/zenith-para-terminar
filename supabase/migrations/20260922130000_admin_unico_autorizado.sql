-- =============================================================================
-- ZENITH RIDE — UM SÓ ADMINISTRADOR, UMA SÓ CONTA
-- =============================================================================
-- Pedido do Dánio (22/09/2026): "no painel do admin só uma pessoa pode fazer o
-- login!!! que é o alberdaniosilva15@gmail.com e mais ninguém!!"
--
-- O QUE JÁ ESTAVA CERTO — verificado na BASE DE DADOS VIVA, não no ficheiro de
-- migração (já divergiram antes):
--   • `handle_new_user` só aceita `role IN ('passenger','driver')` do registo
--     público. Ninguém se auto-regista como admin (correcção de 20/09).
--   • Em `public.users` só há políticas de UPDATE para admins
--     (`is_admin_secure()` / `is_admin()`), e NENHUMA de INSERT. Um utilizador
--     comum não consegue escrever o próprio `role`.
--   • `admin_set_user_role` começa por `IF NOT is_admin_secure() THEN RAISE`.
--   • `promote_user_to_admin` só tem EXECUTE para `postgres` e `service_role`
--     (o PUBLIC já estava revogado) e escreve em `public.user_roles`, que NADA
--     lê para autorizar — é uma tabela vestigial.
--
-- O QUE FALTAVA: nada garantia *estruturalmente* que continuasse a haver um só
-- admin. Bastava um `UPDATE users SET role='admin'` — por engano, por uma
-- migração futura, ou por uma conta de admin comprometida — para abrir o painel
-- a mais gente. Uma regra que só vive na interface não é uma regra.
--
-- Esta migração fecha isso na base de dados.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Lista branca de administradores
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_allowlist (
  email      text PRIMARY KEY,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admin_allowlist IS
  'Contas autorizadas a ter role=admin. Fonte de verdade unica do painel de administracao. Gerida por SQL.';

-- Ninguém acede pelo cliente — nem para ler. É gerida por SQL / service_role.
ALTER TABLE public.admin_allowlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_allowlist FROM PUBLIC;
REVOKE ALL ON public.admin_allowlist FROM anon;
REVOKE ALL ON public.admin_allowlist FROM authenticated;

INSERT INTO public.admin_allowlist (email, note)
VALUES ('alberdaniosilva15@gmail.com', 'Dono da Zenith Ride — unico administrador autorizado')
ON CONFLICT (email) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Ninguém é promovido a admin fora da lista — e o Dánio nunca fica trancado fora
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.proteger_papel_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  -- (a) Está a SAIR de admin. Impede ficar sem administrador nenhum — senão o
  --     Dánio tranca-se fora do painel e só se resolve com SQL à mão.
  IF TG_OP = 'UPDATE' AND OLD.role = 'admin' AND NEW.role IS DISTINCT FROM 'admin' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.users WHERE role = 'admin' AND id <> OLD.id
    ) THEN
      RAISE EXCEPTION
        'Nao podes remover o unico administrador: ficarias sem acesso ao painel. Promove outra conta primeiro.'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  -- (b) Não está a ENTRAR em admin: nada a verificar.
  --     `IS DISTINCT FROM` trata o NULL correctamente (role NULL não é promoção).
  IF NEW.role IS DISTINCT FROM 'admin' THEN
    RETURN NEW;
  END IF;

  -- (c) Já era admin — é uma actualização normal da própria linha. Deixa passar.
  IF TG_OP = 'UPDATE' AND OLD.role = 'admin' THEN
    RETURN NEW;
  END IF;

  -- (d) Promoção a admin: só a partir da lista branca.
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_allowlist a
    WHERE lower(a.email) = lower(NEW.email)
  ) THEN
    RAISE EXCEPTION
      'O papel admin esta reservado a uma conta autorizada. Para autorizar outra conta, insere o email em public.admin_allowlist.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS proteger_papel_admin ON public.users;
CREATE TRIGGER proteger_papel_admin
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_papel_admin();

-- ---------------------------------------------------------------------------
-- 3. Prova — tem de dar 7/7 OK
-- ---------------------------------------------------------------------------
SELECT 'admin_allowlist existe'                        AS prova,
       to_regclass('public.admin_allowlist') IS NOT NULL AS ok
UNION ALL
SELECT 'trigger proteger_papel_admin existe',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'proteger_papel_admin' AND NOT tgisinternal)
UNION ALL
SELECT 'a funcao do trigger consulta admin_allowlist',
       (SELECT pg_get_functiondef(p.oid) ILIKE '%admin_allowlist%'
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'proteger_papel_admin')
UNION ALL
SELECT 'a funcao impede remover o ultimo admin',
       (SELECT pg_get_functiondef(p.oid) ILIKE '%unico administrador%'
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'proteger_papel_admin')
UNION ALL
SELECT 'allowlist tem exactamente 1 email',
       (SELECT count(*) = 1 FROM public.admin_allowlist)
UNION ALL
SELECT 'existe exactamente 1 admin em users',
       (SELECT count(*) = 1 FROM public.users WHERE role = 'admin')
UNION ALL
SELECT 'esse admin e o alberdaniosilva15@gmail.com',
       (SELECT EXISTS (SELECT 1 FROM public.users
                       WHERE role = 'admin' AND lower(email) = 'alberdaniosilva15@gmail.com'));
