-- =====================================================================
-- Limpeza de Logs do Sentinel (Nível Enterprise)
-- Apaga todos os registos do ai_event_logs mais velhos que 30 dias.
-- =====================================================================

-- 1. Criação de Função RPC para limpeza manual ou por Cron Externo
CREATE OR REPLACE FUNCTION purge_old_ai_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM public.ai_event_logs
    WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$;

-- 2. Tentativa de Activar pg_cron (SÓ FUNCIONA EM PLANOS PRO/ENTERPRISE)
-- Se falhar no teu plano Free, ignora o bloco abaixo. Usa o webhook cron do Github Actions para chamar a rpc 'purge_old_ai_logs'.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
    ) THEN
        PERFORM cron.schedule('purge_ai_logs_daily', '0 0 * * *', 'SELECT purge_old_ai_logs();');
    END IF;
END $$;
