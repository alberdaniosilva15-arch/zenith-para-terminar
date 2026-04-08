-- ════════════════════════════════════════════════════════════════════
-- ZENITH RIDE — Migration 2.4: Colunas em falta nos rides
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.rides
ADD COLUMN IF NOT EXISTS payment_pending     BOOLEAN  DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS payment_error       TEXT,
ADD COLUMN IF NOT EXISTS surge_factor        NUMERIC  DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS zone_multiplier     NUMERIC  DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS user_factor         NUMERIC  DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS price_locked_until  TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS route_distance_km   NUMERIC,
ADD COLUMN IF NOT EXISTS route_duration_min  NUMERIC,
ADD COLUMN IF NOT EXISTS route_polyline      TEXT,
ADD COLUMN IF NOT EXISTS traffic_factor      NUMERIC  DEFAULT 1.0;

-- Opcional: popular lat/lng se existirem colunas geography
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rides' AND column_name = 'origin_geo'
  ) THEN
    UPDATE public.rides
    SET origin_lat = ST_Y(origin_geo::geometry),
        origin_lng = ST_X(origin_geo::geometry)
    WHERE origin_geo IS NOT NULL AND origin_lat IS NULL;

    UPDATE public.rides
    SET dest_lat = ST_Y(dest_geo::geometry),
        dest_lng = ST_X(dest_geo::geometry)
    WHERE dest_geo IS NOT NULL AND dest_lat IS NULL;
  END IF;
END $$;
