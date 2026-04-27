-- =============================================================================
-- ZENITH RIDE v3.5.4
-- Bucket publico para avatars de perfil
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "public_read_avatars" ON storage.objects;
CREATE POLICY "public_read_avatars"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "authenticated_upload_own_avatar" ON storage.objects;
CREATE POLICY "authenticated_upload_own_avatar"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (
      (string_to_array(name, '/'))[1] = auth.uid()::text
      OR (string_to_array(name, '/'))[2] = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "authenticated_update_own_avatar" ON storage.objects;
CREATE POLICY "authenticated_update_own_avatar"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (
      (string_to_array(name, '/'))[1] = auth.uid()::text
      OR (string_to_array(name, '/'))[2] = auth.uid()::text
    )
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (
      (string_to_array(name, '/'))[1] = auth.uid()::text
      OR (string_to_array(name, '/'))[2] = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "authenticated_delete_own_avatar" ON storage.objects;
CREATE POLICY "authenticated_delete_own_avatar"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (
      (string_to_array(name, '/'))[1] = auth.uid()::text
      OR (string_to_array(name, '/'))[2] = auth.uid()::text
    )
  );
