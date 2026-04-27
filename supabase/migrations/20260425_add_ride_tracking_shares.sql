-- =============================================================================
-- ZENITH RIDE v3.5.2
-- Tracking público para corridas normais sem reutilizar school_tracking_sessions
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ride_tracking_shares (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id       UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  public_token  UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  status        TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'completed', 'expired')),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '4 hours'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ride_tracking_shares_token
  ON public.ride_tracking_shares(public_token);

CREATE INDEX IF NOT EXISTS idx_ride_tracking_shares_ride_owner
  ON public.ride_tracking_shares(ride_id, owner_user_id, created_at DESC);

ALTER TABLE public.ride_tracking_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ride tracking: owner select" ON public.ride_tracking_shares;
CREATE POLICY "ride tracking: owner select"
  ON public.ride_tracking_shares FOR SELECT TO authenticated
  USING (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS "ride tracking: owner insert" ON public.ride_tracking_shares;
CREATE POLICY "ride tracking: owner insert"
  ON public.ride_tracking_shares FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = owner_user_id
    AND EXISTS (
      SELECT 1
      FROM public.rides r
      WHERE r.id = ride_id
        AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "ride tracking: owner update" ON public.ride_tracking_shares;
CREATE POLICY "ride tracking: owner update"
  ON public.ride_tracking_shares FOR UPDATE TO authenticated
  USING (auth.uid() = owner_user_id)
  WITH CHECK (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS "ride tracking: owner delete" ON public.ride_tracking_shares;
CREATE POLICY "ride tracking: owner delete"
  ON public.ride_tracking_shares FOR DELETE TO authenticated
  USING (auth.uid() = owner_user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ride_tracking_shares TO authenticated;

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
  )
  SELECT
    tokens.token_ride_id,
    tokens.token_status,
    tokens.token_subject,
    tokens.token_driver_id,
    tokens.token_dest_coords
  FROM (
    SELECT * FROM school_tokens
    UNION ALL
    SELECT * FROM ride_tokens
  ) AS tokens
  ORDER BY tokens.created_at DESC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_tracking_token(UUID) TO anon, authenticated;
