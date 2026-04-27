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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $tracking$
  WITH school_tokens AS (
    SELECT COALESCE(r.id, sts.ride_id) AS token_ride_id,
           COALESCE(r.status::TEXT, 'searching') AS token_status,
           COALESCE(NULLIF(c.title, ''), 'Passageiro') AS token_subject,
           r.driver_id AS token_driver_id,
           jsonb_build_object('lat', COALESCE(r.dest_lat, c.dest_lat), 'lng', COALESCE(r.dest_lng, c.dest_lng)) AS token_dest_coords,
           sts.created_at
    FROM public.school_tracking_sessions sts
    JOIN public.contracts c ON c.id = sts.contract_id
    LEFT JOIN public.rides r ON r.id = sts.ride_id
    WHERE sts.public_token = p_token AND sts.status = 'active' AND sts.expires_at > NOW()
  ), ride_tokens AS (
    SELECT rts.ride_id AS token_ride_id,
           COALESCE(r.status::TEXT, 'searching') AS token_status,
           COALESCE(NULLIF(pp.name, ''), 'Passageiro') AS token_subject,
           r.driver_id AS token_driver_id,
           jsonb_build_object('lat', r.dest_lat, 'lng', r.dest_lng) AS token_dest_coords,
           rts.created_at
    FROM public.ride_tracking_shares rts
    JOIN public.rides r ON r.id = rts.ride_id
    LEFT JOIN public.profiles pp ON pp.user_id = r.passenger_id
    WHERE rts.public_token = p_token AND rts.status = 'active' AND rts.expires_at > NOW()
  ), tokens AS (
    SELECT * FROM school_tokens
    UNION ALL
    SELECT * FROM ride_tokens
  )
  SELECT tokens.token_ride_id,
         tokens.token_status,
         tokens.token_subject,
         tokens.token_driver_id,
         tokens.token_dest_coords,
         CASE WHEN dl.location IS NULL THEN NULL ELSE jsonb_build_object('lat', ST_Y(dl.location::geometry), 'lng', ST_X(dl.location::geometry)) END AS driver_coords,
         dl.heading::DOUBLE PRECISION AS driver_heading,
         dl.updated_at AS driver_updated_at
  FROM tokens
  LEFT JOIN public.driver_locations dl ON dl.driver_id = tokens.token_driver_id
  ORDER BY tokens.created_at DESC
  LIMIT 1;
$tracking$;

GRANT EXECUTE ON FUNCTION public.validate_tracking_token(UUID) TO anon, authenticated;
