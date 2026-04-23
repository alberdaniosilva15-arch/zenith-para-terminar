-- =============================================================================
-- ZENITH RIDE - driver_documents private BI storage path
-- Date: 2026-04-20
--
-- Goal:
-- 1) Keep driver_docs bucket private.
-- 2) Persist object path instead of public URL.
-- =============================================================================

ALTER TABLE public.driver_documents
  ADD COLUMN IF NOT EXISTS bi_storage_path TEXT;

COMMENT ON COLUMN public.driver_documents.bi_storage_path
  IS 'Storage object path in bucket driver_docs. Use signed URLs for access.';
