-- Migração para Documentos Sensíveis e Carro do Motorista

-- 1. Tabela
CREATE TABLE IF NOT EXISTS public.driver_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  car_brand    TEXT NOT NULL,
  car_model    TEXT NOT NULL,
  car_plate    TEXT NOT NULL,
  car_color    TEXT NOT NULL,
  bi_image_url TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. RLS da Tabela
ALTER TABLE public.driver_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "driver_documents: driver manages own" ON public.driver_documents;
CREATE POLICY "driver_documents: driver manages own"
  ON public.driver_documents FOR ALL
  USING (auth.uid() = driver_id)
  WITH CHECK (auth.uid() = driver_id);

DROP POLICY IF EXISTS "driver_documents: admin sees all" ON public.driver_documents;
CREATE POLICY "driver_documents: admin sees all"
  ON public.driver_documents FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "driver_documents: admin updates" ON public.driver_documents;
CREATE POLICY "driver_documents: admin updates"
  ON public.driver_documents FOR UPDATE
  USING (public.is_admin());

-- 3. Storage Bucket
INSERT INTO storage.buckets (id, name, public) 
VALUES ('driver_docs', 'driver_docs', false)
ON CONFLICT (id) DO NOTHING;

-- 4. Storage RLS Policies
DROP POLICY IF EXISTS "Driver can insert own docs" ON storage.objects;
CREATE POLICY "Driver can insert own docs" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'driver_docs' AND auth.uid()::text = (string_to_array(name, '/'))[1]);

DROP POLICY IF EXISTS "Driver can view own docs" ON storage.objects;
CREATE POLICY "Driver can view own docs" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'driver_docs' AND auth.uid()::text = (string_to_array(name, '/'))[1]);

DROP POLICY IF EXISTS "Admin can view all docs" ON storage.objects;
CREATE POLICY "Admin can view all docs" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'driver_docs' AND public.is_admin());
