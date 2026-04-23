-- =============================================================================
-- ZENITH RIDE - Correcção do Fluxo de Documentos e Aprovação de Motoristas
-- Date: 2026-04-22
-- =============================================================================

BEGIN;

-- 1. Garantir colunas essenciais
ALTER TABLE public.driver_documents 
  ADD COLUMN IF NOT EXISTS bi_storage_path TEXT;

-- 2. Garantir que is_admin_secure existe e está correcta (redundante mas seguro)
CREATE OR REPLACE FUNCTION public.is_admin_secure()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
END;
$$;

-- 2. Corrigir RLS da tabela driver_documents para usar is_admin_secure
DROP POLICY IF EXISTS "driver_documents: admin sees all" ON public.driver_documents;
CREATE POLICY "driver_documents: admin sees all"
  ON public.driver_documents FOR SELECT
  USING (public.is_admin_secure());

DROP POLICY IF EXISTS "driver_documents: admin updates" ON public.driver_documents;
CREATE POLICY "driver_documents: admin updates"
  ON public.driver_documents FOR UPDATE
  USING (public.is_admin_secure());

-- 3. Garantir que admins podem ler perfis de utilizadores (necessário para o CRM)
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.is_admin_secure());

-- 4. RPC para Aprovação Atómica de Motorista
-- Esta função faz 3 coisas: aprova o doc, promove a driver, e limpa suspensões
CREATE OR REPLACE FUNCTION public.approve_driver_document(p_doc_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id UUID;
BEGIN
  -- 1. Verificar se quem chama é admin
  IF NOT public.is_admin_secure() THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Acesso negado: apenas admins podem aprovar documentos.');
  END IF;

  -- 2. Obter o driver_id associado ao documento
  SELECT driver_id INTO v_driver_id
  FROM public.driver_documents
  WHERE id = p_doc_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Documento não encontrado.');
  END IF;

  -- 3. Actualizar o estado do documento
  UPDATE public.driver_documents
  SET status = 'approved', updated_at = NOW()
  WHERE id = p_doc_id;

  -- 4. Promover o utilizador a motorista na tabela users
  UPDATE public.users
  SET role = 'driver', updated_at = NOW(), suspended_until = NULL
  WHERE id = v_driver_id;

  -- 5. Opcional: Notificação ou log (podia ser adicionado aqui)

  RETURN jsonb_build_object('success', true, 'driver_id', v_driver_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_driver_document(UUID) TO authenticated;

-- 5. Garantir acesso ao Storage Bucket driver_docs para Admins
DROP POLICY IF EXISTS "Admin can view all docs" ON storage.objects;
CREATE POLICY "Admin can view all docs" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'driver_docs' AND public.is_admin_secure());

COMMIT;
