-- ═════════════════════════════════════════════════════════════════════════════
-- ZENITH RIDE — Migration 20260902: Fix Auction Timeout & Price Floor Security
-- 
-- 1. BUG 6: Trigger BEFORE INSERT/UPDATE para garantir piso mínimo de preço
--    na tabela `rides`, impedindo burlas com corridas de 0 ou 1 Kz.
-- 2. BUG 5: Função `expire_unconfirmed_auction_rides` para auto-cancelar
--    corridas de leilão pendentes de confirmação há mais de 2 minutos e libertar
--    o motorista de volta para `available`.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. BUG 6: TRIGGER DE PISO DE PREÇO (Prevenção de Fraude)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.validate_ride_price_floor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_min_price NUMERIC;
BEGIN
  -- Obter piso mínimo de preço configurado nas zonas activas (ou 500 Kz default)
  SELECT COALESCE(MIN(price_kz), 500) INTO v_min_price 
  FROM public.zone_prices 
  WHERE active = true;

  IF NEW.price_kz IS NULL OR NEW.price_kz < COALESCE(v_min_price, 500) THEN
    RAISE EXCEPTION 'invalid_price: O valor da corrida (% Kz) e inferior ao piso minimo permitido (% Kz)', 
      COALESCE(NEW.price_kz, 0), COALESCE(v_min_price, 500);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_ride_price_floor ON public.rides;
CREATE TRIGGER trg_validate_ride_price_floor
  BEFORE INSERT OR UPDATE OF price_kz ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_ride_price_floor();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. BUG 5: FUNÇÃO DE EXPIRAÇÃO DE LEILÕES NÃO CONFIRMADOS (> 2 MIN)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expire_unconfirmed_auction_rides()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_expired_count INTEGER := 0;
  v_ride RECORD;
BEGIN
  FOR v_ride IN
    SELECT id, driver_id
    FROM public.rides
    WHERE status = 'accepted'
      AND driver_confirmed = FALSE
      AND accepted_at < (NOW() - INTERVAL '2 minutes')
    FOR UPDATE SKIP LOCKED
  LOOP
    -- 1. Cancelar a corrida pendente
    UPDATE public.rides
    SET status = 'cancelled',
        cancelled_at = NOW(),
        cancel_reason = 'Expirado: Motorista não confirmou a tempo (timeout 2 min)',
        updated_at = NOW()
    WHERE id = v_ride.id;

    -- 2. Libertar o motorista de volta para 'available' se não tiver outra corrida activa
    IF v_ride.driver_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.rides 
        WHERE driver_id = v_ride.driver_id 
          AND status IN ('accepted', 'picking_up', 'in_progress')
          AND id <> v_ride.id
      ) THEN
        UPDATE public.driver_locations
        SET status = 'available',
            updated_at = NOW()
        WHERE driver_id = v_ride.driver_id;
      END IF;
    END IF;

    v_expired_count := v_expired_count + 1;
  END LOOP;

  RETURN v_expired_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_unconfirmed_auction_rides() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.expire_unconfirmed_auction_rides() FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. INTEGRAR EXPIRAÇÃO AUTOMÁTICA EM get_active_ride
-- ─────────────────────────────────────────────────────────────────────────────
-- Sempre que um cliente consulta corridas activas, limpa automaticamente as expiradas
CREATE OR REPLACE FUNCTION public.get_active_ride()
RETURNS TABLE (
  id               UUID,
  passenger_id     UUID,
  driver_id        UUID,
  origin_address   TEXT,
  origin_lat       DOUBLE PRECISION,
  origin_lng       DOUBLE PRECISION,
  dest_address     TEXT,
  dest_lat         DOUBLE PRECISION,
  dest_lng         DOUBLE PRECISION,
  distance_km      NUMERIC,
  duration_min     INTEGER,
  surge_multiplier NUMERIC,
  price_kz         NUMERIC,
  status           TEXT,
  driver_confirmed BOOLEAN,
  vehicle_type     TEXT,
  traffic_factor   NUMERIC,
  created_at       TIMESTAMPTZ,
  accepted_at      TIMESTAMPTZ,
  pickup_at        TIMESTAMPTZ,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  cancel_reason    TEXT,
  driver_name      TEXT,
  passenger_name   TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RETURN;
  END IF;

  -- Limpar corridas de leilão expiradas em background
  PERFORM public.expire_unconfirmed_auction_rides();

  RETURN QUERY
  SELECT 
    r.id,
    r.passenger_id,
    r.driver_id,
    r.origin_address,
    r.origin_lat,
    r.origin_lng,
    r.dest_address,
    r.dest_lat,
    r.dest_lng,
    r.distance_km,
    r.duration_min,
    r.surge_multiplier,
    r.price_kz,
    r.status::TEXT,
    r.driver_confirmed,
    r.vehicle_type,
    r.traffic_factor,
    r.created_at,
    r.accepted_at,
    r.pickup_at,
    r.started_at,
    r.completed_at,
    r.cancelled_at,
    r.cancel_reason,
    dp.name AS driver_name,
    pp.name AS passenger_name
  FROM public.rides r
  LEFT JOIN public.profiles dp ON dp.user_id = r.driver_id
  LEFT JOIN public.profiles pp ON pp.user_id = r.passenger_id
  WHERE (r.passenger_id = v_caller OR r.driver_id = v_caller)
    AND r.status IN ('searching', 'accepted', 'picking_up', 'in_progress')
  ORDER BY r.created_at DESC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_ride() TO authenticated;
REVOKE ALL ON FUNCTION public.get_active_ride() FROM anon;
