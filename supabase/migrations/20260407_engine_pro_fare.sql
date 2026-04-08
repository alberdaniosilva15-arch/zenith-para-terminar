-- ════════════════════════════════════════════════════════════════════════════════
-- ZENITH ENGINE PRO v4 — Função RPC de Precificação (Migration 2.6)
-- Fórmula: Fare = B + (d * rd * Wl) + (t * rt * Wt) * S * C * U + F
--
-- PROTEGIDO: Apenas acessível via RPC autenticado.
-- NUNCA exposta no frontend.
-- ════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.calculate_fare_engine_pro(
  p_distance_km       NUMERIC,
  p_duration_min      NUMERIC,
  p_origin_lat        DOUBLE PRECISION,
  p_origin_lng        DOUBLE PRECISION,
  p_dest_lat          DOUBLE PRECISION,
  p_dest_lng          DOUBLE PRECISION,
  p_service_tier      TEXT    DEFAULT 'standard',
  p_demand_count      INT     DEFAULT 5,
  p_supply_count      INT     DEFAULT 5,
  p_is_night          BOOLEAN DEFAULT FALSE,
  p_is_airport        BOOLEAN DEFAULT FALSE,
  p_traffic_factor    NUMERIC DEFAULT 1.0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cfg         public.pricing_config%ROWTYPE;
  B           NUMERIC;
  rd          NUMERIC;
  rt          NUMERIC;
  Wl          NUMERIC := 1.0;
  Wt          NUMERIC := 1.0;
  S           NUMERIC;
  C           NUMERIC := 1.0;
  U           NUMERIC := 1.0;
  F           NUMERIC := 0;
  fare_raw    NUMERIC;
  fare_final  NUMERIC;
  v_user_tier TEXT;
  is_traffic  BOOLEAN;
  badges      TEXT[]  := '{}';
BEGIN
  -- Carregar configuração activa
  SELECT * INTO cfg FROM public.pricing_config WHERE is_active = TRUE LIMIT 1;
  IF NOT FOUND THEN
    -- Fallback: valores hardcoded seguros se não existir config
    RETURN jsonb_build_object(
      'fare_kz',   599,
      'badges',    ARRAY[]::TEXT[],
      'breakdown', jsonb_build_object('base', 300, 'distance', 182 * p_distance_km, 'time', 15 * p_duration_min, 'extras', 0)
    );
  END IF;

  B  := cfg.base_fare_kz;
  rd := cfg.rate_per_km_kz;
  rt := cfg.rate_per_min_kz;

  -- Trânsito Intenso (via Routes API trafficFactor)
  is_traffic := p_traffic_factor > cfg.traffic_threshold;
  IF is_traffic THEN
    Wt := LEAST(p_traffic_factor, 1.5);
    badges := array_append(badges, 'Trânsito Intenso');
  END IF;

  -- Multiplicador de Zona (Wl) — Luanda
  IF  (p_origin_lat BETWEEN -9.05 AND -8.95 AND p_origin_lng BETWEEN 13.17 AND 13.27)
   OR (p_dest_lat   BETWEEN -9.05 AND -8.95 AND p_dest_lng   BETWEEN 13.17 AND 13.27) THEN
    Wl := cfg.wl_talatona;
    badges := array_append(badges, 'Zona Premium');
  ELSIF (p_origin_lat BETWEEN -8.85 AND -8.80 AND p_origin_lng BETWEEN 13.22 AND 13.28)
     OR (p_dest_lat   BETWEEN -8.85 AND -8.80 AND p_dest_lng   BETWEEN 13.22 AND 13.28) THEN
    Wl := cfg.wl_miramar;
    badges := array_append(badges, 'Zona Prestígio');
  ELSIF (p_origin_lat BETWEEN -8.95 AND -8.80 AND p_origin_lng BETWEEN 13.35 AND 13.55)
     OR (p_dest_lat   BETWEEN -8.95 AND -8.80 AND p_dest_lng   BETWEEN 13.35 AND 13.55) THEN
    Wl := cfg.wl_viana;
  END IF;

  -- Multiplicador de Categoria de Serviço (C)
  C := CASE p_service_tier
    WHEN 'premium' THEN cfg.wl_premium
    WHEN 'eco'     THEN cfg.wl_eco
    ELSE                cfg.wl_standard
  END;

  -- Multiplicador de Utilizador (U)
  SELECT u.user_tier INTO v_user_tier
  FROM public.profiles u WHERE u.user_id = auth.uid() LIMIT 1;

  U := CASE v_user_tier
    WHEN 'vip'         THEN cfg.u_vip
    WHEN 'problematic' THEN cfg.u_problematic
    ELSE                    cfg.u_standard
  END;

  IF v_user_tier = 'problematic' THEN
    badges := array_append(badges, 'Tarifa Ajustada');
  END IF;

  -- Surge Dinâmico (S)
  IF p_supply_count > 0 THEN
    S := LEAST(
      1.0 + cfg.surge_alpha * (p_demand_count::NUMERIC / p_supply_count::NUMERIC),
      cfg.surge_max
    );
  ELSE
    S := cfg.surge_max;
  END IF;

  IF S > 1.2 THEN
    badges := array_append(badges, 'Alta Procura ' || ROUND(S, 1)::TEXT || 'x');
  END IF;

  -- Taxas Extras (F)
  IF p_is_night   THEN F := F + cfg.fee_night_kz;   badges := array_append(badges, 'Tarifa Nocturna');   END IF;
  IF p_is_airport THEN F := F + cfg.fee_airport_kz; badges := array_append(badges, 'Serviço Aeroporto'); END IF;
  IF is_traffic   THEN F := F + cfg.fee_traffic_kz; END IF;

  -- Cálculo Principal: Fare = B + (d * rd * Wl) + (t * rt * Wt) * S * C * U + F
  fare_raw := B
    + (p_distance_km * rd * Wl)
    + (p_duration_min * rt * Wt) * S * C * U
    + F;

  -- Preço Psicológico (terminar em 99 Kz)
  fare_final := FLOOR(fare_raw / 100) * 100 + 99;
  IF fare_final < fare_raw THEN fare_final := fare_final + 100; END IF;
  fare_final := GREATEST(fare_final, B);

  RETURN jsonb_build_object(
    'fare_kz',             fare_final,
    'fare_raw_kz',         ROUND(fare_raw, 2),
    'surge_factor',        ROUND(S, 2),
    'zone_multiplier',     Wl,
    'traffic_multiplier',  ROUND(Wt, 2),
    'user_factor',         U,
    'service_factor',      C,
    'extras_kz',           F,
    'is_traffic',          is_traffic,
    'badges',              badges,
    'price_locked_until',  NOW() + INTERVAL '2 minutes',
    'breakdown', jsonb_build_object(
      'base',     B,
      'distance', ROUND(p_distance_km * rd * Wl, 2),
      'time',     ROUND(p_duration_min * rt * Wt, 2),
      'surge',    ROUND(S, 2),
      'extras',   F
    )
  );
END;
$$;
