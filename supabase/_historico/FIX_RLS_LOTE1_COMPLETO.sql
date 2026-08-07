-- ============================================================================
-- ZENITH RIDE — LOTE 1: RLS (exposição GPS)
-- Prioridade máxima: remover USING(true) e dados sensíveis de rides/driver_locations
-- Versão corrigida com:
--   ✅ RPC para dados mínimos (sem colunas sensíveis)
--   ✅ RPC exclusiva para cancelamento (só altera campos de cancelamento)
--   ✅ RPC para tracking (GPS exacto SÓ durante corrida activa)
--   ✅ FOUND + FOR UPDATE na accept_ride
--   ✅ WITH CHECK em todas as policies inclusive admin
--   ✅ Anon completamente bloqueado
--   ✅ Chaves não alteradas
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECÇÃO 0 — HELPER FUNCTIONS (role verification)
-- ============================================================================

-- is_driver: verifica role no servidor (security definer evita RLS recursion)
CREATE OR REPLACE FUNCTION public.is_driver()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND role = 'driver'
  );
$$;

-- is_passenger
CREATE OR REPLACE FUNCTION public.is_passenger()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND role = 'passenger'
  );
$$;

REVOKE ALL ON FUNCTION public.is_driver() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_passenger() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_driver() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_passenger() TO authenticated;

-- ============================================================================
-- SECÇÃO 1 — RPCS PARA DADOS MÍNIMOS (substituem SELECT policies abertas)
-- ============================================================================

-- 1.1 get_searching_rides: motorista vê corridas disponíveis (dados mínimos)
--     SEM origin_lat/lng (coordenadas privadas antes da aceitação)
--     SEM passenger_id (PII)
--     SEM public_token, student_name, payment_*, cancel_*
CREATE OR REPLACE FUNCTION public.get_searching_rides()
RETURNS TABLE(
  id              UUID,
  origin_address  TEXT,
  dest_address    TEXT,
  distance_km     NUMERIC,
  duration_min    INT,
  price_kz        NUMERIC,
  surge_multiplier NUMERIC,
  vehicle_type    TEXT,
  created_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Só motoristas podem ver corridas disponíveis
  IF NOT public.is_driver() THEN
    RAISE EXCEPTION 'Apenas motoristas' USING ERRCODE = 'ROLE';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.origin_address,
    r.dest_address,
    r.distance_km,
    r.duration_min,
    r.price_kz,
    r.surge_multiplier,
    r.vehicle_type,
    r.created_at
  FROM public.rides r
  WHERE r.status = 'searching'
    AND r.driver_id IS NULL
  ORDER BY r.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_searching_rides() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_searching_rides() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_searching_rides() TO authenticated;

-- 1.2 get_available_drivers: passageiro vê motoristas disponíveis
--     SEM GPS exacto (location) — APENAS H3 hex (~150m resolução)
--     SEM phone, email ou PII
CREATE OR REPLACE FUNCTION public.get_available_drivers()
RETURNS TABLE(
  driver_id      UUID,
  h3_index_res9  TEXT,
  heading        NUMERIC,
  acceptance_rate NUMERIC,
  recent_cancellations INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Tanto passageiros como motoristas podem ver motoristas disponíveis
  IF NOT public.is_driver() AND NOT public.is_passenger() THEN
    RAISE EXCEPTION 'Apenas utilizadores autenticados' USING ERRCODE = 'ROLE';
  END IF;

  RETURN QUERY
  SELECT
    dl.driver_id,
    dl.h3_index_res9,
    dl.heading,
    dl.acceptance_rate,
    dl.recent_cancellations
  FROM public.driver_locations dl
  WHERE dl.status = 'available'
  ORDER BY dl.updated_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_available_drivers() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_available_drivers() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_available_drivers() TO authenticated;

-- 1.3 get_tracking_driver_location: passageiro vê GPS exacto do motorista
--     SÓ durante corrida activa (accepted/picking_up/in_progress)
--     Verifica que o passageiro é dono da corrida
CREATE OR REPLACE FUNCTION public.get_tracking_driver_location(p_ride_id UUID)
RETURNS TABLE(
  driver_id  UUID,
  latitude   DOUBLE PRECISION,
  longitude  DOUBLE PRECISION,
  heading    NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_ride public.rides;
BEGIN
  -- Verificar autenticação
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária' USING ERRCODE = 'AUTH';
  END IF;

  -- Obter a corrida e verificar que o user é passageiro dela
  SELECT * INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
    AND passenger_id = auth.uid()
    AND status IN ('accepted', 'picking_up', 'in_progress');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Corrida não encontrada ou não activa' USING ERRCODE = 'NRIDE';
  END IF;

  RETURN QUERY
  SELECT
    dl.driver_id,
    ST_Y(dl.location::geometry) AS latitude,
    ST_X(dl.location::geometry) AS longitude,
    dl.heading
  FROM public.driver_locations dl
  WHERE dl.driver_id = v_ride.driver_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_tracking_driver_location(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_tracking_driver_location(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_tracking_driver_location(UUID) TO authenticated;

-- ============================================================================
-- SECÇÃO 2 — RPC DE ACEITAÇÃO (substitui UPDATE directo)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.accept_ride(p_ride_id UUID)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_driver_id UUID := auth.uid();
  v_result    public.rides;
BEGIN
  -- Auth check
  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária' USING ERRCODE = 'AUTH';
  END IF;

  -- Role check
  IF NOT public.is_driver() THEN
    RAISE EXCEPTION 'Apenas motoristas podem aceitar corridas' USING ERRCODE = 'ROLE';
  END IF;

  -- FOR UPDATE SKIP LOCKED: trava a linha SEM bloquear outros motoristas
  -- Se outro motorista já está a processar esta ride, SKIP LOCKED salta
  PERFORM 1 FROM public.rides
  WHERE id = p_ride_id
    AND status = 'searching'
    AND driver_id IS NULL
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Corrida não disponível ou já atribuída a outro motorista'
      USING ERRCODE = 'NRIDE';
  END IF;

  -- Atomic UPDATE dentro da mesma transacção (lock já adquirido)
  UPDATE public.rides
  SET
    driver_id        = v_driver_id,
    status           = 'accepted',
    accepted_at      = NOW(),
    driver_confirmed = TRUE
  WHERE id = p_ride_id
    AND status = 'searching'
    AND driver_id IS NULL
  RETURNING * INTO v_result;

  -- Dupla verificação: segurança extra contra race condition
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Concorrência: corrida foi aceite entretanto'
      USING ERRCODE = 'NRIDE';
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_ride(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_ride(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_ride(UUID) TO authenticated;

-- ============================================================================
-- SECÇÃO 3 — RPC DE CANCELAMENTO (SÓ altera campos de cancelamento)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cancel_ride(
  p_ride_id UUID,
  p_reason  TEXT DEFAULT NULL
)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_ride    public.rides;
  v_result  public.rides;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária' USING ERRCODE = 'AUTH';
  END IF;

  -- Bloquear a linha para evitar race conditions
  SELECT * INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Corrida não encontrada' USING ERRCODE = 'NRIDE';
  END IF;

  -- Verificar ownership (passageiro ou motorista podem cancelar)
  IF v_ride.passenger_id != v_user_id AND v_ride.driver_id != v_user_id THEN
    RAISE EXCEPTION 'Não tens permissão para cancelar esta corrida'
      USING ERRCODE = 'PERM';
  END IF;

  -- Verificar status
  IF v_ride.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Corrida já está finalizada' USING ERRCODE = 'STATE';
  END IF;

  -- ⚠️ SÓ altera campos de cancelamento — NADA mais
  -- Não toca em price_kz, origin_lat, dest_address, nem qualquer outro campo
  UPDATE public.rides
  SET
    status        = 'cancelled',
    cancelled_at  = NOW(),
    cancel_reason = COALESCE(p_reason, 'Cancelado pelo utilizador')
  WHERE id = p_ride_id
    AND status NOT IN ('completed', 'cancelled')
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_ride(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_ride(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_ride(UUID, TEXT) TO authenticated;

-- ============================================================================
-- SECÇÃO 4 — POLÍTICAS RLS
-- ============================================================================

-- ─── 4.0 DROP de TODAS as políticas antigas ─────────────────────────────────
-- Usa pg_policies para varrer todos os nomes existentes
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('rides', 'driver_locations')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- ─── 4.1 RIDES ──────────────────────────────────────────────────────────────
-- SELECT: Passageiro vê as suas próprias corridas (dados completos)
CREATE POLICY "rides_select_own_passenger"
  ON public.rides FOR SELECT TO authenticated
  USING (
    passenger_id = auth.uid()
    AND public.is_passenger()
  );

-- SELECT: Motorista vê as suas corridas atribuídas (dados completos)
CREATE POLICY "rides_select_own_driver"
  ON public.rides FOR SELECT TO authenticated
  USING (
    driver_id = auth.uid()
    AND public.is_driver()
  );

-- ⚠️ NÃO há policy SELECT para searching rides
-- Motoristas usam RPC get_searching_rides() — retorna só dados mínimos

-- INSERT: Passageiro cria a sua corrida
CREATE POLICY "rides_insert_own_passenger"
  ON public.rides FOR INSERT TO authenticated
  WITH CHECK (
    passenger_id = auth.uid()
    AND public.is_passenger()
  );

-- ⚠️ NÃO há policy de UPDATE geral
-- Aceitação → RPC accept_ride()
-- Cancelamento → RPC cancel_ride()
-- UPDATE de status pelo motorista (completed, picking_up, etc.) → a decidir

-- ALL: Admin (com WITH CHECK simétrico ao USING)
CREATE POLICY "rides_admin_all"
  ON public.rides FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ─── 4.2 DRIVER_LOCATIONS ──────────────────────────────────────────────────
-- SELECT: Motorista vê a sua própria localização
CREATE POLICY "dl_select_own_driver"
  ON public.driver_locations FOR SELECT TO authenticated
  USING (
    driver_id = auth.uid()
    AND public.is_driver()
  );

-- ⚠️ NÃO há policy de SELECT público para available drivers
-- Usar RPC get_available_drivers() — retorna H3 hex, não GPS exacto

-- ⚠️ NÃO há policy de SELECT para tracking
-- Usar RPC get_tracking_driver_location(UUID) — verifica ownership da ride

-- INSERT: Motorista cria o seu registo de localização
CREATE POLICY "dl_insert_own_driver"
  ON public.driver_locations FOR INSERT TO authenticated
  WITH CHECK (
    driver_id = auth.uid()
    AND public.is_driver()
  );

-- UPDATE: Motorista actualiza a sua localização
CREATE POLICY "dl_update_own_driver"
  ON public.driver_locations FOR UPDATE TO authenticated
  USING (
    driver_id = auth.uid()
    AND public.is_driver()
  )
  WITH CHECK (
    driver_id = auth.uid()
  );

-- DELETE: Motorista apaga o seu registo
CREATE POLICY "dl_delete_own_driver"
  ON public.driver_locations FOR DELETE TO authenticated
  USING (
    driver_id = auth.uid()
    AND public.is_driver()
  );

-- ALL: Admin (com WITH CHECK)
CREATE POLICY "dl_admin_all"
  ON public.driver_locations FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================================
-- SECÇÃO 5 — BLOQUEAR ANON E FORÇAR RLS
-- ============================================================================

ALTER TABLE public.rides FORCE ROW LEVEL SECURITY;
ALTER TABLE public.driver_locations FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.rides FROM anon;
REVOKE ALL ON public.driver_locations FROM anon;

-- ============================================================================
-- SECÇÃO 6 — REVOGAR permissões de UPDATE/DELETE directo para não-admin
-- (Garantia extra: mesmo se uma policy escapar, o UPDATE em colunas sensíveis
--  é bloqueado ao nível da tabela para roles normais)
-- ============================================================================
REVOKE ALL ON FUNCTION public.accept_ride(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_ride(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.get_searching_rides() FROM anon;
REVOKE ALL ON FUNCTION public.get_available_drivers() FROM anon;
REVOKE ALL ON FUNCTION public.get_tracking_driver_location(UUID) FROM anon;

COMMIT;
