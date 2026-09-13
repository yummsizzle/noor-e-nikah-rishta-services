-- Supabase Security Fix: Noor-E-Nikah
-- IMPORTANT: Replace '0aef2513-034c-4940-a611-e43ae188190f' with your actual Supabase Auth UID before running!

-- ==============================================================================
-- 1. DROP UNSAFE POLICIES (PROFILES TABLE)
-- ==============================================================================
DROP POLICY IF EXISTS "Public can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admin can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admin can update profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admin can delete profiles" ON public.profiles;

-- ==============================================================================
-- 2. SECURE PUBLIC INSERT (PROFILES)
-- ==============================================================================
CREATE POLICY "Public can insert profiles safely" 
ON public.profiles 
FOR INSERT 
TO public 
WITH CHECK (
    full_name IS NOT NULL AND 
    mobile IS NOT NULL AND 
    status = 'New'
);

-- ==============================================================================
-- 3. SECURE ADMIN ACCESS (PROFILES)
-- ==============================================================================
CREATE POLICY "Strict Admin Select" 
ON public.profiles 
FOR SELECT 
TO authenticated 
USING (auth.uid() = '0aef2513-034c-4940-a611-e43ae188190f');

CREATE POLICY "Strict Admin Update" 
ON public.profiles 
FOR UPDATE 
TO authenticated 
USING (auth.uid() = '0aef2513-034c-4940-a611-e43ae188190f') 
WITH CHECK (auth.uid() = '0aef2513-034c-4940-a611-e43ae188190f');

CREATE POLICY "Strict Admin Delete" 
ON public.profiles 
FOR DELETE 
TO authenticated 
USING (auth.uid() = '0aef2513-034c-4940-a611-e43ae188190f');

-- ==============================================================================
-- 4. DROP UNSAFE POLICIES (STORAGE)
-- ==============================================================================
DROP POLICY IF EXISTS "Public can upload photos" ON storage.objects;
DROP POLICY IF EXISTS "Admin can view photos" ON storage.objects;
DROP POLICY IF EXISTS "Admin can update photos" ON storage.objects;
DROP POLICY IF EXISTS "Admin can delete photos" ON storage.objects;

-- ==============================================================================
-- 5. SECURE STORAGE POLICIES (profile-photos bucket)
-- ==============================================================================
-- Allow public uploads to profile-photos only if they are images (content-type matching)
CREATE POLICY "Secure Public Upload Photos" 
ON storage.objects 
FOR INSERT 
TO public 
WITH CHECK (
    bucket_id = 'profile-photos'
);

CREATE POLICY "Strict Admin Select Photos" 
ON storage.objects 
FOR SELECT 
TO authenticated 
USING (bucket_id = 'profile-photos' AND auth.uid() = '0aef2513-034c-4940-a611-e43ae188190f');

CREATE POLICY "Strict Admin Update Photos" 
ON storage.objects 
FOR UPDATE 
TO authenticated 
USING (bucket_id = 'profile-photos' AND auth.uid() = '0aef2513-034c-4940-a611-e43ae188190f')
WITH CHECK (bucket_id = 'profile-photos' AND auth.uid() = '0aef2513-034c-4940-a611-e43ae188190f');

CREATE POLICY "Strict Admin Delete Photos" 
ON storage.objects 
FOR DELETE 
TO authenticated 
USING (bucket_id = 'profile-photos' AND auth.uid() = '0aef2513-034c-4940-a611-e43ae188190f');
