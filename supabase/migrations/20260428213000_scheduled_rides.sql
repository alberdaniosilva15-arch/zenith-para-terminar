BEGIN;

CREATE TABLE IF NOT EXISTS public.scheduled_rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  pickup_address TEXT NOT NULL,
  pickup_lat DOUBLE PRECISION NOT NULL,
  pickup_lng DOUBLE PRECISION NOT NULL,
  dest_address TEXT NOT NULL,
  dest_lat DOUBLE PRECISION NOT NULL,
  dest_lng DOUBLE PRECISION NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  recurrence TEXT NOT NULL DEFAULT 'none'
    CHECK (recurrence IN ('none', 'daily', 'weekdays', 'weekly')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'scheduled', 'matched', 'completed', 'cancelled', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_rides_user_scheduled_at
  ON public.scheduled_rides (user_id, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS idx_scheduled_rides_status_scheduled_at
  ON public.scheduled_rides (status, scheduled_at ASC);

ALTER TABLE public.scheduled_rides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scheduled_rides own read" ON public.scheduled_rides;
CREATE POLICY "scheduled_rides own read"
  ON public.scheduled_rides FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin_secure());

DROP POLICY IF EXISTS "scheduled_rides own insert" ON public.scheduled_rides;
CREATE POLICY "scheduled_rides own insert"
  ON public.scheduled_rides FOR INSERT
  WITH CHECK (user_id = auth.uid() OR public.is_admin_secure());

DROP POLICY IF EXISTS "scheduled_rides own update" ON public.scheduled_rides;
CREATE POLICY "scheduled_rides own update"
  ON public.scheduled_rides FOR UPDATE
  USING (user_id = auth.uid() OR public.is_admin_secure())
  WITH CHECK (user_id = auth.uid() OR public.is_admin_secure());

DROP POLICY IF EXISTS "scheduled_rides own delete" ON public.scheduled_rides;
CREATE POLICY "scheduled_rides own delete"
  ON public.scheduled_rides FOR DELETE
  USING (user_id = auth.uid() OR public.is_admin_secure());

CREATE OR REPLACE FUNCTION public.touch_scheduled_ride_updated_at()
RETURNS trigger
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;

DROP TRIGGER IF EXISTS trg_touch_scheduled_ride_updated_at ON public.scheduled_rides;
CREATE TRIGGER trg_touch_scheduled_ride_updated_at
BEFORE UPDATE ON public.scheduled_rides
FOR EACH ROW
EXECUTE FUNCTION public.touch_scheduled_ride_updated_at();

COMMIT;
