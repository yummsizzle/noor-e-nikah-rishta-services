-- =============================================================================
-- NOOR-E-NIKAH MATCHMAKING — SALARY COLUMN RENAME & STATE MIGRATION
-- Project: Noor-E-Nikah Rishta Services
-- Target: Supabase PostgreSQL (`public.profiles`)
--
-- DESCRIPTION:
-- 1. Renames existing column `monthly_salary` to `salary` in `public.profiles`.
--    (No duplicate column created, no data copied; direct column rename).
-- 2. Renames check constraint `check_monthly_salary_positive` to `check_salary_positive`.
-- 3. Adds the new optional `state` text column.
-- 4. Preserves all 33 existing customer records, Profile IDs, data types, and values.
-- =============================================================================

BEGIN;

-- Step 1: Rename monthly_salary to salary (Direct Column Rename)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'profiles' 
          AND column_name = 'monthly_salary'
    ) THEN
        ALTER TABLE public.profiles RENAME COLUMN monthly_salary TO salary;
    END IF;
END $$;

-- Step 2: Rename check constraint to match the new column name
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conrelid = 'public.profiles'::regclass 
          AND conname = 'check_monthly_salary_positive'
    ) THEN
        ALTER TABLE public.profiles 
            RENAME CONSTRAINT check_monthly_salary_positive TO check_salary_positive;
    ELSIF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conrelid = 'public.profiles'::regclass 
          AND conname = 'check_salary_positive'
    ) THEN
        ALTER TABLE public.profiles 
            ADD CONSTRAINT check_salary_positive 
            CHECK (salary IS NULL OR salary >= 0);
    END IF;
END $$;

-- Step 3: Add new optional state column
ALTER TABLE public.profiles 
    ADD COLUMN IF NOT EXISTS state text DEFAULT NULL;

-- Step 4: Descriptive Comments
COMMENT ON COLUMN public.profiles.salary IS 'Candidate salary or earnings in Indian Rupees (₹). Optional field. Stored as numeric(12,2).';
COMMENT ON COLUMN public.profiles.state IS 'Candidate state of residence';

COMMIT;

-- =============================================================================
-- VERIFICATION QUERIES
-- =============================================================================
-- 1. Verify salary and state columns exist, and monthly_salary no longer exists
SELECT column_name, data_type, is_nullable, numeric_precision, numeric_scale
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'profiles' 
  AND column_name IN ('salary', 'monthly_salary', 'state')
ORDER BY column_name;

-- 2. Verify check constraint is active on salary
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint 
WHERE conrelid = 'public.profiles'::regclass 
  AND conname = 'check_salary_positive';

-- 3. Verify all 33 profiles preserved
SELECT 
    count(*) AS total_profiles,
    count(salary) AS profiles_with_salary,
    count(state) AS profiles_with_state
FROM public.profiles;
