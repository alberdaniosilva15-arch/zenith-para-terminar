-- =============================================================================
-- ZENITH RIDE v3.5.1
-- CORRECÇÃO: Adição de política de INSERT na tabela school_tracking_sessions
-- =============================================================================

-- Remover política de inserção antiga caso exista com outro nome
DROP POLICY IF EXISTS "tracking: dono cria sessão" ON public.school_tracking_sessions;

-- Permitir que o dono do contrato crie uma nova sessão de rastreio
CREATE POLICY "tracking: dono cria sessão"
  ON public.school_tracking_sessions FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = contract_id AND c.user_id = auth.uid()
    )
  );

-- Opcional: Adicionar política de UPDATE para prolongar expiração se necessário
DROP POLICY IF EXISTS "tracking: dono atualiza sessão" ON public.school_tracking_sessions;
CREATE POLICY "tracking: dono atualiza sessão"
  ON public.school_tracking_sessions FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = contract_id AND c.user_id = auth.uid()
    )
  );
