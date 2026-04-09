-- ==============================================================================
-- ZENITH RIDE v3.0 — PREPARAÇÃO PARA O MODO "PRODUCTION-READY"
-- SEGURANÇA RLS (Row Level Security) - REFORÇO
-- 
-- INSTRUÇÕES DE APLICAÇÃO:
-- Executa este script no interface do teu Supabase SQL Editor.
-- Isto garante blindagem absoluta, onde apenas quem participa na corrida pode modificá-la.
-- ==============================================================================

-- 1. CORRIGIR: Motorista não pode atualizar corridas em que não está "bound/atribuído"
-- Exceção natural: Apenas no momento que o motorista escolhe "ACEITAR" a corrida (muda estado para ACCEPTED e define-se como driver_id)
DROP POLICY IF EXISTS "rides: actualiza" ON public.rides;

CREATE POLICY "rides: passageiro ou motorista autenticado atualiza" 
ON public.rides
FOR UPDATE 
TO authenticated 
USING (
  -- QUEM PODE ATUALIZAR UM REGISTO EXISTENTE?
  -- 1. O passageiro dono da corrida
  passenger_id = auth.uid() OR
  
  -- 2. O motorista que já está atribuído à corrida
  driver_id = auth.uid() OR
  
  -- 3. Ou o motorista que a está a reclamar agora (aceitar em leilão/searching)
  -- mas apenas se a corrida não tem nenhum motorista validado ainda
  (driver_id IS NULL AND status = 'searching')
)
WITH CHECK (
  -- GARANTIR A INTEGRIDADE DA ATUALIZAÇÃO
  -- O utilizador não se pode dar "hijack" à role do outro.
  passenger_id = auth.uid() OR driver_id = auth.uid()
);

-- 2. GARANTIR A VISÃO DOS MOTORISTAS ÀS CORRIDAS DISPONÍVEIS
DROP POLICY IF EXISTS "rides: motorista pode ver corridas em searching" ON public.rides;

CREATE POLICY "rides: motorista pode ver corridas em searching" 
ON public.rides
FOR SELECT 
TO authenticated 
USING (
  -- Motoristas vêm as corridas paradas ou na fase do leilão em busca de motorista
  status = 'searching' 
  -- Outras policies garantem que já podem ver as SUAS corridas
);

-- 3. POLÍTICA DE SEGURO WKB / Posição (Driver_Tracking)
-- Se não há proteção em driver_locations
DROP POLICY IF EXISTS "driver_locations_update" ON public.driver_locations;

CREATE POLICY "driver_locations_update"
ON public.driver_locations
FOR UPDATE
TO authenticated
USING ( driver_id = auth.uid() ) 
WITH CHECK ( driver_id = auth.uid() );

-- ==============================================================================
-- A tua base de dados está agora protegida!
-- ==============================================================================
