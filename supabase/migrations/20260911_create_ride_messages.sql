-- Migration: Create ride_messages table and RLS policies
-- Required for in-app chat between passenger and driver during active rides

CREATE TABLE IF NOT EXISTS public.ride_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast retrieval by ride and ordering by time
CREATE INDEX IF NOT EXISTS idx_ride_messages_ride_id ON public.ride_messages(ride_id);
CREATE INDEX IF NOT EXISTS idx_ride_messages_created_at ON public.ride_messages(created_at);

-- Set replica identity to full so Realtime inserts/updates broadcast complete row
ALTER TABLE public.ride_messages REPLICA IDENTITY FULL;

-- Enable Row Level Security
ALTER TABLE public.ride_messages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Participants can view ride messages" ON public.ride_messages;
DROP POLICY IF EXISTS "Participants can send ride messages" ON public.ride_messages;

-- RLS: Only passenger or driver of the ride can read messages
CREATE POLICY "Participants can view ride messages"
  ON public.ride_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_messages.ride_id
        AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid())
    )
  );

-- RLS: Only passenger or driver of the ride can send messages
CREATE POLICY "Participants can send ride messages"
  ON public.ride_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_messages.ride_id
        AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid())
    )
  );
