-- =============================================================================
-- FIX: recharge_chat_quota — validação server-side
-- Problema: cliente podia passar amount = 999999 ou amount = -1
-- Solução: limitar a 1-50 por chamada, e só permite quando há corrida completada
-- =============================================================================

DROP FUNCTION IF EXISTS public.recharge_chat_quota(INT);
CREATE OR REPLACE FUNCTION public.recharge_chat_quota(
  amount INT DEFAULT 10
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_valid   INT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária' USING ERRCODE = 'AUTH';
  END IF;

  -- Validar range: só 1-50 por chamada (negativos e gigantes bloqueados)
  v_valid := GREATEST(1, LEAST(COALESCE(amount, 10), 50));

  -- Só creditar se o utilizador completou uma corrida nas últimas 2 horas
  -- (previne spam/abuse — recharge só faz sentido pós-corrida)
  IF NOT EXISTS (
    SELECT 1 FROM public.rides
    WHERE passenger_id = v_user_id
      AND status = 'completed'
      AND completed_at > NOW() - INTERVAL '2 hours'
  ) THEN
    RAISE EXCEPTION 'Sem corrida recente para creditar' USING ERRCODE = 'NORIDE';
  END IF;

  UPDATE public.profiles
  SET chat_quota = LEAST(COALESCE(chat_quota, 0) + v_valid, 50)
  WHERE user_id = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recharge_chat_quota(INT) TO authenticated;
REVOKE ALL ON FUNCTION public.recharge_chat_quota(INT) FROM anon;
REVOKE ALL ON FUNCTION public.recharge_chat_quota(INT) FROM PUBLIC;
