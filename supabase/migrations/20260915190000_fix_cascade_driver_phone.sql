-- =============================================================================
-- CORRECÇÃO — get_cascade_drivers devolvia o EMAIL do motorista na coluna `phone`
--
-- O corpo original tinha:
--
--     u.email AS phone,
--
-- E o consumidor (supabase/functions/dispatch-cascade/index.ts) faz:
--
--     await sendWA(normalizePhone(driver.phone), msgText);
--
-- normalizePhone() remove tudo o que não seja dígito. Sobre "alguem@gmail.com"
-- isso dá a string vazia, à qual a função acrescenta o indicativo do país:
-- o resultado final era enviar WhatsApp para o número literal "244".
-- A Meta rejeita, o código não verifica a resposta e a corrida seguia como se
-- tivesse sido despachada. O motorista nunca recebia o pedido — falha silenciosa.
--
-- O telefone real do motorista está em public.profiles.phone.
--
-- A assinatura da função NÃO muda: o frontend não usa este RPC, apenas a Edge
-- Function dispatch-cascade. CREATE OR REPLACE preserva os GRANTs existentes.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_cascade_drivers(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision DEFAULT 5.0,
  p_limit integer DEFAULT 5
)
 RETURNS TABLE(
   driver_id uuid,
   driver_name text,
   avatar_url text,
   rating numeric,
   total_rides integer,
   level text,
   distance_m double precision,
   eta_min integer,
   phone text,
   acceptance_rate numeric,
   avg_response_sec numeric,
   timeout_sec integer
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    dl.driver_id,
    pr.name AS driver_name,
    pr.avatar_url,
    pr.rating,
    pr.total_rides,
    pr.level,
    ST_Distance(dl.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) AS distance_m,
    CEIL(ST_Distance(dl.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) / 583.0)::INT AS eta_min,
    -- ANTES: u.email AS phone
    COALESCE(NULLIF(btrim(pr.phone), ''), '') AS phone,
    COALESCE(dl.acceptance_rate, 100.0),
    COALESCE(dl.avg_response_sec, 10.0),
    -- Timeout inteligente: top=8s, médio=5s, fraco=3s
    CASE
      WHEN pr.rating >= 4.5 AND COALESCE(dl.acceptance_rate, 100) >= 80 THEN 8
      WHEN pr.rating >= 4.0 THEN 5
      ELSE 3
    END AS timeout_sec
  FROM public.driver_locations dl
  JOIN public.profiles pr ON pr.user_id = dl.driver_id
  JOIN public.users u ON u.id = dl.driver_id
  WHERE dl.status = 'available'
    AND ST_DWithin(dl.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, p_radius_km * 1000)
  ORDER BY
    (ST_Distance(dl.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) * 0.48)
    + ((5.0 - pr.rating) * 500 * 0.24)
    - (COALESCE(dl.acceptance_rate, 50) * 0.15)
    + (COALESCE(dl.recent_cancellations, 0) * 200)
  LIMIT p_limit;
END;
$function$;
