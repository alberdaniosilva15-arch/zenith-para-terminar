-- =============================================================================
-- ZENITH RIDE — CORRECÇÃO RÁPIDA: process_ride_payment_v3
-- Erro: "cannot remove parameter defaults from existing function"
-- Solução: DROP obrigatório antes de recriar quando os defaults mudam
--
-- INSTRUÇÕES:
--   1. Corre ESTE FICHEIRO no Supabase SQL Editor (é curto e seguro)
--   2. Depois volta a correr o ficheiro principal 20260421_v3.5_final_consolidada.sql
--      OU apenas corre as secções que falharam a seguir ao erro
-- =============================================================================

-- Remover a versão antiga com assinatura conflituante
DROP FUNCTION IF EXISTS public.process_ride_payment_v3(
  UUID, UUID, UUID, NUMERIC, NUMERIC,
  TEXT, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT, DOUBLE PRECISION, DOUBLE PRECISION
);

-- Recriar sem defaults nos parâmetros (todos obrigatórios — mais seguro)
CREATE OR REPLACE FUNCTION public.process_ride_payment_v3(
  p_ride_id       UUID,
  p_passenger_id  UUID,
  p_driver_id     UUID,
  p_amount        NUMERIC,
  p_distance_km   NUMERIC,
  p_origin_addr   TEXT,
  p_origin_lat    DOUBLE PRECISION,
  p_origin_lng    DOUBLE PRECISION,
  p_dest_addr     TEXT,
  p_dest_lat      DOUBLE PRECISION,
  p_dest_lng      DOUBLE PRECISION
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_platform_fee   NUMERIC;
  v_driver_earning NUMERIC;
  v_pass_bal_after NUMERIC;
  v_driv_bal_after NUMERIC;
BEGIN
  v_platform_fee   := ROUND(p_amount * 0.15, 2);
  v_driver_earning := p_amount - v_platform_fee;

  -- Garantir carteira do passageiro
  INSERT INTO public.wallets (user_id, balance)
  VALUES (p_passenger_id, 0.00)
  ON CONFLICT (user_id) DO NOTHING;

  -- Debitar passageiro (permite saldo negativo — cobrado no próximo top-up)
  UPDATE public.wallets
  SET balance    = balance - p_amount,
      updated_at = NOW()
  WHERE user_id = p_passenger_id
  RETURNING balance INTO v_pass_bal_after;

  INSERT INTO public.transactions
    (user_id, ride_id, amount, type, description, balance_after)
  VALUES (
    p_passenger_id, p_ride_id, -p_amount, 'ride_payment',
    format('Corrida %s → %s (%.1f km)', p_origin_addr, p_dest_addr, p_distance_km),
    COALESCE(v_pass_bal_after, 0)
  );

  -- Creditar motorista (85% do valor)
  INSERT INTO public.wallets (user_id, balance)
  VALUES (p_driver_id, v_driver_earning)
  ON CONFLICT (user_id) DO UPDATE
    SET balance    = wallets.balance + v_driver_earning,
        updated_at = NOW()
  RETURNING balance INTO v_driv_bal_after;

  INSERT INTO public.transactions
    (user_id, ride_id, amount, type, description, balance_after)
  VALUES (
    p_driver_id, p_ride_id, v_driver_earning, 'ride_earning',
    format('Ganho: %s → %s (%.1f km)', p_origin_addr, p_dest_addr, p_distance_km),
    COALESCE(v_driv_bal_after, v_driver_earning)
  );

  -- Actualizar km_total do motorista
  UPDATE public.profiles
  SET km_total = COALESCE(km_total, 0) + COALESCE(p_distance_km, 0)
  WHERE user_id = p_driver_id;

  -- Actualizar predições do Kaze Preditivo
  INSERT INTO public.ride_predictions (
    user_id, origin_address, origin_lat, origin_lng,
    dest_address, dest_lat, dest_lng, frequency, last_used_at, avg_price_kz
  )
  VALUES (
    p_passenger_id, p_origin_addr, p_origin_lat, p_origin_lng,
    p_dest_addr,    p_dest_lat,    p_dest_lng,   1, NOW(), p_amount
  )
  ON CONFLICT (user_id, origin_address, dest_address)
  DO UPDATE SET
    frequency    = ride_predictions.frequency + 1,
    last_used_at = NOW(),
    avg_price_kz = ROUND(
      (COALESCE(ride_predictions.avg_price_kz, p_amount) * ride_predictions.frequency + p_amount)
      / (ride_predictions.frequency + 1), 2
    );

EXCEPTION
  WHEN OTHERS THEN
    -- Não bloquear a corrida por erros de pagamento — registar o erro
    RAISE WARNING '[process_ride_payment_v3] Erro no pagamento da corrida %: %', p_ride_id, SQLERRM;
END;
$$;

-- Permissões
GRANT EXECUTE ON FUNCTION public.process_ride_payment_v3(
  UUID, UUID, UUID, NUMERIC, NUMERIC,
  TEXT, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT, DOUBLE PRECISION, DOUBLE PRECISION
) TO authenticated;

SELECT 'process_ride_payment_v3 recriada com sucesso ✅' AS resultado;
