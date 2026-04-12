-- =============================================================================
-- ZENITH RIDE — FASE 0: SEGURANÇA (BLOQUEANTE)
-- Instruções: Executar no SQL Editor do Supabase
-- =============================================================================

-- 0.1 — RPC is_admin_secure (PostgreSQL)
-- Corrigido: Removido is_active para compatibilidade com o schema actual
CREATE OR REPLACE FUNCTION public.is_admin_secure()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
    AND role = 'admin'
  );
END;
$$;

-- 0.3 — Rastreio Parental Real (RLS + Coluna)
-- Adicionar colunas necessárias se ainda não existirem
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS public_token UUID DEFAULT gen_random_uuid();
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS student_name TEXT;

-- Criar política de leitura pública baseada no token da sessão
DROP POLICY IF EXISTS "rides_public_tracking" ON public.rides;
CREATE POLICY "rides_public_tracking" ON public.rides
FOR SELECT USING (
  public_token IS NOT NULL
  AND public_token = (
    SELECT s.public_token 
    FROM public.school_tracking_sessions s 
    WHERE s.ride_id = public.rides.id
    AND s.expires_at > NOW()
    LIMIT 1
  )
);

-- Garantir que a tabela rides tem RLS activo
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;
