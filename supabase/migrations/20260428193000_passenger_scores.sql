BEGIN;

CREATE TABLE IF NOT EXISTS public.passenger_scores (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 500 CHECK (score BETWEEN 0 AND 1000),
  rides_component INTEGER NOT NULL DEFAULT 0 CHECK (rides_component BETWEEN 0 AND 400),
  payment_component INTEGER NOT NULL DEFAULT 0 CHECK (payment_component BETWEEN 0 AND 300),
  behavior_component INTEGER NOT NULL DEFAULT 0 CHECK (behavior_component BETWEEN 0 AND 300),
  cancel_rate_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  last_calculated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.passenger_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "passenger_scores own read" ON public.passenger_scores;
CREATE POLICY "passenger_scores own read"
  ON public.passenger_scores FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin_secure());

CREATE OR REPLACE FUNCTION public.calculate_passenger_score(p_user_id UUID)
RETURNS SETOF public.passenger_scores
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_rides INTEGER := 0;
  v_completed_rides INTEGER := 0;
  v_cancelled_rides INTEGER := 0;
  v_profile_rating NUMERIC := 0;
  v_rides_component INTEGER := 0;
  v_payment_component INTEGER := 0;
  v_behavior_component INTEGER := 0;
  v_score INTEGER := 0;
  v_cancel_rate NUMERIC(5,2) := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  IF auth.uid() <> p_user_id AND NOT public.is_admin_secure() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = p_user_id
  ) THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(COUNT(*), 0),
    COALESCE(COUNT(*) FILTER (WHERE r.status = 'completed'), 0),
    COALESCE(COUNT(*) FILTER (WHERE r.status = 'cancelled'), 0)
  INTO
    v_total_rides,
    v_completed_rides,
    v_cancelled_rides
  FROM public.rides r
  WHERE r.passenger_id = p_user_id;

  SELECT COALESCE(p.rating, 0)
  INTO v_profile_rating
  FROM public.profiles p
  WHERE p.user_id = p_user_id;

  v_rides_component := LEAST(GREATEST(v_completed_rides, 0), 400);
  v_payment_component := LEAST(GREATEST(ROUND((v_profile_rating / 5.0) * 300)::INTEGER, 0), 300);
  v_behavior_component := GREATEST(0, 300 - v_cancelled_rides * 30);
  v_cancel_rate := CASE
    WHEN v_total_rides = 0 THEN 0
    ELSE ROUND((v_cancelled_rides::NUMERIC / v_total_rides::NUMERIC) * 100, 2)
  END;
  v_score := LEAST(1000, v_rides_component + v_payment_component + v_behavior_component);

  INSERT INTO public.passenger_scores (
    user_id,
    score,
    rides_component,
    payment_component,
    behavior_component,
    cancel_rate_pct,
    last_calculated
  )
  VALUES (
    p_user_id,
    v_score,
    v_rides_component,
    v_payment_component,
    v_behavior_component,
    v_cancel_rate,
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    score = EXCLUDED.score,
    rides_component = EXCLUDED.rides_component,
    payment_component = EXCLUDED.payment_component,
    behavior_component = EXCLUDED.behavior_component,
    cancel_rate_pct = EXCLUDED.cancel_rate_pct,
    last_calculated = EXCLUDED.last_calculated;

  RETURN QUERY
  SELECT *
  FROM public.passenger_scores
  WHERE user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_passenger_score(UUID) TO authenticated;

COMMIT;
