BEGIN;

CREATE OR REPLACE FUNCTION public.accept_ride_atomic(
  p_ride_id UUID,
  p_driver_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ride RECORD;
  v_driver_status TEXT;
BEGIN
  BEGIN
    SELECT *
      INTO v_ride
    FROM public.rides
    WHERE id = p_ride_id
    FOR UPDATE NOWAIT;
  EXCEPTION
    WHEN lock_not_available THEN
      RETURN jsonb_build_object('success', false, 'reason', 'race_condition_lost');
  END;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'ride_not_found');
  END IF;

  IF v_ride.status <> 'searching' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'ride_not_searching');
  END IF;

  IF v_ride.driver_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_accepted');
  END IF;

  BEGIN
    SELECT dl.status
      INTO v_driver_status
    FROM public.driver_locations dl
    WHERE dl.driver_id = p_driver_id
    FOR UPDATE NOWAIT;
  EXCEPTION
    WHEN lock_not_available THEN
      RETURN jsonb_build_object('success', false, 'reason', 'driver_not_available');
  END;

  IF NOT FOUND OR v_driver_status <> 'available' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'driver_not_available');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.rides r
    WHERE r.driver_id = p_driver_id
      AND r.id <> p_ride_id
      AND r.status IN ('accepted', 'picking_up', 'in_progress')
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'driver_not_available');
  END IF;

  UPDATE public.rides
  SET
    driver_id = p_driver_id,
    status = 'accepted',
    accepted_at = NOW()
  WHERE id = p_ride_id;

  UPDATE public.driver_locations
  SET
    status = 'busy',
    updated_at = NOW()
  WHERE driver_id = p_driver_id;

  RETURN jsonb_build_object('success', true, 'ride_id', p_ride_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_ride_atomic(UUID, UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.create_selected_ride_atomic(
  UUID,
  UUID,
  TEXT,
  DOUBLE PRECISION,
  DOUBLE PRECISION,
  TEXT,
  DOUBLE PRECISION,
  DOUBLE PRECISION,
  NUMERIC,
  INTEGER,
  NUMERIC,
  NUMERIC,
  TEXT,
  NUMERIC
);

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
)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_status TEXT;
  v_ride public.rides;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_passenger_id THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  BEGIN
    SELECT dl.status
      INTO v_driver_status
    FROM public.driver_locations dl
    WHERE dl.driver_id = p_driver_id
    FOR UPDATE NOWAIT;
  EXCEPTION
    WHEN lock_not_available THEN
      RAISE EXCEPTION 'driver_not_available';
  END;

  IF NOT FOUND OR v_driver_status <> 'available' THEN
    RAISE EXCEPTION 'driver_not_available';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.rides r
    WHERE r.driver_id = p_driver_id
      AND r.status IN ('accepted', 'picking_up', 'in_progress')
  ) THEN
    RAISE EXCEPTION 'driver_active_ride';
  END IF;

  UPDATE public.driver_locations
  SET
    status = 'busy',
    updated_at = NOW()
  WHERE driver_id = p_driver_id;

  INSERT INTO public.rides (
    passenger_id,
    driver_id,
    origin_address,
    origin_lat,
    origin_lng,
    dest_address,
    dest_lat,
    dest_lng,
    distance_km,
    duration_min,
    surge_multiplier,
    price_kz,
    status,
    accepted_at,
    driver_confirmed,
    vehicle_type,
    traffic_factor
  )
  VALUES (
    p_passenger_id,
    p_driver_id,
    p_origin_address,
    p_origin_lat,
    p_origin_lng,
    p_dest_address,
    p_dest_lat,
    p_dest_lng,
    p_distance_km,
    p_duration_min,
    COALESCE(p_surge_multiplier, 1.0),
    p_price_kz,
    'accepted',
    NOW(),
    FALSE,
    COALESCE(NULLIF(p_vehicle_type, ''), 'standard'),
    COALESCE(p_traffic_factor, 1.0)
  )
  RETURNING * INTO v_ride;

  RETURN v_ride;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_selected_ride_atomic(
  UUID,
  UUID,
  TEXT,
  DOUBLE PRECISION,
  DOUBLE PRECISION,
  TEXT,
  DOUBLE PRECISION,
  DOUBLE PRECISION,
  NUMERIC,
  INTEGER,
  NUMERIC,
  NUMERIC,
  TEXT,
  NUMERIC
) TO authenticated;

DROP FUNCTION IF EXISTS public.validate_tracking_token(UUID);

CREATE OR REPLACE FUNCTION public.validate_tracking_token(p_token UUID)
RETURNS TABLE(
  ride_id UUID,
  status TEXT,
  student_name TEXT,
  driver_id UUID,
  dest_coords JSONB,
  driver_coords JSONB,
  driver_heading DOUBLE PRECISION,
  driver_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH school_tokens AS (
    SELECT
      COALESCE(r.id, sts.ride_id) AS token_ride_id,
      COALESCE(r.status::TEXT, 'searching') AS token_status,
      COALESCE(NULLIF(c.title, ''), 'Passageiro') AS token_subject,
      r.driver_id AS token_driver_id,
      jsonb_build_object(
        'lat', COALESCE(r.dest_lat, c.dest_lat),
        'lng', COALESCE(r.dest_lng, c.dest_lng)
      ) AS token_dest_coords,
      sts.created_at
    FROM public.school_tracking_sessions sts
    JOIN public.contracts c ON c.id = sts.contract_id
    LEFT JOIN public.rides r ON r.id = sts.ride_id
    WHERE sts.public_token = p_token
      AND sts.status = 'active'
      AND sts.expires_at > NOW()
  ),
  ride_tokens AS (
    SELECT
      rts.ride_id AS token_ride_id,
      COALESCE(r.status::TEXT, 'searching') AS token_status,
      COALESCE(NULLIF(pp.name, ''), 'Passageiro') AS token_subject,
      r.driver_id AS token_driver_id,
      jsonb_build_object(
        'lat', r.dest_lat,
        'lng', r.dest_lng
      ) AS token_dest_coords,
      rts.created_at
    FROM public.ride_tracking_shares rts
    JOIN public.rides r ON r.id = rts.ride_id
    LEFT JOIN public.profiles pp ON pp.user_id = r.passenger_id
    WHERE rts.public_token = p_token
      AND rts.status = 'active'
      AND rts.expires_at > NOW()
  ),
  tokens AS (
    SELECT * FROM school_tokens
    UNION ALL
    SELECT * FROM ride_tokens
  )
  SELECT
    tokens.token_ride_id,
    tokens.token_status,
    tokens.token_subject,
    tokens.token_driver_id,
    tokens.token_dest_coords,
    CASE
      WHEN dl.location IS NULL THEN NULL
      ELSE jsonb_build_object(
        'lat', ST_Y(dl.location::geometry),
        'lng', ST_X(dl.location::geometry)
      )
    END AS driver_coords,
    dl.heading::DOUBLE PRECISION AS driver_heading,
    dl.updated_at AS driver_updated_at
  FROM tokens
  LEFT JOIN public.driver_locations dl
    ON dl.driver_id = tokens.token_driver_id
  ORDER BY tokens.created_at DESC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_tracking_token(UUID) TO anon, authenticated;

COMMIT;
