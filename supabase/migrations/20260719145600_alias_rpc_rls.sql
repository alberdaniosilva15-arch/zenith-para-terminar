-- ============================================================================
-- ZENITH RIDE — MIGRAÇÃO DE COMPATIBILIDADE RLS
-- Cria aliases (wrappers) com os nomes antigos já integrados no frontend,
-- redirecionando de forma segura e transparente para as novas funções rígidas.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.accept_ride_atomic(p_ride_id UUID)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $body
BEGIN
  RETURN public.accept_ride(p_ride_id);
END;
$body;

REVOKE ALL ON FUNCTION public.accept_ride_atomic(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_ride_atomic(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_ride_atomic(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_ride_safe(p_ride_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $body
BEGIN
  RETURN public.cancel_ride(p_ride_id, p_reason);
END;
$body;

REVOKE ALL ON FUNCTION public.cancel_ride_safe(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_ride_safe(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_ride_safe(UUID, TEXT) TO authenticated;

COMMIT;
