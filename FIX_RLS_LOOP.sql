-- =============================================================================
-- FIX CRÍTICO: 19 AGO 2026
-- Problema: "Como motorista aceitei a corrida mas nada aconteceu."
-- Causa: A função 'accept_ride_atomic' não foi criada durante o setup inicial
-- da base de dados, causando um erro silencioso na hora de aceitar.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.accept_ride_atomic(
  p_ride_id   UUID,
  p_driver_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ride RECORD;
BEGIN
  -- Bloqueia a linha da corrida para evitar que 2 motoristas aceitem ao mesmo tempo
  SELECT * INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE NOWAIT;

  -- Verifica se existe
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'ride_not_found');
  END IF;

  -- Só aceita se a corrida ainda estiver "searching"
  IF v_ride.status != 'searching' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'ride_not_searching');
  END IF;

  -- Se já tiver um driver atribuído
  IF v_ride.driver_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_accepted');
  END IF;

  -- ATUALIZA A CORRIDA: Motorista é dono
  UPDATE public.rides
  SET driver_id   = p_driver_id,
      status      = 'accepted',
      accepted_at = NOW(),
      updated_at  = NOW()
  WHERE id = p_ride_id;

  -- ATUALIZA O MOTORISTA: Status passa a 'busy' (em corrida)
  UPDATE public.driver_locations
  SET status = 'busy', updated_at = NOW()
  WHERE driver_id = p_driver_id;

  RETURN jsonb_build_object('success', true, 'ride_id', p_ride_id);

EXCEPTION
  WHEN lock_not_available THEN
    -- Alguém já bloqueou esta linha noutra query
    RETURN jsonb_build_object('success', false, 'reason', 'race_condition_lost');
END;
$$;

-- Mensagem de Confirmação na consola SQL
SELECT 'A função accept_ride_atomic foi criada com sucesso! Podes testar no telemóvel.' AS status;
