-- ════════════════════════════════════════════════════════════════════
-- ZENITH RIDE — Migration 2.7: accept_ride_atomic (sem race conditions)
-- ════════════════════════════════════════════════════════════════════
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
  SELECT * INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'ride_not_found');
  END IF;

  IF v_ride.status != 'searching' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'ride_not_searching');
  END IF;

  IF v_ride.driver_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_accepted');
  END IF;

  UPDATE public.rides
  SET driver_id   = p_driver_id,
      status      = 'accepted',
      accepted_at = NOW(),
      updated_at  = NOW()
  WHERE id = p_ride_id;

  -- Marcar motorista como ocupado (status 'busy' existe no enum driver_status)
  UPDATE public.driver_locations
  SET status = 'busy', updated_at = NOW()
  WHERE driver_id = p_driver_id;

  RETURN jsonb_build_object('success', true, 'ride_id', p_ride_id);

EXCEPTION
  WHEN lock_not_available THEN
    RETURN jsonb_build_object('success', false, 'reason', 'race_condition_lost');
END;
$$;
