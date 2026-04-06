-- ==============================================================================
-- ZENITH RIDE v3.0 — Correcções RLS (Row Level Security)
-- Protege contra actualizações indevidas no estado das corridas
-- Garante que motoristas só vêm e aceitam o que têm autorização
-- ==============================================================================

-- 1. DROP as políticas inseguras antigas
DROP POLICY IF EXISTS "rides: motorista vê" ON public.rides;
DROP POLICY IF EXISTS "rides: motorista actualiza" ON public.rides;

-- 2. Motorista vê as corridas que lhe foram atribuídas ou que estão pendentes no mercado (searching)
CREATE POLICY "rides: motorista vê"
  ON public.rides FOR SELECT
  USING (
    auth.uid() = driver_id
    OR (status = 'searching' AND driver_id IS NULL)
  );

-- 3. Motorista actualiza (ACEITA) corridas em 'searching' que não têm motorista
CREATE POLICY "rides: motorista aceita"
  ON public.rides FOR UPDATE
  USING (
    driver_id IS NULL AND status = 'searching'
  )
  WITH CHECK (
    -- Só pode aceitar e colocar o seu próprio driver_id
    driver_id = auth.uid() AND status = 'accepted'
  );

-- 4. Motorista actualiza as suas PRÓPRIAS corridas
CREATE POLICY "rides: motorista actualiza própria"
  ON public.rides FOR UPDATE
  USING (
    driver_id = auth.uid()
  )
  WITH CHECK (
    driver_id = auth.uid()
  );
