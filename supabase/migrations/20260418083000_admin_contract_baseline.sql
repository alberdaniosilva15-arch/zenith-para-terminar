-- =============================================================================
-- ZENITH RIDE - Admin contract baseline
-- Date: 2026-04-18
--
-- Goal:
-- 1) Provide canonical admin helpers used by app/frontend/edge functions.
-- 2) Keep functions idempotent and safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Helper: is_admin
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- 2) Helper: is_admin_secure (CRM contract)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin_secure()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.is_admin();
$$;

GRANT EXECUTE ON FUNCTION public.is_admin_secure() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Promote admin by user id (edge/admin contract)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_user_to_admin(target_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'target_user_id obrigatorio';
  END IF;

  -- Allow service role and existing admins only.
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado para promover administradores';
  END IF;

  UPDATE public.users
  SET
    role = 'admin'::user_role,
    updated_at = NOW()
  WHERE id = target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Utilizador nao encontrado';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.promote_user_to_admin(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Promote admin by email (legacy CRM contract)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_user_admin(target_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF target_email IS NULL OR btrim(target_email) = '' THEN
    RAISE EXCEPTION 'target_email obrigatorio';
  END IF;

  SELECT id
    INTO v_user_id
  FROM public.users
  WHERE lower(email) = lower(target_email)
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Utilizador com esse email nao encontrado';
  END IF;

  PERFORM public.promote_user_to_admin(v_user_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_user_admin(TEXT) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Self role upgrade for OAuth intent (passenger -> driver)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_my_role_driver()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessao invalida';
  END IF;

  UPDATE public.users
  SET
    role = 'driver'::user_role,
    updated_at = NOW()
  WHERE id = v_uid
    AND role IN ('passenger', 'driver');

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_my_role_driver() TO authenticated, service_role;
