-- =============================================================================
-- ZENITH RIDE v3.3 — Migration: driver_recharges e broadcast de sistema
-- =============================================================================

-- 1. Tabela de Recargas do Motorista
CREATE TABLE IF NOT EXISTS public.driver_recharges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  package_id TEXT NOT NULL,
  amount_paid NUMERIC NOT NULL CHECK (amount_paid > 0),
  credit_amount NUMERIC NOT NULL CHECK (credit_amount > 0),
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired')),
  payment_method TEXT DEFAULT 'multicaixa_express',
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_driver_recharges_driver ON public.driver_recharges(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_recharges_code ON public.driver_recharges(code);

ALTER TABLE public.driver_recharges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Drivers can insert and view own recharges" ON public.driver_recharges;
CREATE POLICY "Drivers can insert and view own recharges"
  ON public.driver_recharges
  FOR ALL TO authenticated
  USING (driver_id = auth.uid() OR public.is_admin())
  WITH CHECK (driver_id = auth.uid() OR public.is_admin());

-- 2. Tabela de Notificações e Broadcasts Globais
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id, read);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view and update own notifications" ON public.notifications;
CREATE POLICY "Users can view and update own notifications"
  ON public.notifications
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- 3. Função RPC para confirmação atómica de recarga de motorista
CREATE OR REPLACE FUNCTION public.confirm_driver_recharge(p_recharge_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rec RECORD;
BEGIN
  -- Validar se o utilizador autenticado é admin
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem confirmar recargas.';
  END IF;

  SELECT * INTO v_rec
  FROM public.driver_recharges
  WHERE code = p_recharge_code AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Código de recarga inválido ou já processado.');
  END IF;

  -- 1. Actualizar estado da recarga
  UPDATE public.driver_recharges
  SET status = 'confirmed', confirmed_at = NOW()
  WHERE id = v_rec.id;

  -- 2. Creditar crédito operacional na carteira do motorista
  UPDATE public.driver_wallets
  SET operational_credit = operational_credit + v_rec.credit_amount,
      updated_at = NOW()
  WHERE driver_id = v_rec.driver_id;

  -- 3. Registar transação financeira
  INSERT INTO public.transactions (user_id, type, amount, description, status)
  VALUES (
    v_rec.driver_id,
    'driver_recharge',
    v_rec.credit_amount,
    'Recarga de crédito operacional (Pacote ' || v_rec.package_id || ')',
    'completed'
  );

  RETURN jsonb_build_object(
    'success', true,
    'driver_id', v_rec.driver_id,
    'credit_added', v_rec.credit_amount
  );
END;
$$;
