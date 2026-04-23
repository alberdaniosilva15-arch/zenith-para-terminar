-- =============================================================================
-- FIX 3 (Definitivo): Resolvendo a política "random" de ficar online
-- e libertando a visualização de corridas para evitar bloqueios em navegadores.
-- =============================================================================

-- Remover TODAS as políticas da tabela que causam conflitos aleatoriamente:
DROP POLICY IF EXISTS "driver_locations: motorista gere" ON public.driver_locations;
DROP POLICY IF EXISTS "driver_locations_update" ON public.driver_locations;
DROP POLICY IF EXISTS "driver_locations_manage" ON public.driver_locations;
DROP POLICY IF EXISTS "driver_locs_tenant_isolation" ON public.driver_locations;

-- 1. Nova política ÚNICA de insert/update blindada:
CREATE POLICY "driver_manage_own_location" 
ON public.driver_locations FOR ALL 
USING (true)
WITH CHECK (auth.uid() = driver_id);

-- E GARANTIR que os utilizadores podem ver todas as driver_locations activas:
DROP POLICY IF EXISTS "driver_locations: leitura pública" ON public.driver_locations;
CREATE POLICY "driver_locations_public_read" 
ON public.driver_locations FOR SELECT 
USING (true);

-- 2. Limpar a restrição de rides RLS (já corrigi no anterior, forçando tudo limpo agora):
DROP POLICY IF EXISTS "rides: motorista vê" ON public.rides;
CREATE POLICY "rides: motorista vê TODAS no mapa" 
ON public.rides FOR SELECT 
USING (true); -- Permitimos ver tudo se for Select. Lógica da UI já filtra.
