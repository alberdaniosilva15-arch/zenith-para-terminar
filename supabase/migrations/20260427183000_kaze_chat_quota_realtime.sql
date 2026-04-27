BEGIN;

CREATE TABLE IF NOT EXISTS public.kaze_chat_quota_live (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  chat_quota INTEGER NOT NULL DEFAULT 10,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.kaze_chat_quota_live ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kaze_chat_quota_live own read" ON public.kaze_chat_quota_live;
CREATE POLICY "kaze_chat_quota_live own read"
  ON public.kaze_chat_quota_live FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin_secure());

DROP POLICY IF EXISTS "kaze_chat_quota_live service manage" ON public.kaze_chat_quota_live;
CREATE POLICY "kaze_chat_quota_live service manage"
  ON public.kaze_chat_quota_live FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.sync_kaze_chat_quota_live()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.kaze_chat_quota_live (user_id, chat_quota, updated_at)
  VALUES (NEW.user_id, COALESCE(NEW.chat_quota, 10), NOW())
  ON CONFLICT (user_id) DO UPDATE
  SET
    chat_quota = EXCLUDED.chat_quota,
    updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_kaze_chat_quota_live ON public.profiles;
CREATE TRIGGER trg_sync_kaze_chat_quota_live
AFTER INSERT OR UPDATE OF chat_quota ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_kaze_chat_quota_live();

INSERT INTO public.kaze_chat_quota_live (user_id, chat_quota, updated_at)
SELECT
  p.user_id,
  COALESCE(p.chat_quota, 10),
  NOW()
FROM public.profiles p
WHERE p.user_id IS NOT NULL
ON CONFLICT (user_id) DO UPDATE
SET
  chat_quota = EXCLUDED.chat_quota,
  updated_at = EXCLUDED.updated_at;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'kaze_chat_quota_live'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.kaze_chat_quota_live;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
