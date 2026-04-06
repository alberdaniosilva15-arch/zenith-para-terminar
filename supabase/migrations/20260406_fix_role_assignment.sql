-- Garantir que o trigger handle_new_user IGNORA o role do cliente
-- e sempre atribui 'passenger' por defeito no signup público

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Utilizador (lê SEMPRE como passenger independentemente do metadata)
  INSERT INTO public.users (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    'passenger'::user_role
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
$$;

-- Política de RLS em users para não permitir alterar o próprio role
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
