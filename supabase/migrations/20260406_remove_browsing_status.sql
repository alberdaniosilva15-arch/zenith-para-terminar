-- Limpar corridas com status 'browsing' que ficaram penduradas
DELETE FROM public.rides
WHERE status = 'browsing';

-- Remover 'browsing' do enum 
-- A forma mais segura no PostgreSQL sem downtime
ALTER TYPE public.ride_status RENAME TO ride_status_old;

CREATE TYPE public.ride_status AS ENUM (
  'searching',
  'accepted',
  'picking_up',
  'in_progress',
  'completed',
  'cancelled'
);

ALTER TABLE public.rides 
  ALTER COLUMN status TYPE public.ride_status 
  USING status::text::public.ride_status;

DROP TYPE public.ride_status_old;
