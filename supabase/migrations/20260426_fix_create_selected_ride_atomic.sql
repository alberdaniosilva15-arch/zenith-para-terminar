DROP FUNCTION IF EXISTS public.create_selected_ride_atomic(UUID, UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, INTEGER, NUMERIC, NUMERIC, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION public.create_selected_ride_atomic(
  p_passenger_id UUID,
  p_driver_id UUID,
  p_origin_address TEXT,
  p_origin_lat DOUBLE PRECISION,
  p_origin_lng DOUBLE PRECISION,
  p_dest_address TEXT,
  p_dest_lat DOUBLE PRECISION,
  p_dest_lng DOUBLE PRECISION,
  p_distance_km NUMERIC,
  p_duration_min INTEGER,
  p_surge_multiplier NUMERIC,
  p_price_kz NUMERIC,
  p_vehicle_type TEXT DEFAULT 'standard',
  p_traffic_factor NUMERIC DEFAULT 1.0
) RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $create_selected$
DECLARE v_driver_status TEXT; v_ride public.rides;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_passenger_id THEN RAISE EXCEPTION 'not_allowed'; END IF;
  BEGIN
    SELECT dl.status INTO v_driver_status FROM public.driver_locations dl WHERE dl.driver_id = p_driver_id FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'driver_not_available';
  END;
  IF NOT FOUND OR v_driver_status <> 'available' THEN RAISE EXCEPTION 'driver_not_available'; END IF;
  IF EXISTS (SELECT 1 FROM public.rides r WHERE r.driver_id = p_driver_id AND r.status IN ('accepted', 'picking_up', 'in_progress')) THEN
    RAISE EXCEPTION 'driver_active_ride';
  END IF;
  UPDATE public.driver_locations SET status = 'busy', updated_at = NOW() WHERE driver_id = p_driver_id;
  INSERT INTO public.rides (
    passenger_id, driver_id, origin_address, origin_lat, origin_lng, dest_address, dest_lat, dest_lng,
    distance_km, duration_min, surge_multiplier, price_kz, status, accepted_at, driver_confirmed, vehicle_type, traffic_factor
  ) VALUES (
    p_passenger_id, p_driver_id, p_origin_address, p_origin_lat, p_origin_lng, p_dest_address, p_dest_lat, p_dest_lng,
    p_distance_km, p_duration_min, COALESCE(p_surge_multiplier, 1.0), p_price_kz, 'accepted', NOW(), FALSE,
    COALESCE(NULLIF(p_vehicle_type, ''), 'standard'), COALESCE(p_traffic_factor, 1.0)
  ) RETURNING * INTO v_ride;
  RETURN v_ride;
END;
$create_selected$;

GRANT EXECUTE ON FUNCTION public.create_selected_ride_atomic(UUID, UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, INTEGER, NUMERIC, NUMERIC, TEXT, NUMERIC) TO authenticated;
