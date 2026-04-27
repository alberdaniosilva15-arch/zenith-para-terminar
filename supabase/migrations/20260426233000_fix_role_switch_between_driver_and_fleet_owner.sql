CREATE OR REPLACE FUNCTION public.set_my_role_driver()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.users
  SET role = 'driver', updated_at = NOW()
  WHERE id = auth.uid()
    AND role IN ('passenger', 'fleet_owner');
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_my_role_driver() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_my_role_fleet_owner()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.users
  SET role = 'fleet_owner', updated_at = NOW()
  WHERE id = auth.uid()
    AND role IN ('passenger', 'driver');
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_my_role_fleet_owner() TO authenticated;
