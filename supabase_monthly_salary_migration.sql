-- =============================================================================
-- NOOR-E-NIKAH MATCHMAKING — MONTHLY SALARY FIELD MIGRATION
-- Project: Noor-E-Nikah Rishta Services
-- Target: Supabase PostgreSQL (`public.profiles`)
-- Version: 1.0 (Safe, Idempotent, Non-Destructive)
--
-- PURPOSE:
-- Adds the optional `monthly_salary` column to `public.profiles` to store
-- candidate monthly income in Indian Rupees (₹).
--
-- SECURITY & INTEGRITY GUARANTEES:
-- 1. Idempotent: Can be executed multiple times safely without error.
-- 2. Non-Destructive: All existing profiles (currently 19) remain 100% intact.
-- 3. Default NULL: All existing profiles automatically receive NULL for monthly_salary.
-- 4. Constraint Enforced: Negative values are strictly prohibited (>= 0).
-- 5. No Sequence Impact: Profile ID allocation, tracker, and rate limiter are untouched.
-- =============================================================================

-- Step 1: Safely add the monthly_salary column to public.profiles if it does not exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'profiles' 
          AND column_name = 'monthly_salary'
    ) THEN
        ALTER TABLE public.profiles 
        ADD COLUMN monthly_salary numeric(12,2) DEFAULT NULL;
    END IF;
END $$;

-- Step 2: Add validation constraint ensuring salary is positive or NULL
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = 'check_monthly_salary_positive'
          AND conrelid = 'public.profiles'::regclass
    ) THEN
        ALTER TABLE public.profiles 
        ADD CONSTRAINT check_monthly_salary_positive 
        CHECK (monthly_salary IS NULL OR monthly_salary >= 0);
    END IF;
END $$;

-- Step 3: Add documentation comment on the new column
COMMENT ON COLUMN public.profiles.monthly_salary IS 'Candidate monthly salary or earnings in Indian Rupees (₹). Optional field. Stored as numeric(12,2).';

-- =============================================================================
-- POST-MIGRATION VERIFICATION QUERIES
-- Run these queries after applying the migration to verify success.
-- =============================================================================

-- 1. Verify column exists with correct data type
SELECT 
    column_name, 
    data_type, 
    numeric_precision, 
    numeric_scale, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'profiles' 
  AND column_name = 'monthly_salary';

-- 2. Verify all existing profiles preserved with NULL monthly_salary
SELECT 
    count(*) AS total_profiles,
    count(monthly_salary) AS profiles_with_salary,
    count(*) - count(monthly_salary) AS profiles_with_null_salary
FROM public.profiles;

-- =============================================================================
-- ROLLBACK / DOWNGRADE SCRIPT (EXECUTE ONLY IF REVERSING THIS MIGRATION)
-- =============================================================================
-- ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS check_monthly_salary_positive;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS monthly_salary;
