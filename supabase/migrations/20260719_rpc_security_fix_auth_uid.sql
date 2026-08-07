-- =============================================================================
-- ZENITH RIDE — Migration: RPC Security Fix (auth.uid())
-- Data: 2026-07-19
--
-- PROBLEMA: Várias RPCs aceitam p_driver_id / p_user_id controlados pelo cliente.
--           Um utilizador malicioso pode passar o ID de outro user e:
--             - Aceitar corridas como outro motorista
--             - Cancelar corridas de outro utilizador
--             - Ler corridas activas de qualquer utilizador
--
-- SOLUÇÃO:  Todas as RPCs usam auth.uid() internamente. Parâmetros
--           client-controlled removidos ou ignorados.
--
-- RPCs corrigidas:
--   accept_ride_atomic    → usa auth.uid() em vez de p_driver_id
--   decline_ride_atomic   → usa auth.uid() em vez de p_driver_id
--   cancel_ride_safe      → usa auth.uid() em vez de p_user_id
--   get_active_ride       → usa auth.uid() em vez de p_user_id
--   recharge_chat_quota   → usa auth.uid() em vez de p_user_id
--
-- RPCs novas (transições de estado):
--   confirm_pickup        → motorista confirma que a caminho
--   start_ride            → motorista inicia a corrida
--   complete_ride         → motorista termina a corrida
--
-- RLS:
--   Remove USING(true) de FIX_RLS_DEFINITIVO.sql
--   Bloqueia anon em todas as tabelas sensíveis
--   FORCE RLS em rides e driver_locations
--
-- NOTA: NÃO aplicar rollback que reponha GRANT ALL TO anon.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 0. HELPER: is_driver() e is_passenger() — já existentes, garantir
-- =============================================================================
CREATE OR REPLACE FUNCTION public.is_driver()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'driver');
$$;

CREATE OR REPLACE FUNCTION public.is_passenger()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'passenger');
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin');
$$;

REVOKE ALL ON FUNCTION public.is_driver() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_passenger() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_driver() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_passenger() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- =============================================================================
-- 1. accept_ride_atomic — USA auth.uid() em vez de p_driver_id
-- =============================================================================
DROP FUNCTION IF EXISTS public.accept_ride_atomic(UUID, UUID);
CREATE OR REPLACE FUNCTION public.accept_ride_atomic(
  p_ride_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_driver_id UUID := auth.uid();
  v_ride      RECORD;
BEGIN
  IF v_driver_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  IF NOT public.is_driver() THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_a_driver');
  END IF;

  SELECT * INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'ride_not_found');
  END IF;

  IF v_ride.status != 'searching' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'ride_not_searching');
  END IF;

  IF v_ride.driver_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_accepted');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.driver_locations
    WHERE driver_id = v_driver_id AND status = 'available'
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'driver_not_available');
  END IF;

  UPDATE public.rides
  SET driver_id        = v_driver_id,
      status           = 'accepted',
      accepted_at      = NOW(),
      driver_confirmed = TRUE
  WHERE id = p_ride_id;

  UPDATE public.driver_locations
  SET status = 'busy', updated_at = NOW()
  WHERE driver_id = v_driver_id;

  RETURN jsonb_build_object('success', true, 'ride_id', p_ride_id);

EXCEPTION
  WHEN lock_not_available THEN
    RETURN jsonb_build_object('success', false, 'reason', 'race_condition_lost');
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_ride_atomic(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.accept_ride_atomic(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.accept_ride_atomic(UUID) FROM PUBLIC;

-- =============================================================================
-- 2. decline_ride_atomic — USA auth.uid() em vez de p_driver_id
-- =============================================================================
DROP FUNCTION IF EXISTS public.decline_ride_atomic(UUID, UUID);
CREATE OR REPLACE FUNCTION public.decline_ride_atomic(
  p_ride_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_driver_id UUID := auth.uid();
  v_status    ride_status;
  v_owner     UUID;
BEGIN
  IF v_driver_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  BEGIN
    SELECT r.status, r.driver_id
      INTO v_status, v_owner
    FROM public.rides r
    WHERE r.id = p_ride_id
    FOR UPDATE NOWAIT;
  EXCEPTION
    WHEN lock_not_available THEN
      RETURN jsonb_build_object('success', false, 'reason', 'concurrent_update');
  END;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'ride_not_found');
  END IF;

  IF v_owner IS DISTINCT FROM v_driver_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_your_ride');
  END IF;

  IF v_status NOT IN ('accepted', 'picking_up') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'ride_not_declinable');
  END IF;

  UPDATE public.rides
  SET driver_id        = NULL,
      driver_confirmed = FALSE,
      status           = 'searching',
      accepted_at      = NULL,
      pickup_at        = NULL
  WHERE id = p_ride_id;

  UPDATE public.driver_locations
  SET status = 'available', updated_at = NOW()
  WHERE driver_id = v_driver_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.decline_ride_atomic(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.decline_ride_atomic(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.decline_ride_atomic(UUID) FROM PUBLIC;

-- =============================================================================
-- 3. cancel_ride_safe — USA auth.uid() em vez de p_user_id
-- =============================================================================
DROP FUNCTION IF EXISTS public.cancel_ride_safe(UUID, UUID, TEXT);
CREATE OR REPLACE FUNCTION public.cancel_ride_safe(
  p_ride_id UUID,
  p_reason  TEXT DEFAULT 'Cancelado pelo utilizador'
)
RETURNS TABLE(success BOOLEAN, previous_status TEXT, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_ride       public.rides%ROWTYPE;
  v_prev_status TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, 'unknown'::TEXT, 'Autenticação necessária.'::TEXT;
    RETURN;
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found'::TEXT, 'Corrida não encontrada.'::TEXT;
    RETURN;
  END IF;

  v_prev_status := v_ride.status::TEXT;

  IF v_ride.passenger_id <> v_user_id
    AND (v_ride.driver_id IS NULL OR v_ride.driver_id <> v_user_id)
  THEN
    RETURN QUERY SELECT false, v_prev_status, 'Sem permissão para cancelar.'::TEXT;
    RETURN;
  END IF;

  IF v_ride.status IN ('completed', 'cancelled') THEN
    RETURN QUERY SELECT false, v_prev_status, 'Corrida já terminada.'::TEXT;
    RETURN;
  END IF;

  UPDATE public.rides
  SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = p_reason
  WHERE id = p_ride_id;

  IF v_ride.driver_id IS NOT NULL THEN
    UPDATE public.driver_locations
    SET status = 'available', updated_at = NOW()
    WHERE driver_id = v_ride.driver_id;
  END IF;

  RETURN QUERY SELECT true, v_prev_status, 'Corrida cancelada com sucesso.'::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_ride_safe(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_ride_safe(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_ride_safe(UUID, TEXT) FROM PUBLIC;

-- =============================================================================
-- 4. get_active_ride — USA auth.uid() em vez de p_user_id
-- =============================================================================
DROP FUNCTION IF EXISTS public.get_active_ride(UUID);
CREATE OR REPLACE FUNCTION public.get_active_ride()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_result  JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'id', r.id,
    'passenger_id', r.passenger_id,
    'driver_id', r.driver_id,
    'origin_address', r.origin_address,
    'origin_lat', r.origin_lat,
    'origin_lng', r.origin_lng,
    'dest_address', r.dest_address,
    'dest_lat', r.dest_lat,
    'dest_lng', r.dest_lng,
    'distance_km', r.distance_km,
    'duration_min', r.duration_min,
    'surge_multiplier', r.surge_multiplier,
    'price_kz', r.price_kz,
    'status', r.status,
    'driver_confirmed', r.driver_confirmed,
    'created_at', r.created_at,
    'accepted_at', r.accepted_at,
    'pickup_at', r.pickup_at,
    'started_at', r.started_at,
    'completed_at', r.completed_at,
    'cancelled_at', r.cancelled_at,
    'cancel_reason', r.cancel_reason,
    'driver_name', d.name,
    'passenger_name', p.name
  ) INTO v_result
  FROM public.rides r
  LEFT JOIN public.profiles d ON d.user_id = r.driver_id
  LEFT JOIN public.profiles p ON p.user_id = r.passenger_id
  WHERE (r.passenger_id = v_user_id OR r.driver_id = v_user_id)
    AND r.status NOT IN ('completed', 'cancelled')
  ORDER BY r.created_at DESC
  LIMIT 1;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_ride() TO authenticated;
REVOKE ALL ON FUNCTION public.get_active_ride() FROM anon;
REVOKE ALL ON FUNCTION public.get_active_ride() FROM PUBLIC;

-- =============================================================================
-- 5. recharge_chat_quota — USA auth.uid()
-- =============================================================================
DROP FUNCTION IF EXISTS public.recharge_chat_quota(UUID, INT);
CREATE OR REPLACE FUNCTION public.recharge_chat_quota(
  amount INT DEFAULT 10
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.profiles
  SET chat_quota = LEAST(COALESCE(chat_quota, 0) + amount, 50)
  WHERE user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.recharge_chat_quota(INT) TO authenticated;
REVOKE ALL ON FUNCTION public.recharge_chat_quota(INT) FROM anon;
REVOKE ALL ON FUNCTION public.recharge_chat_quota(INT) FROM PUBLIC;

-- =============================================================================
-- 6. RPCs NOVAS: Transições de estado (confirm_pickup, start_ride, complete_ride)
-- =============================================================================

-- 6.1 confirm_pickup — motorista confirma que está a caminho / apanhar passageiro
CREATE OR REPLACE FUNCTION public.confirm_pickup(
  p_ride_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_driver_id UUID := auth.uid();
  v_ride      RECORD;
BEGIN
  IF v_driver_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  IF NOT public.is_driver() THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_a_driver');
  END IF;

  SELECT * INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'ride_not_found');
  END IF;

  IF v_ride.driver_id != v_driver_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_your_ride');
  END IF;

  IF v_ride.status != 'accepted' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_status', 'current_status', v_ride.status::text);
  END IF;

  UPDATE public.rides
  SET status    = 'picking_up',
      pickup_at = NOW()
  WHERE id = p_ride_id;

  RETURN jsonb_build_object('success', true, 'ride_id', p_ride_id, 'new_status', 'picking_up');

EXCEPTION
  WHEN lock_not_available THEN
    RETURN jsonb_build_object('success', false, 'reason', 'concurrent_update');
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_pickup(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.confirm_pickup(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.confirm_pickup(UUID) FROM PUBLIC;

-- 6.2 start_ride — motorista inicia a corrida (passageiro a bordo)
CREATE OR REPLACE FUNCTION public.start_ride(
  p_ride_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_driver_id UUID := auth.uid();
  v_ride      RECORD;
BEGIN
  IF v_driver_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  IF NOT public.is_driver() THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_a_driver');
  END IF;

  SELECT * INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'ride_not_found');
  END IF;

  IF v_ride.driver_id != v_driver_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_your_ride');
  END IF;

  IF v_ride.status != 'picking_up' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_status', 'current_status', v_ride.status::text);
  END IF;

  UPDATE public.rides
  SET status     = 'in_progress',
      started_at = NOW()
  WHERE id = p_ride_id;

  RETURN jsonb_build_object('success', true, 'ride_id', p_ride_id, 'new_status', 'in_progress');

EXCEPTION
  WHEN lock_not_available THEN
    RETURN jsonb_build_object('success', false, 'reason', 'concurrent_update');
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_ride(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.start_ride(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.start_ride(UUID) FROM PUBLIC;

-- 6.3 complete_ride — motorista termina a corrida
CREATE OR REPLACE FUNCTION public.complete_ride(
  p_ride_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_driver_id UUID := auth.uid();
  v_ride      RECORD;
BEGIN
  IF v_driver_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  IF NOT public.is_driver() THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_a_driver');
  END IF;

  SELECT * INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'ride_not_found');
  END IF;

  IF v_ride.driver_id != v_driver_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_your_ride');
  END IF;

  IF v_ride.status != 'in_progress' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_status', 'current_status', v_ride.status::text);
  END IF;

  UPDATE public.rides
  SET status       = 'completed',
      completed_at = NOW()
  WHERE id = p_ride_id;

  UPDATE public.driver_locations
  SET status = 'available', updated_at = NOW()
  WHERE driver_id = v_driver_id;

  RETURN jsonb_build_object('success', true, 'ride_id', p_ride_id, 'new_status', 'completed');

EXCEPTION
  WHEN lock_not_available THEN
    RETURN jsonb_build_object('success', false, 'reason', 'concurrent_update');
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_ride(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.complete_ride(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.complete_ride(UUID) FROM PUBLIC;

-- =============================================================================
-- 7. cancel_ride (RPC simples — para compatibilidade com FIX_RLS_LOTE1_COMPLETO)
-- =============================================================================
DROP FUNCTION IF EXISTS public.cancel_ride(UUID, TEXT);
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

  SELECT * INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Corrida não encontrada' USING ERRCODE = 'NRIDE';
  END IF;

  IF v_ride.passenger_id != v_user_id AND v_ride.driver_id != v_user_id THEN
    RAISE EXCEPTION 'Não tens permissão para cancelar esta corrida' USING ERRCODE = 'PERM';
  END IF;

  IF v_ride.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Corrida já está finalizada' USING ERRCODE = 'STATE';
  END IF;

  UPDATE public.rides
  SET status        = 'cancelled',
      cancelled_at  = NOW(),
      cancel_reason = COALESCE(p_reason, 'Cancelado pelo utilizador')
  WHERE id = p_ride_id
    AND status NOT IN ('completed', 'cancelled')
  RETURNING * INTO v_result;

  IF v_ride.driver_id IS NOT NULL THEN
    UPDATE public.driver_locations
    SET status = 'available', updated_at = NOW()
    WHERE driver_id = v_ride.driver_id;
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_ride(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_ride(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_ride(UUID, TEXT) FROM PUBLIC;

-- =============================================================================
-- 8. RLS — Corrigir FIX_RLS_DEFINITIVO (remover USING(true))
-- =============================================================================

-- 8.1 Remover políticas antigas perigosas
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

-- 8.2 RIDES — Políticas correctas (sem USING(true))
-- Passenger: vê as suas corridas
CREATE POLICY "rides_select_own_passenger"
  ON public.rides FOR SELECT TO authenticated
  USING (passenger_id = auth.uid() AND public.is_passenger());

-- Driver: vê as suas corridas atribuídas
CREATE POLICY "rides_select_own_driver"
  ON public.rides FOR SELECT TO authenticated
  USING (driver_id = auth.uid() AND public.is_driver());

-- Passenger: cria a sua corrida
CREATE POLICY "rides_insert_own_passenger"
  ON public.rides FOR INSERT TO authenticated
  WITH CHECK (passenger_id = auth.uid() AND public.is_passenger());

-- ⚠️ NÃO há policy UPDATE — updates são feitos via RPCs (accept_ride, cancel_ride, etc.)

-- Admin: acesso total (com WITH CHECK)
CREATE POLICY "rides_admin_all"
  ON public.rides FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 8.3 DRIVER_LOCATIONS — Políticas correctas
-- Driver: vê a sua própria localização
CREATE POLICY "dl_select_own_driver"
  ON public.driver_locations FOR SELECT TO authenticated
  USING (driver_id = auth.uid() AND public.is_driver());

-- Driver: insere a sua localização
CREATE POLICY "dl_insert_own_driver"
  ON public.driver_locations FOR INSERT TO authenticated
  WITH CHECK (driver_id = auth.uid() AND public.is_driver());

-- Driver: actualiza a sua localização
CREATE POLICY "dl_update_own_driver"
  ON public.driver_locations FOR UPDATE TO authenticated
  USING (driver_id = auth.uid() AND public.is_driver())
  WITH CHECK (driver_id = auth.uid());

-- Driver: apaga o seu registo
CREATE POLICY "dl_delete_own_driver"
  ON public.driver_locations FOR DELETE TO authenticated
  USING (driver_id = auth.uid() AND public.is_driver());

-- Admin: acesso total
CREATE POLICY "dl_admin_all"
  ON public.driver_locations FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- =============================================================================
-- 9. BLOQUEAR ANON e FORÇAR RLS
-- =============================================================================
ALTER TABLE public.rides FORCE ROW LEVEL SECURITY;
ALTER TABLE public.driver_locations FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.rides FROM anon;
REVOKE ALL ON public.driver_locations FROM anon;

-- =============================================================================
-- 10. REALTIME — Garantir publicação para rides e driver_locations
-- =============================================================================
-- Nota: Isto precisa de ser executado no Supabase Dashboard ou via
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.rides;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_locations;
-- O Supabase gerencia isto automaticamente se as tabelas tiverem RLS activo.
-- Verificar no Dashboard > Database > Replication.

-- =============================================================================
-- 11. REVOKE permissões residuais de funções antigas
-- =============================================================================
-- Aceitar corrida antiga (com p_driver_id) — bloquear
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'accept_ride_atomic' AND pg_proc.proargtypes::text[] = '{28,28}') THEN
    -- Não fazer DROP se já foi recriada acima com assinatura nova
    NULL;
  END IF;
END $$;

-- Bloquear EXECUTE em todas as RPCs para anon (condicional)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_searching_rides') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_searching_rides() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_available_drivers') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_available_drivers() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_tracking_driver_location') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_tracking_driver_location(UUID) FROM anon';
  END IF;
END $$;

COMMIT;
