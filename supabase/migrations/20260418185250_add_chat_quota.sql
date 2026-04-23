-- Adicionar coluna de quota para a IA (Omni Kaze)
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS chat_quota INTEGER DEFAULT 10;

-- Adicionar RPC para decrementar com segurança pelo servidor
CREATE OR REPLACE FUNCTION decrement_chat_quota(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.profiles
  SET chat_quota = GREATEST(0, COALESCE(chat_quota, 10) - 1)
  WHERE user_id = p_user_id;
END;
$$;

-- Adicionar RPC para recarregar a quota numa nova viagem
CREATE OR REPLACE FUNCTION recharge_chat_quota(p_user_id UUID, amount INTEGER DEFAULT 10)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.profiles
  SET chat_quota = LEAST(100, COALESCE(chat_quota, 0) + amount)
  WHERE user_id = p_user_id;
END;
$$;
