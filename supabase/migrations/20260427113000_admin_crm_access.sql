BEGIN;

DROP POLICY IF EXISTS "users admin read" ON public.users;
CREATE POLICY "users admin read"
  ON public.users FOR SELECT
  USING (public.is_admin_secure());

DROP POLICY IF EXISTS "users admin update" ON public.users;
CREATE POLICY "users admin update"
  ON public.users FOR UPDATE
  USING (public.is_admin_secure())
  WITH CHECK (public.is_admin_secure());

DROP POLICY IF EXISTS "wallets admin read" ON public.wallets;
CREATE POLICY "wallets admin read"
  ON public.wallets FOR SELECT
  USING (public.is_admin_secure());

DROP POLICY IF EXISTS "transactions admin read" ON public.transactions;
CREATE POLICY "transactions admin read"
  ON public.transactions FOR SELECT
  USING (public.is_admin_secure());

DROP POLICY IF EXISTS "referrals admin read" ON public.referrals;
CREATE POLICY "referrals admin read"
  ON public.referrals FOR SELECT
  USING (public.is_admin_secure());

DROP POLICY IF EXISTS "rides admin read" ON public.rides;
CREATE POLICY "rides admin read"
  ON public.rides FOR SELECT TO authenticated
  USING (public.is_admin_secure());

DROP POLICY IF EXISTS "driver_locations admin read" ON public.driver_locations;
CREATE POLICY "driver_locations admin read"
  ON public.driver_locations FOR SELECT TO authenticated
  USING (public.is_admin_secure());

CREATE OR REPLACE FUNCTION public.admin_set_user_suspension(
  p_user_id UUID,
  p_suspended_until TIMESTAMPTZ
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_secure() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  UPDATE public.users
  SET
    suspended_until = p_suspended_until,
    updated_at = NOW()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Utilizador nao encontrado';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_user_suspension(UUID, TIMESTAMPTZ) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_user_role(
  p_user_id UUID,
  p_role public.user_role
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_secure() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  UPDATE public.users
  SET
    role = p_role,
    suspended_until = CASE WHEN p_role = 'admin' THEN NULL ELSE suspended_until END,
    updated_at = NOW()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Utilizador nao encontrado';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_user_role(UUID, public.user_role) TO authenticated;

COMMIT;
