-- =============================================================================
-- ZENITH RIDE — Migration: Security Fixes Consolidadas (P0 & P1)
-- Data: 2026-08-31
--
-- 1. complete_ride: liquida pagamento via process_ride_payment_v3
-- 2. process_ride_payment_v3: verificação atómica de saldo positivo
-- 3. create_selected_ride_atomic: validação de preço mínimo
-- 4. storage.objects: restringe uploads no bucket panic-audio por user_id
-- 5. get_searching_rides: garante checagem de role (driver / admin)
-- 6. route_deviation_alerts: tabela e RLS para participantes da corrida
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. process_ride_payment_v3 (com verificação estrita de saldo)
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.process_ride_payment_v3(
  UUID, UUID, UUID, NUMERIC, NUMERIC,
  TEXT, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT, DOUBLE PRECISION, DOUBLE PRECISION
);

CREATE OR REPLACE FUNCTION public.process_ride_payment_v3(
  p_ride_id       UUID,
  p_passenger_id  UUID,
  p_driver_id     UUID,
  p_amount        NUMERIC,
  p_distance_km   NUMERIC,
  p_origin_addr   TEXT,
  p_origin_lat    DOUBLE PRECISION,
  p_origin_lng    DOUBLE PRECISION,
  p_dest_addr     TEXT,
  p_dest_lat      DOUBLE PRECISION,
  p_dest_lng      DOUBLE PRECISION
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_platform_fee   NUMERIC;
  v_driver_earning NUMERIC;
  v_pass_bal_curr  NUMERIC;
  v_pass_bal_after NUMERIC;
  v_driv_bal_after NUMERIC;
BEGIN
  v_platform_fee   := ROUND(p_amount * 0.15, 2);
  v_driver_earning := p_amount - v_platform_fee;

  -- Garantir e bloquear carteira do passageiro
  INSERT INTO public.wallets (user_id, balance)
  VALUES (p_passenger_id, 0.00)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT balance INTO v_pass_bal_curr
  FROM public.wallets
  WHERE user_id = p_passenger_id
  FOR UPDATE;

  -- Validação atómica de saldo (evitar saldo negativo)
  IF COALESCE(v_pass_bal_curr, 0) < p_amount THEN
    RAISE EXCEPTION 'saldo_insuficiente_%', p_ride_id USING ERRCODE = 'P0001';
  END IF;

  -- Debitar passageiro
  UPDATE public.wallets
  SET balance    = balance - p_amount,
      updated_at = NOW()
  WHERE user_id = p_passenger_id
  RETURNING balance INTO v_pass_bal_after;

  INSERT INTO public.transactions
    (user_id, ride_id, amount, type, description, balance_after)
  VALUES (
    p_passenger_id, p_ride_id, -p_amount, 'ride_payment',
    format('Corrida %s → %s (%.1f km)', p_origin_addr, p_dest_addr, p_distance_km),
    COALESCE(v_pass_bal_after, 0)
  );

  -- Creditar motorista (85% do valor)
  INSERT INTO public.wallets (user_id, balance)
  VALUES (p_driver_id, v_driver_earning)
  ON CONFLICT (user_id) DO UPDATE
    SET balance    = wallets.balance + v_driver_earning,
        updated_at = NOW()
  RETURNING balance INTO v_driv_bal_after;

  INSERT INTO public.transactions
    (user_id, ride_id, amount, type, description, balance_after)
  VALUES (
    p_driver_id, p_ride_id, v_driver_earning, 'ride_earning',
    format('Ganho: %s → %s (%.1f km)', p_origin_addr, p_dest_addr, p_distance_km),
    COALESCE(v_driv_bal_after, v_driver_earning)
  );

  -- Actualizar km_total do motorista
  UPDATE public.profiles
  SET km_total = COALESCE(km_total, 0) + COALESCE(p_distance_km, 0)
  WHERE user_id = p_driver_id;

  -- Actualizar predições do Kaze Preditivo
  IF p_origin_addr IS NOT NULL AND p_dest_addr IS NOT NULL THEN
    INSERT INTO public.ride_predictions (
      user_id, origin_address, origin_lat, origin_lng,
      dest_address, dest_lat, dest_lng, frequency, last_used_at, avg_price_kz
    )
    VALUES (
      p_passenger_id, p_origin_addr, p_origin_lat, p_origin_lng,
      p_dest_addr,    p_dest_lat,    p_dest_lng,   1, NOW(), p_amount
    )
    ON CONFLICT (user_id, origin_address, dest_address)
    DO UPDATE SET
      frequency    = ride_predictions.frequency + 1,
      last_used_at = NOW(),
      avg_price_kz = ROUND((ride_predictions.avg_price_kz + EXCLUDED.avg_price_kz) / 2, 2);
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. complete_ride (chama process_ride_payment_v3)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_ride(
  p_ride_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_driver_id UUID := auth.uid();
  v_ride      RECORD;
BEGIN
  IF v_driver_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  IF NOT public.is_driver() AND NOT public.is_admin() THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_a_driver');
  END IF;

  SELECT * INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'ride_not_found');
  END IF;

  IF v_ride.driver_id != v_driver_id AND NOT public.is_admin() THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_your_ride');
  END IF;

  IF v_ride.status != 'in_progress' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_status', 'current_status', v_ride.status::text);
  END IF;

  UPDATE public.rides
  SET status       = 'completed',
      completed_at = NOW()
  WHERE id = p_ride_id;

  UPDATE public.driver_locations
  SET status = 'available', updated_at = NOW()
  WHERE driver_id = v_ride.driver_id;

  -- Processar pagamento
  IF v_ride.price_kz IS NOT NULL AND v_ride.price_kz > 0 AND v_ride.passenger_id IS NOT NULL THEN
    BEGIN
      PERFORM public.process_ride_payment_v3(
        p_ride_id,
        v_ride.passenger_id,
        v_ride.driver_id,
        v_ride.price_kz,
        COALESCE(v_ride.distance_km, 0),
        COALESCE(v_ride.origin_address, 'Origem'),
        v_ride.origin_lat,
        v_ride.origin_lng,
        COALESCE(v_ride.dest_address, 'Destino'),
        v_ride.dest_lat,
        v_ride.dest_lng
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Aviso: Falha ao liquidar pagamento v3 da corrida %: %', p_ride_id, SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object('success', true, 'ride_id', p_ride_id, 'new_status', 'completed');

EXCEPTION
  WHEN lock_not_available THEN
    RETURN jsonb_build_object('success', false, 'reason', 'concurrent_update');
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_ride(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.complete_ride(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.complete_ride(UUID) FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. create_selected_ride_atomic (com verificação de piso de preço)
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.create_selected_ride_atomic(UUID, UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, INTEGER, NUMERIC, NUMERIC, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION public.create_selected_ride_atomic(
  p_passenger_id UUID,
  p_driver_id UUID,
  p_origin_address TEXT,
  p_origin_lat DOUBLE PRECISION,
  p_origin_lng DOUBLE PRECISION,
  p_dest_address TEXT,
  p_dest_lat DOUBLE PRECISION,
  p_dest_lng DOUBLE PRECISION,
  p_distance_km NUMERIC,
  p_duration_min INTEGER,
  p_surge_multiplier NUMERIC,
  p_price_kz NUMERIC,
  p_vehicle_type TEXT DEFAULT 'standard',
  p_traffic_factor NUMERIC DEFAULT 1.0
) RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $create_selected$
DECLARE
  v_driver_status TEXT;
  v_ride public.rides;
  v_min_price NUMERIC;
BEGIN
  IF auth.uid() IS NULL OR (auth.uid() <> p_passenger_id AND NOT public.is_admin()) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  -- Validação de piso de preço
  SELECT COALESCE(MIN(price_kz), 500) INTO v_min_price FROM public.zone_prices WHERE active = true;
  IF p_price_kz IS NULL OR p_price_kz <= 0 OR p_price_kz < COALESCE(v_min_price, 500) THEN
    RAISE EXCEPTION 'invalid_price';
  END IF;

  BEGIN
    SELECT dl.status INTO v_driver_status FROM public.driver_locations dl WHERE dl.driver_id = p_driver_id FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'driver_not_available';
  END;
  IF NOT FOUND OR v_driver_status <> 'available' THEN
    RAISE EXCEPTION 'driver_not_available';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rides r WHERE r.driver_id = p_driver_id AND r.status IN ('accepted', 'picking_up', 'in_progress')) THEN
    RAISE EXCEPTION 'driver_active_ride';
  END IF;

  UPDATE public.driver_locations SET status = 'busy', updated_at = NOW() WHERE driver_id = p_driver_id;

  INSERT INTO public.rides (
    passenger_id, driver_id, origin_address, origin_lat, origin_lng, dest_address, dest_lat, dest_lng,
    distance_km, duration_min, surge_multiplier, price_kz, status, accepted_at, driver_confirmed, vehicle_type, traffic_factor
  ) VALUES (
    p_passenger_id, p_driver_id, p_origin_address, p_origin_lat, p_origin_lng, p_dest_address, p_dest_lat, p_dest_lng,
    p_distance_km, p_duration_min, COALESCE(p_surge_multiplier, 1.0), p_price_kz, 'accepted', NOW(), FALSE,
    COALESCE(NULLIF(p_vehicle_type, ''), 'standard'), COALESCE(p_traffic_factor, 1.0)
  ) RETURNING * INTO v_ride;

  RETURN v_ride;
END;
$create_selected$;

GRANT EXECUTE ON FUNCTION public.create_selected_ride_atomic(UUID, UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, INTEGER, NUMERIC, NUMERIC, TEXT, NUMERIC) TO authenticated;
REVOKE ALL ON FUNCTION public.create_selected_ride_atomic(UUID, UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, INTEGER, NUMERIC, NUMERIC, TEXT, NUMERIC) FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Storage Policy: panic-audio com path isolado por utilizador
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can upload panic audio" ON storage.objects;
CREATE POLICY "Users can upload panic audio"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'panic-audio'
    AND auth.uid()::text = (string_to_array(name, '/'))[1]
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. get_searching_rides (Validação explícita de motorista ou admin)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_searching_rides()
RETURNS TABLE(
  id              UUID,
  origin_address  TEXT,
  dest_address    TEXT,
  distance_km     NUMERIC,
  duration_min    INT,
  price_kz        NUMERIC,
  surge_multiplier NUMERIC,
  vehicle_type    TEXT,
  created_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.is_driver() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Apenas motoristas' USING ERRCODE = 'ROLE';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.origin_address,
    r.dest_address,
    r.distance_km,
    r.duration_min,
    r.price_kz,
    r.surge_multiplier,
    r.vehicle_type,
    r.created_at
  FROM public.rides r
  WHERE r.status = 'searching'
    AND r.driver_id IS NULL
  ORDER BY r.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_searching_rides() TO authenticated;
REVOKE ALL ON FUNCTION public.get_searching_rides() FROM anon;
REVOKE ALL ON FUNCTION public.get_searching_rides() FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. route_deviation_alerts (Tabela e RLS de participantes)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.route_deviation_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  deviation_km NUMERIC NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  alerted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.route_deviation_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants and admins can insert deviation alerts" ON public.route_deviation_alerts;
CREATE POLICY "Participants and admins can insert deviation alerts"
  ON public.route_deviation_alerts
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = route_deviation_alerts.ride_id
        AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid())
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Participants and admins can view deviation alerts" ON public.route_deviation_alerts;
CREATE POLICY "Participants and admins can view deviation alerts"
  ON public.route_deviation_alerts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = route_deviation_alerts.ride_id
        AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid())
    )
    OR public.is_admin()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. premium_bookings: Validação de preço mínimo de serviços premium
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.validate_premium_booking_price()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min_price NUMERIC;
BEGIN
  IF NEW.service_type IS NOT NULL THEN
    SELECT minimum_fare_kz INTO v_min_price
    FROM public.service_pricing
    WHERE service_type = NEW.service_type
      AND active = true
    LIMIT 1;

    IF v_min_price IS NOT NULL AND NEW.price_kz < v_min_price THEN
      RAISE EXCEPTION 'Preço inferior à tarifa mínima do serviço % (mínimo: % Kz)', NEW.service_type, v_min_price;
    END IF;
  END IF;

  IF NEW.price_kz IS NULL OR NEW.price_kz <= 0 THEN
    RAISE EXCEPTION 'Preço inválido para reserva premium';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_premium_booking_price ON public.premium_bookings;
CREATE TRIGGER trg_validate_premium_booking_price
  BEFORE INSERT OR UPDATE OF price_kz, service_type
  ON public.premium_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_premium_booking_price();

COMMIT;
