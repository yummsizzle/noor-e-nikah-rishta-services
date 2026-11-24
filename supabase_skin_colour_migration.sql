-- =============================================================================
-- NOOR-E-NIKAH MATCHMAKING — SKIN COLOUR COLUMN MIGRATION
-- Project: Noor-E-Nikah Rishta Services
-- Workspace: D:\NOOR-E-NIKAH
-- Target: Supabase PostgreSQL (`public.profiles`)
--
-- DESCRIPTION:
-- 1. Adds the new optional `skin_colour` text column to `public.profiles`.
-- 2. Restricts values to ('Fair', 'Wheatish', 'Brown') or NULL via check constraint.
-- 3. Preserves all existing customer records, Profile IDs, data types, and values.
-- 4. Existing profiles remain completely valid with NULL skin_colour.
-- 5. Safe, idempotent, non-destructive, transaction-wrapped.
--
-- STRICT DIRECTIVE:
-- DO NOT EXECUTE ON PRODUCTION DATABASE WITHOUT EXPLICIT USER APPROVAL.
-- =============================================================================

BEGIN;

-- Step 1: Add skin_colour column if it does not already exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND column_name = 'skin_colour'
    ) THEN
        ALTER TABLE public.profiles ADD COLUMN skin_colour text DEFAULT NULL;
    END IF;
END $$;

-- Step 2: Add check constraint for valid skin_colour options (Fair, Wheatish, Brown, or NULL)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.profiles'::regclass
          AND conname = 'check_skin_colour_valid'
    ) THEN
        ALTER TABLE public.profiles
            ADD CONSTRAINT check_skin_colour_valid
            CHECK (skin_colour IS NULL OR skin_colour IN ('Fair', 'Wheatish', 'Brown'));
    END IF;
END $$;

-- Step 3: Add descriptive column comment for documentation
COMMENT ON COLUMN public.profiles.skin_colour IS 'Skin colour of candidate: Fair, Wheatish, Brown (optional)';

COMMIT;
