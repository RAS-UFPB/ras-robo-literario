-- Supabase SQL Editor: somente se o banco ainda não tiver o campo PDF.
-- No schema informado, pdf_path e o bucket contos-pdf JÁ EXISTEM.
-- Não execute scripts de DROP/TRUNCATE nem recrie o bucket.
ALTER TABLE public.contos ADD COLUMN IF NOT EXISTS pdf_path text;

-- Confira se o bucket já existente está realmente privado:
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets WHERE id = 'contos-pdf';

-- SE o campo public aparecer como true, execute separadamente:
-- UPDATE storage.buckets SET public = false WHERE id = 'contos-pdf';
-- A SERVICE_ROLE_KEY é utilizada apenas no backend; não é preciso
-- permitir INSERT/SELECT/DELETE públicos em storage.objects.
