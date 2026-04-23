-- =============================================================================
-- ZENITH RIDE - Correcção Final de RLS (Fluxo de Corrida e Realtime)
-- Date: 2026-04-22
-- =============================================================================

BEGIN;

-- 1. CORRECÇÃO NA TABELA RIDES (Corridas)
-- =============================================================================

-- Remover políticas antigas para evitar conflitos (nomes antigos e novos)
DROP POLICY IF EXISTS "rides: select passenger" ON public.rides;
DROP POLICY IF EXISTS "rides: select driver" ON public.rides;
DROP POLICY IF EXISTS "rides: select searching" ON public.rides;
DROP POLICY IF EXISTS "rides: insert passenger" ON public.rides;
DROP POLICY IF EXISTS "rides: update participants" ON public.rides;
DROP POLICY IF EXISTS "rides: motorista pode ver corridas em searching" ON public.rides;
DROP POLICY IF EXISTS "rides: passageiro ou motorista autenticado atualiza" ON public.rides;
DROP POLICY IF EXISTS "rides: passageiro vê as suas corridas" ON public.rides;
DROP POLICY IF EXISTS "rides: motorista vê as suas corridas atribuídas" ON public.rides;
DROP POLICY IF EXISTS "rides: motoristas vêem corridas disponíveis" ON public.rides;
DROP POLICY IF EXISTS "rides: passageiro cria a sua corrida" ON public.rides;
DROP POLICY IF EXISTS "rides: participantes actualizam corrida" ON public.rides;

-- A. SELECT: Quem pode ver o quê?
-- 1. Passageiro vê as suas próprias corridas (essencial para Realtime funcionar)
CREATE POLICY "rides: passageiro vê as suas corridas"
  ON public.rides FOR SELECT TO authenticated
  USING (passenger_id = auth.uid());

-- 2. Motorista vê as corridas que lhe foram atribuídas
CREATE POLICY "rides: motorista vê as suas corridas atribuídas"
  ON public.rides FOR SELECT TO authenticated
  USING (driver_id = auth.uid());

-- 3. Todos os motoristas vêem corridas em estado de procura (Leilão/Global)
CREATE POLICY "rides: motoristas vêem corridas disponíveis"
  ON public.rides FOR SELECT TO authenticated
  USING (status = 'searching' AND driver_id IS NULL);

-- B. INSERT: Quem pode criar?
CREATE POLICY "rides: passageiro cria a sua corrida"
  ON public.rides FOR INSERT TO authenticated
  WITH CHECK (passenger_id = auth.uid());

-- C. UPDATE: Quem pode actualizar?
CREATE POLICY "rides: participantes actualizam corrida"
  ON public.rides FOR UPDATE TO authenticated
  USING (
    passenger_id = auth.uid() OR 
    driver_id = auth.uid() OR
    (driver_id IS NULL AND status = 'searching') -- Necessário para o accept_ride_atomic
  )
  WITH CHECK (
    passenger_id = auth.uid() OR 
    driver_id = auth.uid()
  );


-- 2. CORRECÇÃO NA TABELA DRIVER_LOCATIONS (Mapa)
-- =============================================================================

-- Remover políticas antigas
DROP POLICY IF EXISTS "driver_locations: select all available" ON public.driver_locations;
DROP POLICY IF EXISTS "driver_locations: select assigned" ON public.driver_locations;
DROP POLICY IF EXISTS "driver_locations_update" ON public.driver_locations;
DROP POLICY IF EXISTS "driver_locations: ver motoristas disponíveis" ON public.driver_locations;
DROP POLICY IF EXISTS "driver_locations: ver motorista atribuído" ON public.driver_locations;
DROP POLICY IF EXISTS "driver_locations: motorista actualiza a sua posição" ON public.driver_locations;
DROP POLICY IF EXISTS "driver_locations: motorista insere posição inicial" ON public.driver_locations;

-- A. SELECT: Ver motoristas no mapa
-- 1. Ver todos os motoristas disponíveis (para o ecrã inicial)
CREATE POLICY "driver_locations: ver motoristas disponíveis"
  ON public.driver_locations FOR SELECT TO authenticated
  USING (status = 'available');

-- 2. Ver o motorista que está a realizar a minha corrida (para seguimento)
CREATE POLICY "driver_locations: ver motorista atribuído"
  ON public.driver_locations FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.rides
    WHERE rides.driver_id = driver_locations.driver_id
      AND rides.passenger_id = auth.uid()
      AND rides.status NOT IN ('completed', 'cancelled')
  ));

-- B. UPDATE: Motorista actualiza a sua posição
CREATE POLICY "driver_locations: motorista actualiza a sua posição"
  ON public.driver_locations FOR UPDATE TO authenticated
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());

-- C. INSERT: Motorista cria o seu registo de localização
CREATE POLICY "driver_locations: motorista insere posição inicial"
  ON public.driver_locations FOR INSERT TO authenticated
  WITH CHECK (driver_id = auth.uid());


-- 3. GARANTIR QUE O REALTIME ESTÁ ACTIVO (Redundante)
-- =============================================================================
-- Já deve estar activo na publicação, mas garantimos as tabelas
ALTER TABLE public.rides REPLICA IDENTITY FULL;
ALTER TABLE public.driver_locations REPLICA IDENTITY FULL;
ALTER TABLE public.contracts REPLICA IDENTITY FULL;


-- 4. CORRECÇÃO NA TABELA CONTRACTS (Contratos IA)
-- =============================================================================

DROP POLICY IF EXISTS "contracts: passageiro vê os seus contratos" ON public.contracts;
DROP POLICY IF EXISTS "contracts: passageiro cria os seus contratos" ON public.contracts;
DROP POLICY IF EXISTS "contracts: passageiro actualiza os seus contratos" ON public.contracts;

CREATE POLICY "contracts: passageiro vê os seus contratos"
  ON public.contracts FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "contracts: passageiro cria os seus contratos"
  ON public.contracts FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "contracts: passageiro actualiza os seus contratos"
  ON public.contracts FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMIT;
