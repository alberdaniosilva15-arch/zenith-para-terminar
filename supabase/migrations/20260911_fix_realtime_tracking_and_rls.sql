BEGIN;

-- 1. Coluna updated_at na tabela rides
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Trigger para actualizar updated_at na tabela rides
CREATE OR REPLACE FUNCTION public.set_rides_updated_at()
RETURNS TRIGGER 
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rides_updated_at ON public.rides;
CREATE TRIGGER trg_rides_updated_at
  BEFORE UPDATE ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION public.set_rides_updated_at();

-- 3. Corrigir RLS em public.rides para que o passageiro SEMPRE consiga ler a sua corrida
DROP POLICY IF EXISTS "rides_select_own_passenger" ON public.rides;
DROP POLICY IF EXISTS "rides_select_own_driver" ON public.rides;
DROP POLICY IF EXISTS "rides_select_participants" ON public.rides;

CREATE POLICY "rides_select_participants"
  ON public.rides FOR SELECT TO authenticated
  USING (
    passenger_id = auth.uid() 
    OR driver_id = auth.uid() 
    OR public.is_admin()
  );

-- 4. Corrigir RLS em public.driver_locations para que o passageiro veja a posição do motorista
DROP POLICY IF EXISTS "dl_select_own_driver" ON public.driver_locations;
DROP POLICY IF EXISTS "dl_select_participants" ON public.driver_locations;

CREATE POLICY "dl_select_participants"
  ON public.driver_locations FOR SELECT TO authenticated
  USING (
    driver_id = auth.uid()
    OR status = 'available'
    OR EXISTS (
      SELECT 1 FROM public.rides
      WHERE rides.driver_id = driver_locations.driver_id
        AND (rides.passenger_id = auth.uid() OR rides.driver_id = auth.uid() OR public.is_admin())
        AND rides.status IN ('accepted', 'picking_up', 'in_progress')
    )
  );

-- 5. Atualizar validate_tracking_token para suportar ride_id e retornar dados GPS completos
CREATE OR REPLACE FUNCTION public.validate_tracking_token(p_token UUID)
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
BEGIN
  -- Verificar se é um tracking_token em ride_tracking_shares
  SELECT rts.ride_id INTO v_ride_id
  FROM public.ride_tracking_shares rts
  WHERE rts.tracking_token = p_token AND rts.expires_at > NOW()
  LIMIT 1;

  -- Se não for, verificar se é o próprio ID da corrida
  IF v_ride_id IS NULL THEN
    SELECT r.id INTO v_ride_id
    FROM public.rides r
    WHERE r.id = p_token
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

GRANT EXECUTE ON FUNCTION public.validate_tracking_token(UUID) TO anon, authenticated;

COMMIT;
