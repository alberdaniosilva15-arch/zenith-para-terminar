-- Corrige a assinatura de process_ride_payment_v3 para aceitar 11 argumentos 
-- para fazer match com o trigger existente na BD original

CREATE OR REPLACE FUNCTION public.process_ride_payment_v3(
  p_ride_id UUID,
  p_passenger_id UUID,
  p_driver_id UUID,
  p_price_kz NUMERIC,
  p_distance_km NUMERIC,
  p_origin_address TEXT,
  p_origin_lat NUMERIC,
  p_origin_lng NUMERIC,
  p_dest_address TEXT,
  p_dest_lat NUMERIC,
  p_dest_lng NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_passenger_wallet public.wallets%ROWTYPE;
  v_driver_wallet    public.wallets%ROWTYPE;
  v_fee_pct NUMERIC := 0.15; -- 15% taxa da plataforma
  v_net_driver NUMERIC;
BEGIN
  -- Lida com casos onde driver ou passageiro são nulos à cautela
  IF p_passenger_id IS NULL OR p_driver_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_users');
  END IF;

  -- 1. Ler as wallets forçadamente por ordem (evitar locks espúrios se forem concorrentes)
  IF p_passenger_id < p_driver_id THEN
    SELECT * INTO v_passenger_wallet FROM public.wallets WHERE user_id = p_passenger_id FOR UPDATE;
    SELECT * INTO v_driver_wallet FROM public.wallets WHERE user_id = p_driver_id FOR UPDATE;
  ELSE
    SELECT * INTO v_driver_wallet FROM public.wallets WHERE user_id = p_driver_id FOR UPDATE;
    SELECT * INTO v_passenger_wallet FROM public.wallets WHERE user_id = p_passenger_id FOR UPDATE;
  END IF;

  IF v_passenger_wallet.balance IS NULL OR v_driver_wallet.balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'wallet_not_found');
  END IF;

  v_net_driver := p_price_kz * (1 - v_fee_pct);

  -- 2. Movimentos atómicos nas carteiras
  UPDATE public.wallets SET balance = balance - p_price_kz WHERE user_id = p_passenger_id;
  UPDATE public.wallets SET balance = balance + v_net_driver WHERE user_id = p_driver_id;

  -- 3. Registar Transacções para o histórico
  INSERT INTO public.transactions (user_id, ride_id, amount, type, description, balance_after)
  VALUES (p_passenger_id, p_ride_id, -p_price_kz, 'ride_payment', 'Pagamento de corrida', v_passenger_wallet.balance - p_price_kz);

  INSERT INTO public.transactions (user_id, ride_id, amount, type, description, balance_after)
  VALUES (p_driver_id, p_ride_id, v_net_driver, 'ride_earning', 'Ganho da corrida (já descontada taxa ZenithRide)', v_driver_wallet.balance + v_net_driver);

  RETURN jsonb_build_object('success', true);
END;
$$;
