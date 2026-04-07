-- ════════════════════════════════════════════════════════════════════
-- ZENITH RIDE — Migration 2.9+2.10+2.11+2.12 combinados
-- ════════════════════════════════════════════════════════════════════

-- 2.9 — RLS para driver_bids
ALTER TABLE public.driver_bids ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'driver_bids' AND policyname = 'drivers_own_bids_only') THEN
    CREATE POLICY "drivers_own_bids_only"
    ON public.driver_bids FOR INSERT
    WITH CHECK (driver_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'driver_bids' AND policyname = 'drivers_read_own_bids') THEN
    CREATE POLICY "drivers_read_own_bids"
    ON public.driver_bids FOR SELECT
    USING (driver_id = auth.uid());
  END IF;
END $$;

-- 2.10 — Campo audio_url em posts + índices de performance
ALTER TABLE public.posts
ADD COLUMN IF NOT EXISTS audio_url TEXT;

CREATE INDEX IF NOT EXISTS idx_rides_searching
ON public.rides(status, created_at DESC)
WHERE status = 'searching' AND driver_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_rides_passenger
ON public.rides(passenger_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rides_driver
ON public.rides(driver_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_posts_created_at
ON public.posts(created_at DESC);

-- 2.12 — Storage bucket para mensagens de voz
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'voice-messages', 'voice-messages', true, 5242880,
  ARRAY['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav']
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'authenticated_upload_voice') THEN
    CREATE POLICY "authenticated_upload_voice"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'voice-messages');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'public_read_voice') THEN
    CREATE POLICY "public_read_voice"
    ON storage.objects FOR SELECT TO public
    USING (bucket_id = 'voice-messages');
  END IF;
END $$;
