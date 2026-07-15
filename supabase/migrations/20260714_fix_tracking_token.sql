CREATE OR REPLACE FUNCTION public.validate_tracking_token(p_token UUID)
RETURNS TABLE (ride_status TEXT, origin_address TEXT, dest_address TEXT)
SECURITY DEFINER
AS $$
BEGIN
  -- NÃO retornar coordenadas GPS para anon
  RETURN QUERY
  SELECT r.status::TEXT, r.origin_address, r.dest_address
  FROM ride_tracking_shares rts
  JOIN rides r ON r.id = rts.ride_id
  WHERE rts.tracking_token = p_token
    AND rts.expires_at > now();
END;
$$;

-- Manter acesso anónimo apenas a esta versão sem GPS:
GRANT EXECUTE ON FUNCTION public.validate_tracking_token(UUID) TO anon, authenticated;
