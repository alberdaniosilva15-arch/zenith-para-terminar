-- =============================================================================
-- UNIFICAR validate_tracking_token(p_token text)
-- Remove sobrecarga antiga de (text) -> jsonb que causava conflito com (uuid) -> table
-- =============================================================================

DROP FUNCTION IF EXISTS public.validate_tracking_token(text);
DROP FUNCTION IF EXISTS public.validate_tracking_token(uuid);

CREATE OR REPLACE FUNCTION public.validate_tracking_token(p_token text)
RETURNS TABLE (
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
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_ride_id UUID;
  v_token_uuid UUID;
BEGIN
  -- Tentar converter p_token para UUID com protecção contra erros
  BEGIN
    v_token_uuid := p_token::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_token_uuid := NULL;
  END;

  -- 1. Se for UUID, verificar se corresponde a um public_token activo em ride_tracking_shares
  IF v_token_uuid IS NOT NULL THEN
    SELECT rts.ride_id INTO v_ride_id
    FROM public.ride_tracking_shares rts
    WHERE rts.public_token = v_token_uuid AND rts.expires_at > NOW()
    LIMIT 1;
  END IF;

  -- 2. Se não encontrar, verificar se corresponde directamente a um r.id ou r.public_token
  IF v_ride_id IS NULL AND v_token_uuid IS NOT NULL THEN
    SELECT r.id INTO v_ride_id
    FROM public.rides r
    WHERE r.id = v_token_uuid OR r.public_token = v_token_uuid
    LIMIT 1;
  END IF;

  IF v_ride_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 
    r.id AS ride_id,
    r.status::TEXT AS status,
    COALESCE(r.student_name, p.name, 'Passageiro') AS student_name,
    r.driver_id,
    CASE 
      WHEN r.dest_lat IS NOT NULL AND r.dest_lng IS NOT NULL 
      THEN jsonb_build_object('lat', r.dest_lat, 'lng', r.dest_lng)
      ELSE NULL
    END AS dest_coords,
    CASE 
      WHEN dl.location IS NOT NULL 
      THEN jsonb_build_object('lat', ST_Y(dl.location::geometry), 'lng', ST_X(dl.location::geometry))
      ELSE NULL
    END AS driver_coords,
    dl.heading::DOUBLE PRECISION AS driver_heading,
    dl.updated_at AS driver_updated_at
  FROM public.rides r
  LEFT JOIN public.profiles p ON p.user_id = r.passenger_id
  LEFT JOIN public.driver_locations dl ON dl.driver_id = r.driver_id
  WHERE r.id = v_ride_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_tracking_token(text) TO anon, authenticated;
