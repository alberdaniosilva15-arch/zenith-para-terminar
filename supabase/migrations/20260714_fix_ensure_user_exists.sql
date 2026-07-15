CREATE OR REPLACE FUNCTION public.ensure_user_exists(
  p_user_id UUID,
  p_email   TEXT,
  p_name    TEXT DEFAULT '',
  p_role    TEXT DEFAULT 'passenger'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- VALIDAÇÃO: só permite criar o próprio perfil
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Não podes criar perfil para outro utilizador.';
  END IF;

  -- VALIDAÇÃO: role só pode ser passenger, driver ou fleet_owner
  IF p_role NOT IN ('passenger', 'driver', 'fleet_owner') THEN
    RAISE EXCEPTION 'Role inválido: %', p_role;
  END IF;

  -- 1. Garantir utilizador na tabela users
  INSERT INTO public.users (id, email, role)
  VALUES (p_user_id, p_email, p_role::user_role)
  ON CONFLICT (id) DO NOTHING;

  -- 2. Garantir perfil
  INSERT INTO public.profiles (user_id, name)
  VALUES (p_user_id, COALESCE(NULLIF(p_name, ''), split_part(p_email, '@', 1)))
  ON CONFLICT (user_id) DO NOTHING;

  -- 3. Garantir carteira
  INSERT INTO public.wallets (user_id, balance)
  VALUES (p_user_id, 0.00)
  ON CONFLICT (user_id) DO NOTHING;

  -- 4. Garantir privacidade VoIP
  INSERT INTO public.user_privacy (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_user_exists(UUID, TEXT, TEXT, TEXT) TO authenticated;
