-- Índice parcial composto para a query mais frequente
CREATE INDEX IF NOT EXISTS idx_rides_searching
ON public.rides(status, created_at DESC)
WHERE status = 'searching' AND driver_id IS NULL;

-- Índice para queries de histórico por utilizador
CREATE INDEX IF NOT EXISTS idx_rides_passenger_created
ON public.rides(passenger_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rides_driver_created
ON public.rides(driver_id, created_at DESC);

-- Índice para driver_locations (queries geoespaciais)
CREATE INDEX IF NOT EXISTS idx_driver_locations_status_avail
ON public.driver_locations(status)
WHERE status = 'available';

-- Se tiveres pg_cron activo no teu projecto Supabase, isto cria os jobs de TTL.
-- (Esta execução falhará silenciosamente no deployment se pg_cron não estiver activo)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'cleanup-stale-drivers',
      '*/5 * * * *',
      $cron$
        UPDATE public.driver_locations
        SET status = 'offline'
        WHERE status = 'available'
          AND updated_at < NOW() - INTERVAL '10 minutes';
      $cron$
    );

    PERFORM cron.schedule(
      'cleanup-stale-rides',
      '*/3 * * * *',
      $cron$
        UPDATE public.rides
        SET status = 'cancelled',
            cancel_reason = 'timeout_no_driver'
        WHERE status = 'searching'
          AND created_at < NOW() - INTERVAL '15 minutes';
      $cron$
    );
  END IF;
END $$;
