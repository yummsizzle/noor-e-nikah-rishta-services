-- =============================================================================
-- NOOR-E-NIKAH MATCHMAKING — SAFE ADDITIVE DATABASE SCHEMA MIGRATION
-- Project: Noor-E-Nikah Rishta Services
-- Target Database: Supabase PostgreSQL (`public.profiles` table)
-- 
-- DESCRIPTION:
-- This migration synchronizes the database schema with the customer registration
-- form and the Admin Dashboard profile view.
--
-- SAFETY GUARANTEES:
-- 1. 100% Non-destructive: Uses `ADD COLUMN IF NOT EXISTS`.
-- 2. Fully Nullable: All new columns are nullable (`text`), so all existing
--    customer records remain completely valid, untouched, and uncorrupted.
-- 3. Zero Downtime: Running this script causes zero downtime and requires no locks.
--
-- HOW TO RUN:
-- 1. Open your Supabase Dashboard: https://supabase.com/dashboard/project/xaemytjqdjsqhjclgtgi
-- 2. Go to the "SQL Editor" in the left sidebar.
-- 3. Paste the contents of this file and click "Run".
-- =============================================================================

-- 1. Candidate's Family Surname / Biradari / Community
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS surname_biradari text;

-- 2. Candidate's Islamic Sect / Firqah (e.g. Sunni, Shia)
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS sect_firqah text;

-- 3. Candidate / Guardian Contact Email Address
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS email text;

-- Add documentation comments on table columns
COMMENT ON COLUMN public.profiles.surname_biradari IS 'Candidate family surname / biradari / community (e.g. Shaikh, Khan, Memon, Ansari)';
COMMENT ON COLUMN public.profiles.sect_firqah IS 'Candidate Islamic sect / firqah (e.g. Sunni, Shia)';
COMMENT ON COLUMN public.profiles.email IS 'Candidate or guardian contact email address';

-- Verification query: inspect the columns in public.profiles
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'profiles' 
  AND column_name IN ('surname_biradari', 'sect_firqah', 'email')
ORDER BY column_name;
