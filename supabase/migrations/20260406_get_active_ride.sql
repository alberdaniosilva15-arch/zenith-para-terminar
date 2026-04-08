-- Substituir as 3 queries manuais por 1 JOIN atómico para performance de sub-30ms

CREATE OR REPLACE FUNCTION public.get_active_ride(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'id', r.id,
    'passenger_id', r.passenger_id,
    'driver_id', r.driver_id,
    'origin_address', r.origin_address,
    'origin_lat', r.origin_lat,
    'origin_lng', r.origin_lng,
    'dest_address', r.dest_address,
    'dest_lat', r.dest_lat,
    'dest_lng', r.dest_lng,
    'distance_km', r.distance_km,
    'duration_min', r.duration_min,
    'surge_multiplier', r.surge_multiplier,
    'price_kz', r.price_kz,
    'status', r.status,
    'driver_confirmed', r.driver_confirmed,
    'created_at', r.created_at,
    'accepted_at', r.accepted_at,
    'pickup_at', r.pickup_at,
    'started_at', r.started_at,
    'completed_at', r.completed_at,
    'cancelled_at', r.cancelled_at,
    'cancel_reason', r.cancel_reason,
    'driver_name', d.name,
    'passenger_name', p.name
  ) INTO v_result
  FROM public.rides r
  LEFT JOIN public.profiles d ON d.user_id = r.driver_id
  LEFT JOIN public.profiles p ON p.user_id = r.passenger_id
  WHERE (r.passenger_id = p_user_id OR r.driver_id = p_user_id)
    AND r.status NOT IN ('completed', 'cancelled')
  ORDER BY r.created_at DESC
  LIMIT 1;

  RETURN v_result;
END;
$$;
