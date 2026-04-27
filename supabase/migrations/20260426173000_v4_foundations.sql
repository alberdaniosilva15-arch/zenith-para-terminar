ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'fleet_owner';

CREATE OR REPLACE FUNCTION public.set_my_role_fleet_owner()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.users
  SET role = 'fleet_owner', updated_at = NOW()
  WHERE id = auth.uid()
    AND role = 'passenger';
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_my_role_fleet_owner() TO authenticated;

ALTER TABLE public.ride_predictions
  ADD COLUMN IF NOT EXISTS day_of_week INT CHECK (day_of_week BETWEEN 0 AND 6);

CREATE TABLE IF NOT EXISTS public.ride_prediction_sources (
  ride_id UUID PRIMARY KEY REFERENCES public.rides(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP FUNCTION IF EXISTS public.sync_ride_prediction_from_completed_ride();
CREATE OR REPLACE FUNCTION public.sync_ride_prediction_from_completed_ride()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_completed_at TIMESTAMPTZ;
  v_hour INT;
  v_day_of_week INT;
  v_inserted UUID;
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.passenger_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_completed_at := COALESCE(NEW.completed_at, NOW());
  v_hour := EXTRACT(HOUR FROM (v_completed_at AT TIME ZONE 'Africa/Luanda'))::INT;
  v_day_of_week := EXTRACT(DOW FROM (v_completed_at AT TIME ZONE 'Africa/Luanda'))::INT;

  INSERT INTO public.ride_prediction_sources (ride_id, user_id)
  VALUES (NEW.id, NEW.passenger_id)
  ON CONFLICT (ride_id) DO NOTHING
  RETURNING ride_id INTO v_inserted;

  IF v_inserted IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.ride_predictions (
    user_id,
    origin_address,
    origin_lat,
    origin_lng,
    dest_address,
    dest_lat,
    dest_lng,
    frequency,
    last_used_at,
    best_hour,
    day_of_week,
    avg_price_kz
  ) VALUES (
    NEW.passenger_id,
    NEW.origin_address,
    NEW.origin_lat,
    NEW.origin_lng,
    NEW.dest_address,
    NEW.dest_lat,
    NEW.dest_lng,
    1,
    v_completed_at,
    v_hour,
    v_day_of_week,
    NEW.price_kz
  )
  ON CONFLICT (user_id, origin_address, dest_address) DO UPDATE SET
    frequency = ride_predictions.frequency + 1,
    last_used_at = EXCLUDED.last_used_at,
    best_hour = EXCLUDED.best_hour,
    day_of_week = EXCLUDED.day_of_week,
    avg_price_kz = ROUND(
      (
        COALESCE(ride_predictions.avg_price_kz, EXCLUDED.avg_price_kz)::NUMERIC * ride_predictions.frequency
        + COALESCE(EXCLUDED.avg_price_kz, ride_predictions.avg_price_kz)::NUMERIC
      ) / (ride_predictions.frequency + 1),
      2
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_ride_prediction_from_completed_ride ON public.rides;
CREATE TRIGGER trg_sync_ride_prediction_from_completed_ride
AFTER INSERT OR UPDATE OF status ON public.rides
FOR EACH ROW
EXECUTE FUNCTION public.sync_ride_prediction_from_completed_ride();

ALTER TABLE public.driver_locations
  ADD COLUMN IF NOT EXISTS online_minutes_idle INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS online_since TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.whatsapp_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES public.users(id),
  state TEXT NOT NULL DEFAULT 'IDLE',
  origin_address TEXT,
  origin_lat DOUBLE PRECISION,
  origin_lng DOUBLE PRECISION,
  dest_address TEXT,
  dest_lat DOUBLE PRECISION,
  dest_lng DOUBLE PRECISION,
  ride_id UUID REFERENCES public.rides(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_user_id ON public.whatsapp_sessions(user_id);

CREATE TABLE IF NOT EXISTS public.fleets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID REFERENCES public.users(id) NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.fleet_cars (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fleet_id UUID REFERENCES public.fleets(id) NOT NULL,
  plate TEXT NOT NULL,
  model TEXT,
  year INT,
  driver_id UUID REFERENCES public.users(id),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fleet_cars_fleet_id ON public.fleet_cars(fleet_id);
CREATE INDEX IF NOT EXISTS idx_fleet_cars_driver_id ON public.fleet_cars(driver_id);

CREATE TABLE IF NOT EXISTS public.fleet_driver_agreements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fleet_id UUID REFERENCES public.fleets(id) NOT NULL,
  driver_id UUID REFERENCES public.users(id) NOT NULL,
  car_id UUID REFERENCES public.fleet_cars(id),
  agreement_type TEXT NOT NULL DEFAULT 'minimal'
    CHECK (agreement_type IN ('weekly', 'transparent', 'minimal')),
  privacy_blackout_start TIME NOT NULL DEFAULT '12:00',
  privacy_blackout_end TIME NOT NULL DEFAULT '16:00',
  weekly_fee_kz INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fleet_driver_agreements_fleet_id ON public.fleet_driver_agreements(fleet_id);
CREATE INDEX IF NOT EXISTS idx_fleet_driver_agreements_driver_id ON public.fleet_driver_agreements(driver_id);

CREATE TABLE IF NOT EXISTS public.fleet_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fleet_id UUID NOT NULL UNIQUE REFERENCES public.fleets(id),
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'elite')),
  max_cars INT NOT NULL DEFAULT 2,
  price_per_car_kz INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

ALTER TABLE public.fleets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_cars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_driver_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fleet owner manage fleets" ON public.fleets;
CREATE POLICY "fleet owner manage fleets"
  ON public.fleets
  FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "fleet owner manage cars" ON public.fleet_cars;
CREATE POLICY "fleet owner manage cars"
  ON public.fleet_cars
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.fleets f
      WHERE f.id = fleet_cars.fleet_id
        AND f.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.fleets f
      WHERE f.id = fleet_cars.fleet_id
        AND f.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "fleet owner manage agreements" ON public.fleet_driver_agreements;
CREATE POLICY "fleet owner manage agreements"
  ON public.fleet_driver_agreements
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.fleets f
      WHERE f.id = fleet_driver_agreements.fleet_id
        AND f.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.fleets f
      WHERE f.id = fleet_driver_agreements.fleet_id
        AND f.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "driver read own agreements" ON public.fleet_driver_agreements;
CREATE POLICY "driver read own agreements"
  ON public.fleet_driver_agreements
  FOR SELECT
  USING (driver_id = auth.uid());

DROP POLICY IF EXISTS "driver update own agreements" ON public.fleet_driver_agreements;
CREATE POLICY "driver update own agreements"
  ON public.fleet_driver_agreements
  FOR UPDATE
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());

DROP POLICY IF EXISTS "fleet owner manage subscriptions" ON public.fleet_subscriptions;
CREATE POLICY "fleet owner manage subscriptions"
  ON public.fleet_subscriptions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.fleets f
      WHERE f.id = fleet_subscriptions.fleet_id
        AND f.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.fleets f
      WHERE f.id = fleet_subscriptions.fleet_id
        AND f.owner_id = auth.uid()
    )
  );
