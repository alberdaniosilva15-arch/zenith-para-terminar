-- =============================================================================
-- SCRIPT DE LIMPEZA — ZENITH RIDE V3
-- Este script apaga APENAS as tabelas do Kubata.
-- Todo o resto do teu Supabase (Zenith, N8N, Gestor, FG, Clínica, etc.)
-- ficará 100% intocado.
-- =============================================================================

DO $$ 
BEGIN
  -- Apagar APENAS as tabelas do Kubata
  DROP TABLE IF EXISTS public.kubata_clientes CASCADE;
  DROP TABLE IF EXISTS public.kubata_fiado CASCADE;
  DROP TABLE IF EXISTS public.kubata_referencias CASCADE;
  DROP TABLE IF EXISTS public.kubata_stock CASCADE;
  
  -- Nenhuma outra tabela será tocada.
END $$;
