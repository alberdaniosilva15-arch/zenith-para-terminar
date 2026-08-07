-- =============================================================================
-- ZENITH RIDE v3.0 — Sistema de Crédito Operacional do Motorista
-- Migration: 20260720_driver_operational_credit
--
-- Conceito: O motorista compra "direito de faturar até um limite".
-- Crédito operacional NÃO é dinheiro — é teto de faturação.
-- Três entidades que NUNCA se misturam:
--   1. Carteira (cash_balance) — dinheiro real, só cresce com ganhos
--   2. Crédito Operacional — teto de faturação, só diminui, nunca sacável
--   3. Ganhos por corrida — valor que entra na carteira, nunca passa pelo crédito
-- =============================================================================

-- ─── TABELAS ─────────────────────────────────────────────────────────────────

-- Carteira do motorista (saldo real + crédito operacional)
CREATE TABLE IF NOT EXISTS driver_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  cash_balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cash_balance >= 0),
  operational_credit NUMERIC(12,2) NOT NULL DEFAULT 0,
  package_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Histórico de créditos (auditoria)
CREATE TABLE IF NOT EXISTS driver_credit_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  package TEXT NOT NULL,
  credit_given NUMERIC(12,2) NOT NULL,
  credit_used NUMERIC(12,2) NOT NULL DEFAULT 0,
  credit_remaining NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recargas do motorista (código UUID único temporário)
CREATE TABLE IF NOT EXISTS driver_recharges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_paid NUMERIC(12,2) NOT NULL CHECK (amount_paid > 0),
  credit_received NUMERIC(12,2) NOT NULL,
  uuid_code UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  uuid_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'used')),
  used_at TIMESTAMPTZ,
  payment_method TEXT NOT NULL DEFAULT 'multicaixa',
  payment_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Log de utilização de crédito (cada corrida consome 1 unidade)
CREATE TABLE IF NOT EXISTS driver_credit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ride_id UUID,
  credit_deducted NUMERIC(12,2) NOT NULL,
  credit_remaining NUMERIC(12,2) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── ÍNDICES ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_driver_wallets_driver ON driver_wallets(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_recharges_code ON driver_recharges(uuid_code);
CREATE INDEX IF NOT EXISTS idx_driver_recharges_driver ON driver_recharges(driver_id, status);
CREATE INDEX IF NOT EXISTS idx_driver_credit_history_driver ON driver_credit_history(driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_credit_log_driver ON driver_credit_log(driver_id, created_at DESC);

-- ─── FUNÇÕES RPC ─────────────────────────────────────────────────────────────

-- 1. Criar recarga (gera código UUID temporário + hash SHA256)
CREATE OR REPLACE FUNCTION create_driver_recharge(
  p_amount_paid NUMERIC
) RETURNS JSONB AS $$
DECLARE
  v_driver_id UUID := auth.uid();
  v_credit NUMERIC;
  v_package TEXT;
  v_recharge RECORD;
  v_uuid UUID;
  v_uuid_hash TEXT;
BEGIN
  -- Validar que é motorista
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_driver_id AND role = 'driver') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Apenas motoristas podem recarregar');
  END IF;

  -- Determinar pacote e crédito
  IF p_amount_paid >= 50000 THEN
    v_package := 'premium';
    v_credit := 225000;
  ELSIF p_amount_paid >= 20000 THEN
    v_package := 'standard';
    v_credit := 90000;
  ELSE
    v_package := 'basico';
    v_credit := 45000;
  END IF;

  -- Gerar UUID único e seu hash SHA256
  v_uuid := gen_random_uuid();
  v_uuid_hash := encode(sha256(v_uuid::text::bytea), 'hex');

  -- Criar recarga
  INSERT INTO driver_recharges (driver_id, amount_paid, credit_received, uuid_code, uuid_hash, status, payment_method)
  VALUES (v_driver_id, p_amount_paid, v_credit, v_uuid, v_uuid_hash, 'pending', 'multicaixa')
  RETURNING * INTO v_recharge;

  RETURN jsonb_build_object(
    'success', true,
    'recharge_id', v_recharge.id,
    'uuid_code', v_recharge.uuid_code,
    'amount_paid', v_recharge.amount_paid,
    'credit_received', v_recharge.credit_received,
    'package', v_package,
    'status', 'pending'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Confirmar pagamento (admin ou webhook)
CREATE OR REPLACE FUNCTION confirm_driver_recharge(
  p_uuid_code UUID
) RETURNS JSONB AS $$
DECLARE
  v_recharge RECORD;
  v_wallet RECORD;
  v_new_credit NUMERIC;
  v_deficit NUMERIC := 0;
BEGIN
  -- Buscar recarga pendente
  SELECT * INTO v_recharge
  FROM driver_recharges
  WHERE uuid_code = p_uuid_code AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Código inválido ou já utilizado');
  END IF;

  -- Confirmar recarga
  UPDATE driver_recharges SET status = 'confirmed', used_at = now() WHERE id = v_recharge.id;

  -- Buscar ou criar wallet do motorista
  SELECT * INTO v_wallet FROM driver_wallets WHERE driver_id = v_recharge.driver_id;

  IF NOT FOUND THEN
    -- Criar wallet com crédito
    INSERT INTO driver_wallets (driver_id, cash_balance, operational_credit, package_id, status)
    VALUES (v_recharge.driver_id, 0, v_recharge.credit_received, 'basico', 'active');
    v_new_credit := v_recharge.credit_received;
  ELSE
    -- Calcular déficit anterior (crédito negativo)
    IF v_wallet.operational_credit < 0 THEN
      v_deficit := ABS(v_wallet.operational_credit);
    END IF;

    -- Novo crédito = pacote - déficit
    v_new_credit := v_recharge.credit_received - v_deficit;

    -- Actualizar wallet
    UPDATE driver_wallets SET
      operational_credit = v_new_credit,
      package_id = 'basico',
      status = CASE WHEN v_new_credit > 0 THEN 'active' ELSE 'blocked' END,
      updated_at = now()
    WHERE driver_id = v_recharge.driver_id;
  END IF;

  -- Registar no histórico
  INSERT INTO driver_credit_history (driver_id, package, credit_given, credit_remaining)
  VALUES (v_recharge.driver_id, 'basico', v_recharge.credit_received, v_new_credit);

  -- Registar no log
  INSERT INTO driver_credit_log (driver_id, credit_deducted, credit_remaining, description)
  VALUES (v_recharge.driver_id, 0, v_new_credit, 'Recarga #' || v_recharge.id || ' — Pacote ' || 'basico');

  RETURN jsonb_build_object(
    'success', true,
    'credit_received', v_recharge.credit_received,
    'deficit_deducted', v_deficit,
    'new_operational_credit', v_new_credit,
    'package', 'basico'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Verificar se motorista pode aceitar corrida
CREATE OR REPLACE FUNCTION can_driver_accept_ride()
RETURNS JSONB AS $$
DECLARE
  v_driver_id UUID := auth.uid();
  v_wallet RECORD;
BEGIN
  SELECT * INTO v_wallet FROM driver_wallets WHERE driver_id = v_driver_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('can_ride', false, 'reason', 'no_wallet', 'message', 'Precisas de activar a tua conta de motorista.');
  END IF;

  IF v_wallet.status = 'blocked' OR v_wallet.operational_credit <= 0 THEN
    RETURN jsonb_build_object(
      'can_ride', false,
      'reason', 'no_credit',
      'operational_credit', v_wallet.operational_credit,
      'cash_balance', v_wallet.cash_balance,
      'message', 'O teu crédito operacional terminou. Recarrega para continuar a receber corridas.'
    );
  END IF;

  RETURN jsonb_build_object(
    'can_ride', true,
    'operational_credit', v_wallet.operational_credit,
    'cash_balance', v_wallet.cash_balance,
    'status', v_wallet.status
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Debitar crédito operacional ao concluir corrida
CREATE OR REPLACE FUNCTION debit_operational_credit(
  p_ride_id UUID,
  p_ride_value NUMERIC
) RETURNS JSONB AS $$
DECLARE
  v_driver_id UUID := auth.uid();
  v_wallet RECORD;
  v_new_credit NUMERIC;
  v_new_cash NUMERIC;
  v_commission NUMERIC;
BEGIN
  SELECT * INTO v_wallet FROM driver_wallets WHERE driver_id = v_driver_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet não encontrada');
  END IF;

  -- Calcular comissão (15%)
  v_commission := p_ride_value * 0.15;

  -- Débitar crédito operacional
  v_new_credit := v_wallet.operational_credit - p_ride_value;

  -- Creditar carteira (valor da corrida menos comissão)
  v_new_cash := v_wallet.cash_balance + (p_ride_value - v_commission);

  -- Actualizar wallet
  UPDATE driver_wallets SET
    operational_credit = v_new_credit,
    cash_balance = v_new_cash,
    status = CASE WHEN v_new_credit <= 0 THEN 'blocked' ELSE 'active' END,
    updated_at = now()
  WHERE driver_id = v_driver_id;

  -- Registar no log
  INSERT INTO driver_credit_log (driver_id, ride_id, credit_deducted, credit_remaining, description)
  VALUES (v_driver_id, p_ride_id, p_ride_value, v_new_credit, 'Corrida completada');

  -- Registar ganho na carteira existente (se existir tabela wallets)
  -- NOTA: integração com carteira existente a fazer na Fase 2

  RETURN jsonb_build_object(
    'success', true,
    'credit_deducted', p_ride_value,
    'new_operational_credit', v_new_credit,
    'cash_earned', p_ride_value - v_commission,
    'commission', v_commission,
    'blocked', v_new_credit <= 0
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Obter saldo do motorista
CREATE OR REPLACE FUNCTION get_driver_wallet_status()
RETURNS JSONB AS $$
DECLARE
  v_driver_id UUID := auth.uid();
  v_wallet RECORD;
BEGIN
  SELECT * INTO v_wallet FROM driver_wallets WHERE driver_id = v_driver_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'has_wallet', false,
      'cash_balance', 0,
      'operational_credit', 0,
      'status', 'none'
    );
  END IF;

  RETURN jsonb_build_object(
    'has_wallet', true,
    'cash_balance', v_wallet.cash_balance,
    'operational_credit', v_wallet.operational_credit,
    'package_id', v_wallet.package_id,
    'status', v_wallet.status
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Utlizar código de recarga (irreversível)
CREATE OR REPLACE FUNCTION use_recharge_code(
  p_uuid_code UUID
) RETURNS JSONB AS $$
DECLARE
  v_recharge RECORD;
BEGIN
  SELECT * INTO v_recharge
  FROM driver_recharges
  WHERE uuid_code = p_uuid_code AND status = 'confirmed';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Código não encontrado ou já utilizado');
  END IF;

  -- Marcar como usado (irreversível)
  UPDATE driver_recharges SET status = 'used', used_at = now() WHERE id = v_recharge.id;

  RETURN jsonb_build_object(
    'success', true,
    'recharge_id', v_recharge.id,
    'amount_paid', v_recharge.amount_paid,
    'credit_received', v_recharge.credit_received
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── RLS POLICIES ────────────────────────────────────────────────────────────

ALTER TABLE driver_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_credit_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_recharges ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_credit_log ENABLE ROW LEVEL SECURITY;

-- driver_wallets: motorista só vê a sua
CREATE POLICY "drivers_own_wallet" ON driver_wallets
  FOR ALL USING (auth.uid() = driver_id);

-- driver_credit_history: motorista só vê o seu
CREATE POLICY "drivers_own_history" ON driver_credit_history
  FOR SELECT USING (auth.uid() = driver_id);

-- driver_recharges: motorista só vê as suas
CREATE POLICY "drivers_own_recharges" ON driver_recharges
  FOR ALL USING (auth.uid() = driver_id);

-- driver_credit_log: motorista só vê o seu
CREATE POLICY "drivers_own_log" ON driver_credit_log
  FOR SELECT USING (auth.uid() = driver_id);

-- Admin pode ver tudo (para gestão)
CREATE POLICY "admin_all_wallets" ON driver_wallets
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "admin_all_recharges" ON driver_recharges
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── GRANTS ──────────────────────────────────────────────────────────────────

GRANT SELECT ON driver_wallets TO authenticated;
GRANT SELECT ON driver_credit_history TO authenticated;
GRANT SELECT ON driver_credit_log TO authenticated;
GRANT INSERT, UPDATE ON driver_recharges TO authenticated;

GRANT EXECUTE ON FUNCTION create_driver_recharge(NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_driver_recharge(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION can_driver_accept_ride() TO authenticated;
GRANT EXECUTE ON FUNCTION debit_operational_credit(UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION get_driver_wallet_status() TO authenticated;
GRANT EXECUTE ON FUNCTION use_recharge_code(UUID) TO authenticated;

REVOKE ALL ON FUNCTION create_driver_recharge(NUMERIC) FROM anon;
REVOKE ALL ON FUNCTION confirm_driver_recharge(UUID) FROM anon;
REVOKE ALL ON FUNCTION can_driver_accept_ride() FROM anon;
REVOKE ALL ON FUNCTION debit_operational_credit(UUID, NUMERIC) FROM anon;
REVOKE ALL ON FUNCTION get_driver_wallet_status() FROM anon;
REVOKE ALL ON FUNCTION use_recharge_code(UUID) FROM anon;
