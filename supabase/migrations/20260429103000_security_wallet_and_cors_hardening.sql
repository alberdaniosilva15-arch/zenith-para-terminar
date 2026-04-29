CREATE TABLE IF NOT EXISTS public.pending_payments (
  reference TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  phone_number TEXT,
  provider TEXT NOT NULL DEFAULT 'multicaixa',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'failed', 'cancelled')),
  provider_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  callback_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pending_payments_user_created
  ON public.pending_payments(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pending_payments_status
  ON public.pending_payments(status, created_at DESC);

DROP TRIGGER IF EXISTS t_pending_payments_updated_at ON public.pending_payments;
CREATE TRIGGER t_pending_payments_updated_at
  BEFORE UPDATE ON public.pending_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.pending_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pending_payments own read" ON public.pending_payments;
CREATE POLICY "pending_payments own read"
  ON public.pending_payments FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_secure());

DROP POLICY IF EXISTS "pending_payments admin write" ON public.pending_payments;
CREATE POLICY "pending_payments admin write"
  ON public.pending_payments FOR ALL TO authenticated
  USING (public.is_admin_secure())
  WITH CHECK (public.is_admin_secure());

CREATE OR REPLACE FUNCTION public.check_ride_rate_limit(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_recent_count
  FROM public.rides
  WHERE passenger_id = p_user_id
    AND created_at >= NOW() - INTERVAL '60 seconds';

  RETURN v_recent_count < 5;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_ride_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.passenger_id IS NULL THEN
    RAISE EXCEPTION 'passenger_id_required';
  END IF;

  IF auth.uid() IS NOT NULL
     AND auth.uid() <> NEW.passenger_id
     AND NOT public.is_admin_secure() THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  IF NOT public.check_ride_rate_limit(NEW.passenger_id) THEN
    RAISE EXCEPTION 'ride_rate_limit';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_ride_rate_limit ON public.rides;
CREATE TRIGGER trg_enforce_ride_rate_limit
  BEFORE INSERT ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_ride_rate_limit();

CREATE OR REPLACE FUNCTION public.credit_wallet_atomic(
  p_user_id UUID,
  p_amount NUMERIC,
  p_description TEXT,
  p_reference TEXT
)
RETURNS TABLE (
  balance_after NUMERIC,
  credited BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.pending_payments%ROWTYPE;
  v_wallet_balance NUMERIC(12,2);
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  SELECT *
  INTO v_payment
  FROM public.pending_payments
  WHERE reference = p_reference
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_not_found';
  END IF;

  IF v_payment.user_id <> p_user_id THEN
    RAISE EXCEPTION 'payment_user_mismatch';
  END IF;

  IF ROUND(COALESCE(v_payment.amount, 0)::NUMERIC, 2) <> ROUND(p_amount::NUMERIC, 2) THEN
    RAISE EXCEPTION 'payment_amount_mismatch';
  END IF;

  IF v_payment.status = 'confirmed' THEN
    RETURN QUERY
    SELECT w.balance, FALSE
    FROM public.wallets AS w
    WHERE w.user_id = p_user_id;
    RETURN;
  END IF;

  IF v_payment.status <> 'pending' THEN
    RAISE EXCEPTION 'payment_not_pending';
  END IF;

  INSERT INTO public.wallets (user_id, balance)
  VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.wallets
  SET
    balance = balance + p_amount,
    updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING balance INTO v_wallet_balance;

  INSERT INTO public.transactions (
    user_id,
    amount,
    type,
    description,
    balance_after
  ) VALUES (
    p_user_id,
    p_amount,
    'top_up',
    p_description,
    v_wallet_balance
  );

  UPDATE public.pending_payments
  SET
    status = 'confirmed',
    completed_at = NOW(),
    updated_at = NOW()
  WHERE reference = p_reference;

  RETURN QUERY SELECT v_wallet_balance, TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_wallet_atomic(UUID, NUMERIC, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.check_ride_rate_limit(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credit_wallet_atomic(UUID, NUMERIC, TEXT, TEXT)
  TO service_role;
