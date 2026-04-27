BEGIN;

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'fleet_owner';

CREATE OR REPLACE FUNCTION public.decrement_chat_quota(p_user_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS '
  UPDATE public.profiles
  SET chat_quota = GREATEST(0, COALESCE(chat_quota, 10) - 1)
  WHERE user_id = p_user_id;
';

GRANT EXECUTE ON FUNCTION public.decrement_chat_quota(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_my_role_fleet_owner()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS '
  UPDATE public.users
  SET role = ''fleet_owner'', updated_at = NOW()
  WHERE id = auth.uid()
    AND role IN (''passenger'', ''driver'');
';

GRANT EXECUTE ON FUNCTION public.set_my_role_fleet_owner() TO authenticated;

CREATE TABLE IF NOT EXISTS public.service_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type TEXT NOT NULL
    CHECK (service_type IN ('standard', 'moto', 'comfort', 'xl', 'private_driver', 'charter', 'cargo')),
  city TEXT NOT NULL DEFAULT 'Luanda',
  base_fare_kz NUMERIC NOT NULL DEFAULT 0,
  price_per_km_kz NUMERIC NOT NULL DEFAULT 0,
  price_per_minute_kz NUMERIC NOT NULL DEFAULT 0,
  price_per_hour_kz NUMERIC NOT NULL DEFAULT 0,
  minimum_fare_kz NUMERIC NOT NULL DEFAULT 0,
  surge_multiplier NUMERIC NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_type, city)
);

ALTER TABLE public.service_pricing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_pricing read active" ON public.service_pricing;
CREATE POLICY "service_pricing read active"
  ON public.service_pricing FOR SELECT
  USING (active = TRUE OR public.is_admin_secure());

DROP POLICY IF EXISTS "service_pricing admin manage" ON public.service_pricing;
CREATE POLICY "service_pricing admin manage"
  ON public.service_pricing FOR ALL
  USING (public.is_admin_secure())
  WITH CHECK (public.is_admin_secure());

INSERT INTO public.service_pricing (
  service_type,
  city,
  base_fare_kz,
  price_per_km_kz,
  price_per_minute_kz,
  price_per_hour_kz,
  minimum_fare_kz,
  surge_multiplier,
  active
)
VALUES
  ('standard', 'Luanda', 700, 180, 15, 0, 1200, 1.00, TRUE),
  ('moto', 'Luanda', 350, 90, 8, 0, 600, 1.00, TRUE),
  ('comfort', 'Luanda', 1100, 250, 18, 0, 1800, 1.05, TRUE),
  ('xl', 'Luanda', 1700, 320, 22, 0, 2600, 1.08, TRUE),
  ('private_driver', 'Luanda', 2500, 280, 90, 6000, 12000, 1.10, TRUE),
  ('charter', 'Luanda', 8000, 320, 0, 0, 25000, 1.00, TRUE),
  ('cargo', 'Luanda', 4500, 240, 18, 0, 6500, 1.00, TRUE)
ON CONFLICT (service_type, city) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_service_pricing_service_city
  ON public.service_pricing(service_type, city)
  WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS public.premium_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  service_type TEXT NOT NULL
    CHECK (service_type IN ('private_driver', 'charter', 'cargo')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled')),
  driver_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  favorite_driver_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  pickup_address TEXT,
  pickup_lat DOUBLE PRECISION,
  pickup_lng DOUBLE PRECISION,
  dest_address TEXT,
  dest_lat DOUBLE PRECISION,
  dest_lng DOUBLE PRECISION,
  scheduled_at TIMESTAMPTZ,
  duration_hours INT CHECK (duration_hours IS NULL OR duration_hours > 0),
  vehicle_class TEXT
    CHECK (vehicle_class IS NULL OR vehicle_class IN ('standard', 'suv', 'executive')),
  price_kz NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  notify_me BOOLEAN NOT NULL DEFAULT FALSE,
  route_stops JSONB,
  pricing_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.premium_bookings
  ADD COLUMN IF NOT EXISTS notify_me BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS route_stops JSONB,
  ADD COLUMN IF NOT EXISTS pricing_snapshot JSONB;

CREATE TABLE IF NOT EXISTS public.cargo_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES public.premium_bookings(id) ON DELETE CASCADE,
  cargo_type TEXT NOT NULL CHECK (cargo_type IN ('light', 'medium', 'heavy')),
  needs_helpers BOOLEAN NOT NULL DEFAULT FALSE,
  helper_count INT NOT NULL DEFAULT 0 CHECK (helper_count BETWEEN 0 AND 3),
  estimated_weight_kg NUMERIC,
  urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal', 'express')),
  special_instructions TEXT
);

CREATE TABLE IF NOT EXISTS public.charter_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES public.premium_bookings(id) ON DELETE CASCADE,
  capacity INT NOT NULL DEFAULT 20 CHECK (capacity IN (20, 40, 60)),
  event_type TEXT,
  route_description TEXT,
  return_trip BOOLEAN NOT NULL DEFAULT FALSE
);

ALTER TABLE public.premium_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cargo_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.charter_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "premium bookings own manage" ON public.premium_bookings;
CREATE POLICY "premium bookings own manage"
  ON public.premium_bookings FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "premium bookings admin read" ON public.premium_bookings;
CREATE POLICY "premium bookings admin read"
  ON public.premium_bookings FOR SELECT
  USING (public.is_admin_secure());

DROP POLICY IF EXISTS "premium bookings admin update" ON public.premium_bookings;
CREATE POLICY "premium bookings admin update"
  ON public.premium_bookings FOR UPDATE
  USING (public.is_admin_secure())
  WITH CHECK (public.is_admin_secure());

DROP POLICY IF EXISTS "cargo own manage" ON public.cargo_bookings;
CREATE POLICY "cargo own manage"
  ON public.cargo_bookings FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.premium_bookings pb
      WHERE pb.id = cargo_bookings.booking_id
        AND pb.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.premium_bookings pb
      WHERE pb.id = cargo_bookings.booking_id
        AND pb.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "cargo admin read" ON public.cargo_bookings;
CREATE POLICY "cargo admin read"
  ON public.cargo_bookings FOR SELECT
  USING (public.is_admin_secure());

DROP POLICY IF EXISTS "charter own manage" ON public.charter_bookings;
CREATE POLICY "charter own manage"
  ON public.charter_bookings FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.premium_bookings pb
      WHERE pb.id = charter_bookings.booking_id
        AND pb.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.premium_bookings pb
      WHERE pb.id = charter_bookings.booking_id
        AND pb.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "charter admin read" ON public.charter_bookings;
CREATE POLICY "charter admin read"
  ON public.charter_bookings FOR SELECT
  USING (public.is_admin_secure());

CREATE INDEX IF NOT EXISTS idx_premium_bookings_user
  ON public.premium_bookings(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_premium_bookings_status
  ON public.premium_bookings(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_premium_bookings_service
  ON public.premium_bookings(service_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_premium_bookings_driver
  ON public.premium_bookings(driver_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.fleet_billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_id UUID NOT NULL REFERENCES public.fleets(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('free', 'pro', 'elite')),
  amount_kz NUMERIC NOT NULL DEFAULT 0,
  cars_count INT NOT NULL DEFAULT 0,
  billing_month DATE NOT NULL DEFAULT date_trunc('month', NOW())::DATE,
  pdf_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.fleet_billing_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fleet billing owner read" ON public.fleet_billing_events;
CREATE POLICY "fleet billing owner read"
  ON public.fleet_billing_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.fleets f
      WHERE f.id = fleet_billing_events.fleet_id
        AND f.owner_id = auth.uid()
    )
    OR public.is_admin_secure()
  );

DROP POLICY IF EXISTS "fleet billing owner insert" ON public.fleet_billing_events;
CREATE POLICY "fleet billing owner insert"
  ON public.fleet_billing_events FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.fleets f
      WHERE f.id = fleet_billing_events.fleet_id
        AND f.owner_id = auth.uid()
    )
    OR public.is_admin_secure()
  );

CREATE INDEX IF NOT EXISTS idx_fleet_billing_events_fleet
  ON public.fleet_billing_events(fleet_id, created_at DESC);

ALTER TABLE public.driver_documents
  ADD COLUMN IF NOT EXISTS expires_at DATE;

ALTER TABLE public.panic_alerts
  ADD COLUMN IF NOT EXISTS severity TEXT,
  ADD COLUMN IF NOT EXISTS audio_storage_path TEXT;

UPDATE public.panic_alerts
SET severity = 'high'
WHERE severity IS NULL;

ALTER TABLE public.panic_alerts
  ALTER COLUMN severity SET DEFAULT 'high';

ALTER TABLE public.panic_alerts
  ALTER COLUMN severity SET NOT NULL;

ALTER TABLE public.panic_alerts
  DROP CONSTRAINT IF EXISTS panic_alerts_severity_check;

ALTER TABLE public.panic_alerts
  ADD CONSTRAINT panic_alerts_severity_check
  CHECK (severity IN ('medium', 'high', 'critical'));

DROP POLICY IF EXISTS "panic_update_admin" ON public.panic_alerts;
CREATE POLICY "panic_update_admin"
  ON public.panic_alerts FOR UPDATE
  USING (public.is_admin_secure())
  WITH CHECK (public.is_admin_secure());

COMMIT;
