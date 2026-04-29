BEGIN;

ALTER TABLE public.ride_predictions
  ADD COLUMN IF NOT EXISTS proactive BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dismissals INTEGER NOT NULL DEFAULT 0 CHECK (dismissals >= 0),
  ADD COLUMN IF NOT EXISTS impressions INTEGER NOT NULL DEFAULT 0 CHECK (impressions >= 0);

CREATE INDEX IF NOT EXISTS idx_ride_predictions_user_proactive_hour
  ON public.ride_predictions (user_id, proactive, best_hour);

UPDATE public.ride_predictions
SET proactive = frequency >= 3
WHERE proactive IS DISTINCT FROM (frequency >= 3);

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
    avg_price_kz,
    proactive
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
    NEW.price_kz,
    false
  )
  ON CONFLICT (user_id, origin_address, dest_address) DO UPDATE SET
    frequency = ride_predictions.frequency + 1,
    last_used_at = EXCLUDED.last_used_at,
    best_hour = EXCLUDED.best_hour,
    day_of_week = EXCLUDED.day_of_week,
    proactive = (ride_predictions.frequency + 1) >= 3,
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

CREATE OR REPLACE FUNCTION public.bump_ride_prediction_impressions(p_prediction_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_prediction_ids IS NULL OR array_length(p_prediction_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.ride_predictions
  SET impressions = impressions + 1
  WHERE user_id = auth.uid()
    AND id = ANY(p_prediction_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bump_ride_prediction_impressions(UUID[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.bump_ride_prediction_dismissal(p_prediction_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.ride_predictions
  SET dismissals = dismissals + 1
  WHERE user_id = auth.uid()
    AND id = p_prediction_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bump_ride_prediction_dismissal(UUID) TO authenticated;

COMMIT;
