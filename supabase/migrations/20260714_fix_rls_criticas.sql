-- ============================================================
-- Corrigir RLS de rides (remove USING (true))
-- ============================================================

DROP POLICY IF EXISTS "rides: motorista vê TODAS no mapa" ON public.rides;

-- Passageiro vê as suas próprias corridas
CREATE POLICY "rides: passageiro vê as suas corridas"
  ON public.rides FOR SELECT TO authenticated
  USING (passenger_id = auth.uid());

-- Motorista vê as corridas atribuídas
CREATE POLICY "rides: motorista vê as suas corridas atribuídas"
  ON public.rides FOR SELECT TO authenticated
  USING (driver_id = auth.uid());

-- Motoristas vêem corridas disponíveis (searching, sem motorista)
CREATE POLICY "rides: motoristas vêem corridas disponíveis"
  ON public.rides FOR SELECT TO authenticated
  USING (status = 'searching' AND driver_id IS NULL);


-- ============================================================
-- Corrigir RLS de driver_locations (remove USING (true))
-- ============================================================

DROP POLICY IF EXISTS "driver_manage_own_location" ON public.driver_locations;

-- Motorista vê e gere a sua própria localização
CREATE POLICY "driver_manage_own_location"
  ON public.driver_locations FOR ALL
  USING (auth.uid() = driver_id)
  WITH CHECK (auth.uid() = driver_id);

-- Público (autenticado) vê APENAS motoristas disponíveis (para o mapa)
CREATE POLICY "driver_locations_public_read"
  ON public.driver_locations FOR SELECT
  USING (status = 'available');
