-- =============================================================================
-- FIX CANCELAMENTO + EMAIL (19 AGO 2026)
-- Corrige a política de Update do Passageiro que impedia a gravação do status 'cancelled'
-- =============================================================================

-- 1. Remover a política antiga que tinha o BUG (bloqueava a nova linha de ser 'cancelled')
DROP POLICY IF EXISTS "rides: passageiro cancela" ON public.rides;

-- 2. Criar a política CORRETA (USING = o que ele pode editar | WITH CHECK = validação da nova linha)
CREATE POLICY "rides: passageiro cancela"
  ON public.rides FOR UPDATE
  USING (auth.uid() = passenger_id AND status NOT IN ('completed', 'cancelled'))
  WITH CHECK (auth.uid() = passenger_id);

-- Mensagem de Confirmação na consola SQL
SELECT 'A política de cancelamento foi corrigida com sucesso! O passageiro já pode cancelar.' AS status;
