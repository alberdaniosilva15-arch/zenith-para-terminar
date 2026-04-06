-- Função atómica para aceitar corrida — elimina race condition
-- Usa SELECT FOR UPDATE para garantir exclusividade

CREATE OR REPLACE FUNCTION public.accept_ride_atomic(
  p_ride_id   UUID,
  p_driver_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ride      RECORD;
BEGIN
  -- Bloquear a linha para este ride_id exclusivamente
  SELECT *
  INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE NOWAIT; 

  -- Verificar se corrida ainda está disponível
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'ride_not_found');
  END IF;

  IF v_ride.status != 'searching' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'ride_not_searching', 'current_status', v_ride.status);
  END IF;

  IF v_ride.driver_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_accepted');
  END IF;

  -- Verificar se o motorista existe e está disponível
  IF NOT EXISTS (
    SELECT 1 FROM public.driver_locations
    WHERE driver_id = p_driver_id
      AND status = 'available'
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'driver_not_available');
  END IF;

  -- Atribuição atómica — só um motorista chega aqui
  UPDATE public.rides
  SET
    driver_id  = p_driver_id,
    status     = 'accepted',
    accepted_at = NOW()
  WHERE id = p_ride_id;

  -- Marcar motorista como em corrida (status busy)
  UPDATE public.driver_locations
  SET status = 'busy'
  WHERE driver_id = p_driver_id;

  RETURN jsonb_build_object('success', true, 'ride_id', p_ride_id);

EXCEPTION
  WHEN lock_not_available THEN
    -- Outro motorista está a aceitar ao mesmo tempo
    RETURN jsonb_build_object('success', false, 'reason', 'race_condition_lost');
END;
$$;
