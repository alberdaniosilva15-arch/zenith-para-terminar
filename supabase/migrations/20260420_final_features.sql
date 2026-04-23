-- =======================================================================================
-- ZENITH RIDE v3.4 — SQL MIGRATION (FINAL FEATURES)
-- Inclui: Traz o Mano (Referrals), Botão de Pânico (Safety Shield) e Rate Limiting (Phase 2.3)
-- =======================================================================================

BEGIN;

-- ---------------------------------------------------------------------------------------
-- 1. REFERRALS ("TRAZ O MANO")
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id UUID NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    referred_id UUID NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    referral_code VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
    reward_kz NUMERIC(10, 2) DEFAULT 500.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()),
    UNIQUE (referred_id) -- Uma pessoa só pode usar o código de outra uma vez
);

-- Ativar RLS
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS
CREATE POLICY "Users can view their own referrals (referrer)" 
    ON public.referrals FOR SELECT 
    USING (auth.uid() = referrer_id);

CREATE POLICY "Users can view their own referrals (referred)" 
    ON public.referrals FOR SELECT 
    USING (auth.uid() = referred_id);

CREATE POLICY "Users can insert referral codes for themselves" 
    ON public.referrals FOR INSERT 
    WITH CHECK (auth.uid() = referred_id);

-- Atualização na tabela PROFILES (se ainda não tiver a coluna referral_code)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referral_code VARCHAR(20) UNIQUE;

-- ---------------------------------------------------------------------------------------
-- 2. PANIC ALERTS ("KAZE SAFETY SHIELD")
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.panic_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ride_id UUID REFERENCES public.rides(id) ON DELETE SET NULL,
    lat NUMERIC(10, 7),
    lng NUMERIC(10, 7),
    driver_name VARCHAR(100),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'false_alarm')),
    resolved_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()),
    resolved_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.panic_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert panic alerts" 
    ON public.panic_alerts FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all panic alerts" 
    ON public.panic_alerts FOR SELECT 
    USING (public.is_admin());

-- ---------------------------------------------------------------------------------------
-- 3. RATE LIMITS (Phase 2.3 Server-Side / Edge Function)
-- ---------------------------------------------------------------------------------------
-- Tabela para rastrear requisições intensivas à API
CREATE TABLE IF NOT EXISTS public.api_rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID DEFAULT auth.uid(),
    endpoint VARCHAR(100) NOT NULL,
    request_time TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- Index para optimizar limpeza e contagem
CREATE INDEX IF NOT EXISTS idx_api_rate_limits_user_endpoint_time 
    ON public.api_rate_limits(user_id, endpoint, request_time);

-- Função de avaliação de Rate Limiting para ser chamada nas Edge Functions
CREATE OR REPLACE FUNCTION public.check_rate_limit(
    p_user_id UUID, 
    p_endpoint VARCHAR, 
    p_limit INT, 
    p_window_seconds INT
) RETURNS BOOLEAN AS $$
DECLARE
    req_count INT;
BEGIN
    -- Limpeza de registos antigos (opcional, pode ser movido para CRON job)
    DELETE FROM public.api_rate_limits 
    WHERE request_time < (now() - (p_window_seconds || ' seconds')::interval);

    -- Contar quantas requisições o utilizador fez no tempo de janela para este endpoint
    SELECT COUNT(*) INTO req_count 
    FROM public.api_rate_limits 
    WHERE user_id = p_user_id 
      AND endpoint = p_endpoint
      AND request_time >= (now() - (p_window_seconds || ' seconds')::interval);

    -- Verificar se excedeu o limite
    IF req_count >= p_limit THEN
        RETURN FALSE; -- Bloqueado
    END IF;

    -- Inserir o novo registo e permitir a requisição
    INSERT INTO public.api_rate_limits (user_id, endpoint) VALUES (p_user_id, p_endpoint);
    RETURN TRUE; -- Permitido
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------------------
-- 4. Função auxiliar para a Edge Function de Calculate Fare
-- Aplica a verificação de Rate Limit internamente antes de processar preço
-- ---------------------------------------------------------------------------------------
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
    -- Faz o lock de rate limit: max 10 requests por minuto por utilizador (10, 60)
    SELECT public.check_rate_limit(auth.uid(), 'calculate_fare', 10, 60) INTO is_allowed;

    IF NOT is_allowed THEN
        -- Retorna erro gracefully se abusar do sistema
        RETURN jsonb_build_object(
            'error', 'Rate limit exceeded. Please wait a moment.',
            'fare_kz', 0
        );
    END IF;

    -- Chama o core engine se permitido (já existente do passo 2.3 do user)
    SELECT public.calculate_fare_engine_pro(
        p_distance_km, p_duration_min, p_origin_lat, p_origin_lng, p_dest_lat, p_dest_lng, 
        p_service_tier, p_demand_count, p_supply_count, p_is_night, p_is_airport, p_traffic_factor
    ) INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ---------------------------------------------------------------------------------------
-- 5. STORAGE BUCKET PARA PANIC BUTTON
-- ---------------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public) 
VALUES ('panic-audio', 'panic-audio', false)
ON CONFLICT (id) DO NOTHING;

-- Políticas Storage
CREATE POLICY "Admins can access panic audio"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'panic-audio' AND public.is_admin());

CREATE POLICY "Users can upload panic audio"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'panic-audio' AND auth.uid() IS NOT NULL);


COMMIT;
