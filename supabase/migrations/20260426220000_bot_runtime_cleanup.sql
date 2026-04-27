DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'rate_limit_log'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_rate_limit_user_date ON public.rate_limit_log(user_id, created_at DESC)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cleanup_bot_runtime_tables()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'message_dedup'
  ) THEN
    DELETE FROM public.message_dedup
    WHERE created_at < NOW() - INTERVAL '7 days';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'rate_limit_log'
  ) THEN
    DELETE FROM public.rate_limit_log
    WHERE created_at < NOW() - INTERVAL '1 day';
  END IF;
END;
$$;

SELECT public.cleanup_bot_runtime_tables();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.schedule(
        'cleanup-bot-runtime-tables',
        '15 * * * *',
        $cron$SELECT public.cleanup_bot_runtime_tables();$cron$
      );
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;
  END IF;
END $$;
