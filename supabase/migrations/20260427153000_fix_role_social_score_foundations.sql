BEGIN;

CREATE OR REPLACE FUNCTION public.set_my_role_passenger()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.users
  SET role = 'passenger', updated_at = NOW()
  WHERE id = auth.uid()
    AND role IN ('driver', 'fleet_owner');
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_my_role_passenger() TO authenticated;

CREATE OR REPLACE FUNCTION public.increment_post_likes(p_post_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_likes INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN -1;
  END IF;

  UPDATE public.posts
  SET likes = COALESCE(likes, 0) + 1
  WHERE id = p_post_id
  RETURNING likes INTO v_likes;

  RETURN COALESCE(v_likes, -1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_post_likes(UUID) TO authenticated;

CREATE TABLE IF NOT EXISTS public.zenith_scores (
  driver_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 1000),
  score_label TEXT NOT NULL DEFAULT 'Sem Historial'
    CHECK (score_label IN ('Sem Historial', 'Básico', 'Médio', 'Bom', 'Excelente', 'Extraordinário')),
  rides_component INTEGER NOT NULL DEFAULT 0 CHECK (rides_component BETWEEN 0 AND 400),
  rating_component INTEGER NOT NULL DEFAULT 0 CHECK (rating_component BETWEEN 0 AND 300),
  level_component INTEGER NOT NULL DEFAULT 0 CHECK (level_component BETWEEN 0 AND 200),
  consistency_pct INTEGER NOT NULL DEFAULT 0 CHECK (consistency_pct BETWEEN 0 AND 100),
  last_calculated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.zenith_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "zenith_scores own read" ON public.zenith_scores;
CREATE POLICY "zenith_scores own read"
  ON public.zenith_scores FOR SELECT
  USING (driver_id = auth.uid() OR public.is_admin_secure());

CREATE OR REPLACE FUNCTION public.calculate_zenith_score(p_driver_id UUID)
RETURNS SETOF public.zenith_scores
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rating NUMERIC := 0;
  v_total_rides INTEGER := 0;
  v_level TEXT := 'Novato';
  v_recent_count INTEGER := 0;
  v_completed_count INTEGER := 0;
  v_rides_component INTEGER := 0;
  v_rating_component INTEGER := 0;
  v_level_component INTEGER := 0;
  v_consistency_pct INTEGER := 0;
  v_score INTEGER := 0;
  v_score_label TEXT := 'Sem Historial';
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  IF auth.uid() <> p_driver_id AND NOT public.is_admin_secure() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = p_driver_id
  ) THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(p.rating, 0),
    COALESCE(p.total_rides, 0),
    COALESCE(p.level, 'Novato')
  INTO
    v_rating,
    v_total_rides,
    v_level
  FROM public.profiles p
  WHERE p.user_id = p_driver_id;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE recent.status = 'completed')
  INTO
    v_recent_count,
    v_completed_count
  FROM (
    SELECT r.status
    FROM public.rides r
    WHERE r.driver_id = p_driver_id
    ORDER BY COALESCE(r.completed_at, r.created_at) DESC
    LIMIT 30
  ) AS recent;

  v_rides_component := LEAST(GREATEST(v_total_rides * 2, 0), 400);
  v_rating_component := LEAST(GREATEST(ROUND((v_rating / 5.0) * 300)::INTEGER, 0), 300);
  v_level_component := CASE v_level
    WHEN 'Bronze' THEN 50
    WHEN 'Prata' THEN 100
    WHEN 'Ouro' THEN 150
    WHEN 'Diamante' THEN 200
    ELSE 0
  END;
  v_consistency_pct := CASE
    WHEN v_recent_count = 0 THEN LEAST(GREATEST(v_total_rides, 0), 100)
    ELSE LEAST(
      GREATEST(ROUND((v_completed_count::NUMERIC / NULLIF(v_recent_count, 0)) * 100)::INTEGER, 0),
      100
    )
  END;

  v_score := LEAST(v_rides_component + v_rating_component + v_level_component + v_consistency_pct, 1000);
  v_score_label := CASE
    WHEN v_score >= 900 THEN 'Extraordinário'
    WHEN v_score >= 750 THEN 'Excelente'
    WHEN v_score >= 600 THEN 'Bom'
    WHEN v_score >= 400 THEN 'Médio'
    WHEN v_score > 0 THEN 'Básico'
    ELSE 'Sem Historial'
  END;

  INSERT INTO public.zenith_scores (
    driver_id,
    score,
    score_label,
    rides_component,
    rating_component,
    level_component,
    consistency_pct,
    last_calculated
  )
  VALUES (
    p_driver_id,
    v_score,
    v_score_label,
    v_rides_component,
    v_rating_component,
    v_level_component,
    v_consistency_pct,
    NOW()
  )
  ON CONFLICT (driver_id) DO UPDATE
  SET
    score = EXCLUDED.score,
    score_label = EXCLUDED.score_label,
    rides_component = EXCLUDED.rides_component,
    rating_component = EXCLUDED.rating_component,
    level_component = EXCLUDED.level_component,
    consistency_pct = EXCLUDED.consistency_pct,
    last_calculated = EXCLUDED.last_calculated;

  RETURN QUERY
  SELECT *
  FROM public.zenith_scores
  WHERE driver_id = p_driver_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_zenith_score(UUID) TO authenticated;

COMMIT;
