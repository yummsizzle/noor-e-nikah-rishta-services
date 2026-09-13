-- Supabase Schema & RLS Policies for Noor-E-Nikah

-- 1. Create the profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id text, -- e.g., NN-2026-1234
    
    -- Basic info
    registering_for text,
    full_name text NOT NULL,
    gender text,
    date_of_birth text,
    age integer,
    marital_status text,
    height text,
    
    -- Professional
    education text,
    occupation text,
    city text,
    mother_tongue text,
    languages_known text,
    
    -- Family & Religious
    father_occupation text,
    mother_occupation text,
    brothers integer,
    sisters integer,
    family_location text,
    family_type text,
    maslak text,
    maslak_preference text,
    religious_preference_details text,
    
    -- About & Preferences
    about_candidate text,
    preferred_age_range text,
    preferred_location text,
    preferred_education text,
    preferred_profession text,
    other_preferences text,
    
    -- Contact
    guardian_name text,
    relationship text,
    mobile text NOT NULL,
    whatsapp text,
    preferred_contact_time text,
    
    -- System / Workflow
    photo_attached text,
    photo_url text,
    status text DEFAULT 'New',
    notes jsonb DEFAULT '[]'::jsonb,
    
    -- Follow-up & Timestamps
    follow_up_date text,
    follow_up_note text,
    follow_up_time text,
    contacted_at timestamptz,
    closed_at timestamptz,
    
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 2. Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies for public.profiles
-- Public can INSERT a new profile
CREATE POLICY "Public can insert profiles"
ON public.profiles
FOR INSERT
TO public
WITH CHECK (true);

-- Admin can SELECT all profiles
CREATE POLICY "Admin can view profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);

-- Admin can UPDATE all profiles
CREATE POLICY "Admin can update profiles"
ON public.profiles
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Admin can DELETE profiles
CREATE POLICY "Admin can delete profiles"
ON public.profiles
FOR DELETE
TO authenticated
USING (true);

-- 4. Storage Bucket for Profile Photos
INSERT INTO storage.buckets (id, name, public) VALUES ('profile-photos', 'profile-photos', false)
ON CONFLICT (id) DO NOTHING;

-- 5. Storage RLS Policies
-- Public can upload photos to the bucket
CREATE POLICY "Public can upload photos"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (bucket_id = 'profile-photos');

-- Admin can view photos
CREATE POLICY "Admin can view photos"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'profile-photos');

-- Admin can delete photos
CREATE POLICY "Admin can delete photos"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'profile-photos');

-- Admin can update photos (if needed)
CREATE POLICY "Admin can update photos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'profile-photos')
WITH CHECK (bucket_id = 'profile-photos');
