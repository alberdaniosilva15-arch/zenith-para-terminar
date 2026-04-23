-- Adicionar coluna expires_at para auto-destruição
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Definir a regra padrão baseada em 24h para posts existentes
UPDATE public.posts SET expires_at = created_at + interval '24 hours' WHERE expires_at IS NULL;

-- Criar a função RPC de limpeza com SECURITY DEFINER (ignora RLS durante a execução)
CREATE OR REPLACE FUNCTION public.cleanup_expired_posts()
RETURNS void AS $$
BEGIN
  DELETE FROM public.posts WHERE expires_at < now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
