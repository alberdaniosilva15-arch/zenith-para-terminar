-- Migration: Enable Realtime on rides, driver_locations and ride_messages tables
-- Critical fix for passenger stuck on 'searching' when driver accepts ride

DO $$
BEGIN
  -- 1. Ensure REPLICA IDENTITY FULL for complete payload delivery on updates
  ALTER TABLE public.rides REPLICA IDENTITY FULL;
  ALTER TABLE public.driver_locations REPLICA IDENTITY FULL;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ride_messages') THEN
    ALTER TABLE public.ride_messages REPLICA IDENTITY FULL;
  END IF;

  -- 2. Add public.rides to supabase_realtime publication
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rides'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rides;
    RAISE NOTICE 'Added public.rides to supabase_realtime';
  ELSE
    RAISE NOTICE 'public.rides already in supabase_realtime';
  END IF;

  -- 3. Add public.driver_locations to supabase_realtime publication
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'driver_locations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_locations;
    RAISE NOTICE 'Added public.driver_locations to supabase_realtime';
  ELSE
    RAISE NOTICE 'public.driver_locations already in supabase_realtime';
  END IF;

  -- 4. Add public.ride_messages to supabase_realtime publication
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ride_messages') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ride_messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_messages;
      RAISE NOTICE 'Added public.ride_messages to supabase_realtime';
    ELSE
      RAISE NOTICE 'public.ride_messages already in supabase_realtime';
    END IF;
  END IF;
END $$;
