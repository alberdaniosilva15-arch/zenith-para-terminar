-- ════════════════════════════════════════════════════════════════════
-- ZENITH RIDE — Migration 2.5: pricing_config (Engine Pro PROTEGIDO)
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.pricing_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  config_name TEXT NOT NULL DEFAULT 'default',

  -- Parâmetros base
  base_fare_kz        NUMERIC NOT NULL DEFAULT 300,
  rate_per_km_kz      NUMERIC NOT NULL DEFAULT 182,
  rate_per_min_kz     NUMERIC NOT NULL DEFAULT 15,

  -- Surge
  surge_alpha         NUMERIC NOT NULL DEFAULT 0.5,
  surge_max           NUMERIC NOT NULL DEFAULT 2.5,

  -- Taxas extras
  fee_night_kz        NUMERIC NOT NULL DEFAULT 200,
  fee_airport_kz      NUMERIC NOT NULL DEFAULT 500,
  fee_traffic_kz      NUMERIC NOT NULL DEFAULT 150,
  fee_cancel_kz       NUMERIC NOT NULL DEFAULT 300,

  -- Comissão da plataforma
  platform_commission NUMERIC NOT NULL DEFAULT 0.15,

  -- Multiplicadores por zona (Wl)
  wl_talatona         NUMERIC NOT NULL DEFAULT 1.4,
  wl_miramar          NUMERIC NOT NULL DEFAULT 1.2,
  wl_alvalade         NUMERIC NOT NULL DEFAULT 1.2,
  wl_patriota         NUMERIC NOT NULL DEFAULT 1.4,
  wl_viana            NUMERIC NOT NULL DEFAULT 0.9,
  wl_cacuaco          NUMERIC NOT NULL DEFAULT 0.9,
  wl_default          NUMERIC NOT NULL DEFAULT 1.0,

  -- Multiplicadores por categoria de serviço
  wl_premium          NUMERIC NOT NULL DEFAULT 1.8,
  wl_standard         NUMERIC NOT NULL DEFAULT 1.0,
  wl_eco              NUMERIC NOT NULL DEFAULT 0.8,

  -- Multiplicadores por tier de utilizador
  u_vip               NUMERIC NOT NULL DEFAULT 0.85,
  u_new               NUMERIC NOT NULL DEFAULT 1.0,
  u_standard          NUMERIC NOT NULL DEFAULT 1.0,
  u_problematic       NUMERIC NOT NULL DEFAULT 1.3,

  -- Threshold de trânsito intenso (Routes API trafficFactor)
  traffic_threshold   NUMERIC NOT NULL DEFAULT 1.3,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_active  BOOLEAN DEFAULT TRUE
);

ALTER TABLE public.pricing_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "only_admins_pricing" ON public.pricing_config;
CREATE POLICY "only_admins_pricing"
ON public.pricing_config FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  )
);

INSERT INTO public.pricing_config (config_name) VALUES ('default')
ON CONFLICT DO NOTHING;
