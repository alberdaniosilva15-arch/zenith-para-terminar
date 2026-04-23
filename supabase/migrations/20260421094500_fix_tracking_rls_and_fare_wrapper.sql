-- =============================================================================
-- ZENITH RIDE - Fixes de review (RLS tracking + ordem demand/supply no fare wrapper)
-- Idempotente
-- =============================================================================

-- 1) Fechar leitura publica direta de school_tracking_sessions.
DROP POLICY IF EXISTS "tracking: leitura pública" ON public.school_tracking_sessions;
DROP POLICY IF EXISTS "tracking: dono lê" ON public.school_tracking_sessions;

CREATE POLICY "tracking: dono lê"
  ON public.school_tracking_sessions FOR SELECT
  USING (EXISTS (
    SELECT 1
    FROM public.contracts c
    WHERE c.id = contract_id
      AND c.user_id = auth.uid()
  ));

-- 2) Corrigir wrapper de preco para encaminhar demand antes de supply.
CREATE OR REPLACE FUNCTION public.calculate_fare_engine_pro_with_rate_limit(
    p_distance_km NUMERIC,
    p_duration_min NUMERIC,
    p_origin_lat NUMERIC,
    p_origin_lng NUMERIC,
    p_dest_lat NUMERIC,
    p_dest_lng NUMERIC,
    p_service_tier VARCHAR DEFAULT 'standard',
    p_supply_count INT DEFAULT 5,
    p_demand_count INT DEFAULT 5,
    p_is_night BOOLEAN DEFAULT FALSE,
    p_is_airport BOOLEAN DEFAULT FALSE,
    p_traffic_factor NUMERIC DEFAULT 1.0
) RETURNS jsonb AS $$
DECLARE
    is_allowed BOOLEAN;
    result jsonb;
BEGIN
    SELECT public.check_rate_limit(auth.uid(), 'calculate_fare', 10, 60) INTO is_allowed;

    IF NOT is_allowed THEN
        RETURN jsonb_build_object(
            'error', 'Rate limit exceeded. Please wait a moment.',
            'fare_kz', 0
        );
    END IF;

    SELECT public.calculate_fare_engine_pro(
        p_distance_km, p_duration_min, p_origin_lat, p_origin_lng, p_dest_lat, p_dest_lng,
        p_service_tier, p_demand_count, p_supply_count, p_is_night, p_is_airport, p_traffic_factor
    ) INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
