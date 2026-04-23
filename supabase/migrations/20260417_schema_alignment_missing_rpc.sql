-- =============================================================================
-- ZENITH RIDE - schema alignment (repo <-> published environment)
-- Date: 2026-04-17
--
-- Goal:
-- 1) Align RPCs used by frontend but missing in local repo.
-- 2) Keep migration idempotent and safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) driver_status enum: add on_trip if missing
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'driver_status')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_enum
       WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'driver_status')
         AND enumlabel = 'on_trip'
     )
  THEN
    ALTER TYPE driver_status ADD VALUE 'on_trip';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) H3 columns on driver_locations (used by find_drivers_h3)
-- ---------------------------------------------------------------------------
ALTER TABLE public.driver_locations
  ADD COLUMN IF NOT EXISTS h3_index_res9 TEXT,
  ADD COLUMN IF NOT EXISTS h3_index_res7 TEXT;

CREATE INDEX IF NOT EXISTS idx_driver_locations_h3_res9
  ON public.driver_locations(h3_index_res9);

CREATE INDEX IF NOT EXISTS idx_driver_locations_h3_res7
  ON public.driver_locations(h3_index_res7);

-- ---------------------------------------------------------------------------
-- 3) find_drivers_h3
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.find_drivers_h3(TEXT[], INT);
CREATE OR REPLACE FUNCTION public.find_drivers_h3(
  p_h3_indexes TEXT[],
  p_limit      INT DEFAULT 8
)
RETURNS TABLE(
  driver_id    UUID,
  driver_name  TEXT,
  avatar_url   TEXT,
  rating       NUMERIC,
  total_rides  INT,
  level        TEXT,
  distance_m   DOUBLE PRECISION,
  eta_min      INT,
  heading      NUMERIC,
  motogo_score INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_h3_indexes IS NULL OR array_length(p_h3_indexes, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    dl.driver_id,
    pr.name                  AS driver_name,
    pr.avatar_url,
    pr.rating,
    pr.total_rides,
    pr.level,
    500::DOUBLE PRECISION    AS distance_m,
    2::INT                   AS eta_min,
    dl.heading,
    COALESCE(ms.score, 500)  AS motogo_score
  FROM public.driver_locations dl
  JOIN public.profiles pr ON pr.user_id = dl.driver_id
  LEFT JOIN public.motogo_scores ms ON ms.driver_id = dl.driver_id
  WHERE dl.status = 'available'
    AND dl.h3_index_res9 = ANY (p_h3_indexes)
  ORDER BY
    COALESCE(ms.score, 500) DESC,
    pr.rating DESC,
    dl.updated_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 8), 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_drivers_h3(TEXT[], INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) decline_ride_atomic
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.decline_ride_atomic(UUID, UUID);
CREATE OR REPLACE FUNCTION public.decline_ride_atomic(
  p_ride_id   UUID,
  p_driver_id UUID
)
RETURNS TABLE(
  success BOOLEAN,
  reason  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status    ride_status;
  v_driver_id UUID;
BEGIN
  BEGIN
    SELECT r.status, r.driver_id
      INTO v_status, v_driver_id
    FROM public.rides r
    WHERE r.id = p_ride_id
    FOR UPDATE NOWAIT;
  EXCEPTION
    WHEN lock_not_available THEN
      RETURN QUERY SELECT false, 'concurrent_update'::TEXT;
      RETURN;
  END;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'ride_not_found'::TEXT;
    RETURN;
  END IF;

  IF v_driver_id IS DISTINCT FROM p_driver_id THEN
    RETURN QUERY SELECT false, 'not_your_ride'::TEXT;
    RETURN;
  END IF;

  IF v_status NOT IN ('accepted', 'picking_up') THEN
    RETURN QUERY SELECT false, 'ride_not_declinable'::TEXT;
    RETURN;
  END IF;

  UPDATE public.rides
  SET
    driver_id        = NULL,
    driver_confirmed = FALSE,
    status           = 'searching',
    accepted_at      = NULL,
    pickup_at        = NULL
  WHERE id = p_ride_id;

  UPDATE public.driver_locations
  SET status = 'available', updated_at = NOW()
  WHERE driver_id = p_driver_id;

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decline_ride_atomic(UUID, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) validate_tracking_token
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.validate_tracking_token(UUID);
CREATE OR REPLACE FUNCTION public.validate_tracking_token(p_token UUID)
RETURNS TABLE(
  ride_id      UUID,
  status       TEXT,
  student_name TEXT,
  driver_id    UUID,
  dest_coords  JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(r.id, sts.ride_id) AS ride_id,
    COALESCE(r.status::TEXT, 'searching') AS status,
    COALESCE(NULLIF(c.title, ''), 'Passageiro') AS student_name,
    r.driver_id,
    jsonb_build_object(
      'lat', COALESCE(r.dest_lat, c.dest_lat),
      'lng', COALESCE(r.dest_lng, c.dest_lng)
    ) AS dest_coords
  FROM public.school_tracking_sessions sts
  JOIN public.contracts c ON c.id = sts.contract_id
  LEFT JOIN public.rides r ON r.id = sts.ride_id
  WHERE sts.public_token = p_token
    AND sts.status = 'active'
    AND sts.expires_at > NOW()
  ORDER BY sts.created_at DESC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_tracking_token(UUID) TO anon, authenticated;
