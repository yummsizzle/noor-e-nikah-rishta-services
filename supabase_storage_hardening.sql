-- Supabase Storage Hardening
-- Enforce a 5 MB maximum file size limit and restrict allowed MIME types for the "profile-photos" bucket.

-- 1. Update bucket configuration to enforce size limit and allowed MIME types at the storage level
UPDATE storage.buckets
SET file_size_limit = 5242880, -- 5 MB in bytes
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/jpg']
WHERE id = 'profile-photos';

-- 2. Drop the overly permissive public upload policy
DROP POLICY IF EXISTS "Secure Public Upload Photos" ON storage.objects;

-- 3. Re-create the upload policy with strict extension validation as an additional RLS safeguard
CREATE POLICY "Secure Public Upload Photos" 
ON storage.objects 
FOR INSERT 
TO public 
WITH CHECK (
    bucket_id = 'profile-photos' AND 
    (storage.extension(name) = 'jpg' OR storage.extension(name) = 'jpeg' OR storage.extension(name) = 'png')
);
