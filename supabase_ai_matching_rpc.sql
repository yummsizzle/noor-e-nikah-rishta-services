-- ============================================================================
-- Noor-E-Nikah: Complete AI Matching Engine & Pair Management Database Migration
-- Target: Supabase / PostgreSQL 17
-- 
-- IMPORTANT SAFETY NOTICE:
-- This script is prepared for LOCAL DEVELOPMENT, TESTING AND OWNER REVIEW ONLY.
-- DO NOT EXECUTE ON PRODUCTION SUPABASE WITHOUT EXPLICIT WRITTEN OWNER APPROVAL.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PROPOSED PERFORMANCE INDEXES
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_profiles_matching_core 
ON public.profiles (gender, maslak, date_of_birth);

CREATE INDEX IF NOT EXISTS idx_profiles_dob_btree 
ON public.profiles (date_of_birth);

CREATE INDEX IF NOT EXISTS idx_profiles_status_btree 
ON public.profiles (status);

-- Ensure profile_id has a unique constraint or unique index before foreign key referencing.
-- Idempotent check: Detect any existing UNIQUE constraint or UNIQUE index on public.profiles(profile_id)
-- so we never create a redundant or duplicate constraint or index.
DO $$
DECLARE
    v_has_unique boolean := false;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
        WHERE c.conrelid = 'public.profiles'::regclass
          AND c.contype IN ('u', 'p')
          AND a.attname = 'profile_id'
          AND array_length(c.conkey, 1) = 1
    ) OR EXISTS (
        SELECT 1
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indrelid
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
        WHERE c.oid = 'public.profiles'::regclass
          AND i.indisunique = true
          AND a.attname = 'profile_id'
          AND i.indnatts = 1
    ) INTO v_has_unique;

    IF NOT v_has_unique THEN
        ALTER TABLE public.profiles ADD CONSTRAINT uq_profiles_profile_id UNIQUE (profile_id);
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        NULL;
END;
$$;

-- Helper: Safe date casting (Prevents fatal error if text date is malformed or out of range)
CREATE OR REPLACE FUNCTION public.safe_cast_to_date(p_str text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF p_str IS NULL OR p_str !~ '^\d{4}-\d{2}-\d{2}$' THEN
        RETURN NULL;
    END IF;
    RETURN p_str::date;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. DEDICATED RELATIONSHIP TABLES FOR PAIR MANAGEMENT
-- ----------------------------------------------------------------------------

-- Table A: Potential Shortlisted Pairs
-- Stores potential Bride-Groom combinations under Admin consideration.
-- Deleting or updating a shortlist NEVER modifies or deletes customer profiles.
CREATE TABLE IF NOT EXISTS public.match_shortlists (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bride_profile_id text NOT NULL REFERENCES public.profiles(profile_id) ON DELETE RESTRICT,
    groom_profile_id text NOT NULL REFERENCES public.profiles(profile_id) ON DELETE RESTRICT,
    stage text NOT NULL DEFAULT 'Shortlisted' CHECK (stage IN ('Shortlisted', 'Follow-up', 'Closed')),
    admin_notes text DEFAULT '',
    created_by uuid,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT uq_shortlist_pair UNIQUE (bride_profile_id, groom_profile_id)
);

-- Table B: Final Confirmed Pairs (One Bride = One Groom)
-- Stores explicitly confirmed matrimonial pairs.
-- Deleting, unpairing, or releasing a pair NEVER modifies or deletes customer profiles.
CREATE TABLE IF NOT EXISTS public.confirmed_pairs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bride_profile_id text NOT NULL REFERENCES public.profiles(profile_id) ON DELETE RESTRICT,
    groom_profile_id text NOT NULL REFERENCES public.profiles(profile_id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Undone', 'Released', 'Archived')),
    admin_notes text DEFAULT '',
    bride_original_status text,
    groom_original_status text,
    confirmed_by uuid,
    confirmed_at timestamptz DEFAULT now(),
    unpaired_by uuid,
    unpaired_at timestamptz,
    unpair_reason text DEFAULT '',
    created_by uuid,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    released_at timestamptz,
    CONSTRAINT uq_confirmed_pair UNIQUE (bride_profile_id, groom_profile_id)
);

-- Strict 1:1 Active Pair Uniqueness
-- A Bride can have at most one ACTIVE confirmed pair.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_bride 
ON public.confirmed_pairs (bride_profile_id) 
WHERE status = 'Active';

-- A Groom can have at most one ACTIVE confirmed pair.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_groom 
ON public.confirmed_pairs (groom_profile_id) 
WHERE status = 'Active';

CREATE INDEX IF NOT EXISTS idx_shortlists_stage ON public.match_shortlists (stage);
CREATE INDEX IF NOT EXISTS idx_confirmed_pairs_status ON public.confirmed_pairs (status);

-- ----------------------------------------------------------------------------
-- 3. HELPER FUNCTION: parse_preferred_age_range (Phase 2 Hardened Semantics)
-- - "20-27" / "20 to 27": inclusive range [20, 27]
-- - "25+": minimum 25 inclusive [25, 99]
-- - "above 25": strictly above 25 [26, 99]
-- - "min 25": minimum 25 inclusive [25, 99]
-- - "below 30": strictly below 30 [18, 29]
-- - "under 30": strictly below 30 [18, 29]
-- - "max 30": maximum 30 inclusive [18, 30]
-- - "25": exact age 25 only [25, 25]
-- - Ambiguous or non-numeric strings return NULL (Needs Review)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.parse_preferred_age_range(p_range text)
RETURNS TABLE (min_age INT, max_age INT)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_clean text;
    v_norm text;
    v_matches text[];
BEGIN
    IF p_range IS NULL OR TRIM(p_range) = '' THEN
        RETURN;
    END IF;

    v_clean := TRIM(p_range);

    -- 1. Remove prefixes like around, approx, about
    v_norm := regexp_replace(v_clean, '\y(around|approx|approximately|about)\y\.?\s*', '', 'gi');
    -- 2. Remove attached suffixes like 25yo, 25yrs, 25yr, 25y
    v_norm := regexp_replace(v_norm, '(\d{1,2})\s*(years?(\s+old)?|yrs?|yr|yo|y)\y', '\1', 'gi');
    -- 3. Remove standalone words like years old, years, yrs, yr, old, age, yo
    v_norm := regexp_replace(v_norm, '\y(years?\s+old|years?|yrs?|yr|yo|old|age)\y', '', 'gi');
    v_norm := TRIM(regexp_replace(v_norm, '\s+', ' ', 'g'));

    -- 1. Inclusive Range: "20 - 27", "20 to 27", "20–27", "20—27"
    v_matches := regexp_match(v_norm, '^(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})$', 'i');
    IF v_matches IS NOT NULL THEN
        min_age := v_matches[1]::int;
        max_age := v_matches[2]::int;
        IF min_age > 0 AND max_age >= min_age THEN
            RETURN NEXT;
            RETURN;
        END IF;
    END IF;

    -- 2. "above 25" or "> 25": Strictly above 25 (min = 26)
    v_matches := regexp_match(v_norm, '^(?:above|>)\s*(\d{1,2})$', 'i');
    IF v_matches IS NOT NULL THEN
        min_age := v_matches[1]::int + 1;
        max_age := 99;
        RETURN NEXT;
        RETURN;
    END IF;

    -- 3. "25+" or ">= 25" or "min 25" or "minimum 25": Minimum 25 inclusive (min = 25)
    v_matches := regexp_match(v_norm, '^(?:min|minimum|>=)\s*(\d{1,2})$', 'i');
    IF v_matches IS NULL THEN
        v_matches := regexp_match(v_norm, '^(\d{1,2})\s*\+$');
    END IF;
    IF v_matches IS NOT NULL THEN
        min_age := v_matches[1]::int;
        max_age := 99;
        RETURN NEXT;
        RETURN;
    END IF;

    -- 4. "below 30" or "under 30" or "< 30": Strictly below 30 (max = 29)
    v_matches := regexp_match(v_norm, '^(?:below|under|<)\s*(\d{1,2})$', 'i');
    IF v_matches IS NOT NULL THEN
        min_age := 18;
        max_age := v_matches[1]::int - 1;
        RETURN NEXT;
        RETURN;
    END IF;

    -- 5. "max 30" or "maximum 30" or "<= 30" or "up to 30": Maximum 30 inclusive (max = 30)
    v_matches := regexp_match(v_norm, '^(?:max|maximum|<=|up to)\s*(\d{1,2})$', 'i');
    IF v_matches IS NOT NULL THEN
        min_age := 18;
        max_age := v_matches[1]::int;
        RETURN NEXT;
        RETURN;
    END IF;

    -- 6. "25": Exact age 25
    v_matches := regexp_match(v_norm, '^(\d{1,2})$');
    IF v_matches IS NOT NULL THEN
        min_age := v_matches[1]::int;
        max_age := v_matches[1]::int;
        RETURN NEXT;
        RETURN;
    END IF;

    -- Malformed or ambiguous strings return nothing (caller receives NULL)
    RETURN;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. HELPER FUNCTION: evaluate_single_age_preference
-- Evaluates candidate age against a preference range with 2-year boundary flexibility.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.evaluate_single_age_preference(INT, text);
CREATE OR REPLACE FUNCTION public.evaluate_single_age_preference(
    p_age INT,
    p_range_text text
)
RETURNS TABLE (
    pref_status text,
    pref_rank int,
    pref_label text
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_min int;
    v_max int;
    v_is_flex_lower boolean;
    v_is_flex_upper boolean;
BEGIN
    SELECT min_age, max_age INTO v_min, v_max 
    FROM public.parse_preferred_age_range(p_range_text);

    IF v_min IS NULL THEN
        pref_status := 'MISSING';
        pref_rank := 5;
        pref_label := 'Preference Missing / Needs Review';
        RETURN NEXT;
        RETURN;
    END IF;

    IF p_age >= v_min AND p_age <= v_max THEN
        pref_status := 'EXACT';
        pref_rank := 1;
        pref_label := 'Exact Preference Match (' || v_min || '-' || v_max || ')';
    ELSE
        -- 2-year flexibility calculation
        v_is_flex_lower := (v_min > 18 AND p_age >= v_min - 2 AND p_age < v_min);
        v_is_flex_upper := (v_max < 99 AND p_age > v_max AND p_age <= v_max + 2);

        IF v_is_flex_lower OR v_is_flex_upper THEN
            pref_status := 'FLEXIBLE';
            pref_rank := 2;
            pref_label := 'Flexible — Within 2 Years (' || v_min || '-' || v_max || ')';
        ELSE
            pref_status := 'OUTSIDE';
            pref_rank := 4;
            pref_label := 'Outside Age Preference (' || v_min || '-' || v_max || ')';
        END IF;
    END IF;

    RETURN NEXT;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. PAIR MANAGEMENT STORED PROCEDURES
-- ----------------------------------------------------------------------------

-- A. Confirm Final Matrimonial Pair (One Bride = One Groom)
CREATE OR REPLACE FUNCTION public.admin_confirm_pair(
    p_bride_id text,
    p_groom_id text,
    p_notes text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    c_admin_uid CONSTANT uuid := '0aef2513-034c-4940-a611-e43ae188190f'::uuid;
    v_caller_uid uuid;
    v_bride record;
    v_groom record;
    v_pair_id uuid;
    v_existing_pair record;
BEGIN
    -- Strict Admin Authentication
    v_caller_uid := auth.uid();
    IF v_caller_uid IS NULL THEN
        RAISE EXCEPTION 'Access denied. Authentication required.' USING ERRCODE = '42501';
    END IF;
    IF v_caller_uid != c_admin_uid THEN
        RAISE EXCEPTION 'Access denied. Administrator privileges required.' USING ERRCODE = '42501';
    END IF;

    -- Validate input IDs
    IF p_bride_id IS NULL OR TRIM(p_bride_id) = '' OR p_groom_id IS NULL OR TRIM(p_groom_id) = '' THEN
        RAISE EXCEPTION 'Both Bride Profile ID and Groom Profile ID are required.';
    END IF;

    -- Load and validate Bride
    SELECT * INTO v_bride FROM public.profiles WHERE profile_id = p_bride_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bride profile not found: %', p_bride_id;
    END IF;
    IF LOWER(TRIM(COALESCE(v_bride.gender, ''))) != 'female' THEN
        RAISE EXCEPTION 'Profile % is not Female (Gender: %)', p_bride_id, v_bride.gender;
    END IF;

    -- Load and validate Groom
    SELECT * INTO v_groom FROM public.profiles WHERE profile_id = p_groom_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Groom profile not found: %', p_groom_id;
    END IF;
    IF LOWER(TRIM(COALESCE(v_groom.gender, ''))) != 'male' THEN
        RAISE EXCEPTION 'Profile % is not Male (Gender: %)', p_groom_id, v_groom.gender;
    END IF;

    -- Check if Bride already has an active confirmed pair
    SELECT * INTO v_existing_pair FROM public.confirmed_pairs 
    WHERE bride_profile_id = p_bride_id AND status = 'Active';
    IF FOUND AND v_existing_pair.groom_profile_id != p_groom_id THEN
        RAISE EXCEPTION 'Bride % already has an active confirmed Groom (%)', p_bride_id, v_existing_pair.groom_profile_id;
    END IF;

    -- Check if Groom already has an active confirmed pair
    SELECT * INTO v_existing_pair FROM public.confirmed_pairs 
    WHERE groom_profile_id = p_groom_id AND status = 'Active';
    IF FOUND AND v_existing_pair.bride_profile_id != p_bride_id THEN
        RAISE EXCEPTION 'Groom % already has an active confirmed Bride (%)', p_groom_id, v_existing_pair.bride_profile_id;
    END IF;

    -- Upsert or reactivate pair record with original status snapshots
    INSERT INTO public.confirmed_pairs (
        bride_profile_id, groom_profile_id, status, admin_notes,
        bride_original_status, groom_original_status,
        confirmed_by, confirmed_at, updated_at
    ) VALUES (
        p_bride_id, p_groom_id, 'Active', COALESCE(p_notes, ''),
        v_bride.status, v_groom.status,
        v_caller_uid, now(), now()
    )
    ON CONFLICT (bride_profile_id, groom_profile_id) 
    DO UPDATE SET 
        status = 'Active', 
        admin_notes = COALESCE(p_notes, public.confirmed_pairs.admin_notes),
        bride_original_status = v_bride.status,
        groom_original_status = v_groom.status,
        confirmed_by = v_caller_uid,
        confirmed_at = now(),
        updated_at = now(),
        unpaired_by = NULL,
        unpaired_at = NULL,
        unpair_reason = NULL,
        released_at = NULL
    RETURNING id INTO v_pair_id;

    RETURN jsonb_build_object(
        'success', true,
        'pair_id', v_pair_id,
        'bride_profile_id', p_bride_id,
        'groom_profile_id', p_groom_id,
        'bride_original_status', v_bride.status,
        'groom_original_status', v_groom.status,
        'status', 'Active',
        'message', 'Matrimonial pair confirmed successfully.'
    );
END;
$$;

-- B. Unpair & Restore Original Status (Primary Undo Operation)
CREATE OR REPLACE FUNCTION public.admin_unpair_and_restore(
    p_pair_id uuid,
    p_reason text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    c_admin_uid CONSTANT uuid := '0aef2513-034c-4940-a611-e43ae188190f'::uuid;
    v_caller_uid uuid;
    v_pair record;
BEGIN
    v_caller_uid := auth.uid();
    IF v_caller_uid IS NULL THEN
        RAISE EXCEPTION 'Access denied. Authentication required.' USING ERRCODE = '42501';
    END IF;
    IF v_caller_uid != c_admin_uid THEN
        RAISE EXCEPTION 'Access denied. Administrator privileges required.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_pair FROM public.confirmed_pairs WHERE id = p_pair_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Confirmed pair record not found: %', p_pair_id;
    END IF;

    -- Transactionally restore profile statuses if snapshot exists
    IF v_pair.bride_original_status IS NOT NULL THEN
        UPDATE public.profiles 
        SET status = v_pair.bride_original_status
        WHERE profile_id = v_pair.bride_profile_id;
    END IF;

    IF v_pair.groom_original_status IS NOT NULL THEN
        UPDATE public.profiles 
        SET status = v_pair.groom_original_status
        WHERE profile_id = v_pair.groom_profile_id;
    END IF;

    -- Update pair status to 'Undone'
    UPDATE public.confirmed_pairs
    SET status = 'Undone',
        unpaired_at = now(),
        unpaired_by = v_caller_uid,
        unpair_reason = COALESCE(p_reason, ''),
        updated_at = now()
    WHERE id = p_pair_id;

    RETURN jsonb_build_object(
        'success', true,
        'pair_id', p_pair_id,
        'bride_profile_id', v_pair.bride_profile_id,
        'bride_restored_status', v_pair.bride_original_status,
        'groom_profile_id', v_pair.groom_profile_id,
        'groom_restored_status', v_pair.groom_original_status,
        'message', 'Pair undone successfully. Both profiles restored to their original statuses.'
    );
END;
$$;

-- B2. Backward Compatible Release Function (Aliases to Unpair)
CREATE OR REPLACE FUNCTION public.admin_release_pair(
    p_pair_id uuid,
    p_notes text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    c_admin_uid CONSTANT uuid := '0aef2513-034c-4940-a611-e43ae188190f'::uuid;
    v_caller_uid uuid;
BEGIN
    v_caller_uid := auth.uid();
    IF v_caller_uid IS NULL THEN
        RAISE EXCEPTION 'Access denied. Authentication required.' 
            USING ERRCODE = '42501';
    END IF;
    IF v_caller_uid != c_admin_uid THEN
        RAISE EXCEPTION 'Access denied. Administrator privileges required.' 
            USING ERRCODE = '42501';
    END IF;

    RETURN public.admin_unpair_and_restore(p_pair_id, p_notes);
END;
$$;

-- B3. Delete Pair History Record (Does NEVER delete customer profiles)
CREATE OR REPLACE FUNCTION public.admin_delete_pair_record(
    p_pair_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    c_admin_uid CONSTANT uuid := '0aef2513-034c-4940-a611-e43ae188190f'::uuid;
    v_caller_uid uuid;
    v_pair record;
BEGIN
    v_caller_uid := auth.uid();
    IF v_caller_uid IS NULL THEN
        RAISE EXCEPTION 'Access denied. Authentication required.' USING ERRCODE = '42501';
    END IF;
    IF v_caller_uid != c_admin_uid THEN
        RAISE EXCEPTION 'Access denied. Administrator privileges required.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_pair FROM public.confirmed_pairs WHERE id = p_pair_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pair record not found: %', p_pair_id;
    END IF;

    IF v_pair.status = 'Active' THEN
        RAISE EXCEPTION 'Cannot delete an active confirmed pair. Unpair and restore first.';
    END IF;

    DELETE FROM public.confirmed_pairs WHERE id = p_pair_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Pair history record deleted permanently. Customer profiles remain untouched.'
    );
END;
$$;

-- C. Archive / Delete Confirmed Pair Record
CREATE OR REPLACE FUNCTION public.admin_archive_pair(
    p_pair_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    c_admin_uid CONSTANT uuid := '0aef2513-034c-4940-a611-e43ae188190f'::uuid;
    v_caller_uid uuid;
    v_pair record;
BEGIN
    v_caller_uid := auth.uid();
    IF v_caller_uid IS NULL THEN
        RAISE EXCEPTION 'Access denied. Authentication required.' USING ERRCODE = '42501';
    END IF;
    IF v_caller_uid != c_admin_uid THEN
        RAISE EXCEPTION 'Access denied. Administrator privileges required.' USING ERRCODE = '42501';
    END IF;

    -- Load and validate pair record
    SELECT * INTO v_pair
    FROM public.confirmed_pairs
    WHERE id = p_pair_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Confirmed pair record not found: %', p_pair_id;
    END IF;

    -- Prevent direct archiving of Active pairs (must be unpaused/released first to restore customer profiles)
    IF v_pair.status = 'Active' THEN
        RAISE EXCEPTION 'Cannot archive an active confirmed pair directly. Please unpair and restore first.';
    END IF;

    UPDATE public.confirmed_pairs
    SET status = 'Archived', updated_at = now()
    WHERE id = p_pair_id;

    RETURN jsonb_build_object('success', true, 'message', 'Pair archived successfully. Profiles are preserved.');
END;
$$;

-- D. Edit Pair Notes
CREATE OR REPLACE FUNCTION public.admin_edit_pair_notes(
    p_pair_id uuid,
    p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    c_admin_uid CONSTANT uuid := '0aef2513-034c-4940-a611-e43ae188190f'::uuid;
    v_caller_uid uuid;
BEGIN
    v_caller_uid := auth.uid();
    IF v_caller_uid IS NULL THEN
        RAISE EXCEPTION 'Access denied. Authentication required.' USING ERRCODE = '42501';
    END IF;
    IF v_caller_uid != c_admin_uid THEN
        RAISE EXCEPTION 'Access denied. Administrator privileges required.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.confirmed_pairs
    SET admin_notes = p_notes, updated_at = now()
    WHERE id = p_pair_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Confirmed pair record not found: %', p_pair_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'message', 'Pair notes updated.');
END;
$$;

-- E. Manage Shortlist (Add, Update Stage, Update Notes, Remove)
CREATE OR REPLACE FUNCTION public.admin_manage_shortlist(
    p_action text,
    p_bride_id text,
    p_groom_id text,
    p_stage text DEFAULT 'Shortlisted',
    p_notes text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    c_admin_uid CONSTANT uuid := '0aef2513-034c-4940-a611-e43ae188190f'::uuid;
    v_caller_uid uuid;
    v_id uuid;
    v_bride record;
    v_groom record;
BEGIN
    v_caller_uid := auth.uid();
    IF v_caller_uid IS NULL THEN
        RAISE EXCEPTION 'Access denied. Authentication required.' USING ERRCODE = '42501';
    END IF;
    IF v_caller_uid != c_admin_uid THEN
        RAISE EXCEPTION 'Access denied. Administrator privileges required.' USING ERRCODE = '42501';
    END IF;

    IF p_action = 'add' THEN
        -- Validate Bride exists and gender is Female
        SELECT * INTO v_bride FROM public.profiles WHERE profile_id = p_bride_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Bride profile not found: %', p_bride_id;
        END IF;
        IF LOWER(TRIM(COALESCE(v_bride.gender, ''))) != 'female' THEN
            RAISE EXCEPTION 'Profile % is not Female (Gender: %). Pair shortlist requires a female bride.', p_bride_id, v_bride.gender;
        END IF;

        -- Validate Groom exists and gender is Male
        SELECT * INTO v_groom FROM public.profiles WHERE profile_id = p_groom_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Groom profile not found: %', p_groom_id;
        END IF;
        IF LOWER(TRIM(COALESCE(v_groom.gender, ''))) != 'male' THEN
            RAISE EXCEPTION 'Profile % is not Male (Gender: %). Pair shortlist requires a male groom.', p_groom_id, v_groom.gender;
        END IF;

        INSERT INTO public.match_shortlists (
            bride_profile_id, groom_profile_id, stage, admin_notes, created_by, updated_at
        ) VALUES (
            p_bride_id, p_groom_id, p_stage, p_notes, v_caller_uid, now()
        )
        ON CONFLICT (bride_profile_id, groom_profile_id) 
        DO UPDATE SET 
            stage = p_stage,
            admin_notes = CASE WHEN p_notes != '' THEN p_notes ELSE public.match_shortlists.admin_notes END,
            updated_at = now()
        RETURNING id INTO v_id;
        RETURN jsonb_build_object('success', true, 'shortlist_id', v_id, 'message', 'Shortlist saved successfully.');

    ELSIF p_action = 'update_stage' THEN
        UPDATE public.match_shortlists
        SET stage = p_stage, updated_at = now()
        WHERE bride_profile_id = p_bride_id AND groom_profile_id = p_groom_id;
        RETURN jsonb_build_object('success', true, 'message', 'Shortlist stage updated.');

    ELSIF p_action = 'update_notes' THEN
        UPDATE public.match_shortlists
        SET admin_notes = p_notes, updated_at = now()
        WHERE bride_profile_id = p_bride_id AND groom_profile_id = p_groom_id;
        RETURN jsonb_build_object('success', true, 'message', 'Shortlist notes updated.');

    ELSIF p_action = 'remove' THEN
        DELETE FROM public.match_shortlists
        WHERE bride_profile_id = p_bride_id AND groom_profile_id = p_groom_id;
        RETURN jsonb_build_object('success', true, 'message', 'Shortlist removed.');

    ELSE
        RAISE EXCEPTION 'Invalid shortlist action: %', p_action;
    END IF;
END;
$$;

-- E.2 Manage Single Profile Shortlist (Add to Shortlist, Remove from Shortlist)
CREATE OR REPLACE FUNCTION public.admin_manage_single_shortlist(
    p_action text, -- 'add' or 'remove'
    p_profile_id text,
    p_notes text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    c_admin_uid CONSTANT uuid := '0aef2513-034c-4940-a611-e43ae188190f'::uuid;
    v_caller_uid uuid;
    v_profile record;
BEGIN
    v_caller_uid := auth.uid();
    IF v_caller_uid IS NULL THEN
        RAISE EXCEPTION 'Access denied. Authentication required.' USING ERRCODE = '42501';
    END IF;
    IF v_caller_uid != c_admin_uid THEN
        RAISE EXCEPTION 'Access denied. Administrator privileges required.' USING ERRCODE = '42501';
    END IF;

    SELECT id, profile_id, full_name, status INTO v_profile
    FROM public.profiles
    WHERE profile_id = p_profile_id;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION 'Profile % not found.', p_profile_id;
    END IF;

    IF p_action = 'add' THEN
        IF v_profile.status = 'Shortlisted' THEN
            RETURN jsonb_build_object('success', true, 'message', 'Profile is already shortlisted.', 'already_shortlisted', true);
        END IF;

        UPDATE public.profiles
        SET status = 'Shortlisted'
        WHERE profile_id = p_profile_id;

        RETURN jsonb_build_object('success', true, 'profile_id', p_profile_id, 'message', 'Profile shortlisted successfully.');

    ELSIF p_action = 'remove' THEN
        UPDATE public.profiles
        SET status = 'Reviewed'
        WHERE profile_id = p_profile_id;

        RETURN jsonb_build_object('success', true, 'profile_id', p_profile_id, 'message', 'Profile removed from shortlist.');

    ELSE
        RAISE EXCEPTION 'Invalid single shortlist action: %', p_action;
    END IF;
END;
$$;

-- F. Get Confirmed Pairs with Bride and Groom biodata
DROP FUNCTION IF EXISTS public.admin_get_pairs();
CREATE OR REPLACE FUNCTION public.admin_get_pairs(p_status text DEFAULT 'Active')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    c_admin_uid CONSTANT uuid := '0aef2513-034c-4940-a611-e43ae188190f'::uuid;
    v_caller_uid uuid;
    v_pairs jsonb;
BEGIN
    v_caller_uid := auth.uid();
    IF v_caller_uid IS NULL THEN
        RAISE EXCEPTION 'Access denied. Authentication required.' USING ERRCODE = '42501';
    END IF;
    IF v_caller_uid != c_admin_uid THEN
        RAISE EXCEPTION 'Access denied. Administrator privileges required.' USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', cp.id,
            'bride_profile_id', cp.bride_profile_id,
            'groom_profile_id', cp.groom_profile_id,
            'status', cp.status,
            'admin_notes', cp.admin_notes,
            'bride_original_status', cp.bride_original_status,
            'groom_original_status', cp.groom_original_status,
            'confirmed_at', cp.confirmed_at,
            'unpaired_at', cp.unpaired_at,
            'unpair_reason', cp.unpair_reason,
            'created_at', cp.created_at,
            'updated_at', cp.updated_at,
            'released_at', cp.released_at,
            'bride', jsonb_build_object(
                'profile_id', b.profile_id,
                'full_name', b.full_name,
                'gender', b.gender,
                'date_of_birth', b.date_of_birth,
                'age', b.age,
                'maslak', b.maslak,
                'city', b.city,
                'state', b.state,
                'education', b.education,
                'occupation', b.occupation,
                'salary', b.salary,
                'preferred_age_range', b.preferred_age_range,
                'photo_url', b.photo_url,
                'status', b.status
            ),
            'groom', jsonb_build_object(
                'profile_id', g.profile_id,
                'full_name', g.full_name,
                'gender', g.gender,
                'date_of_birth', g.date_of_birth,
                'age', g.age,
                'maslak', g.maslak,
                'city', g.city,
                'state', g.state,
                'education', g.education,
                'occupation', g.occupation,
                'salary', g.salary,
                'preferred_age_range', g.preferred_age_range,
                'photo_url', g.photo_url,
                'status', g.status
            )
        ) ORDER BY cp.created_at DESC
    ), '[]'::jsonb) INTO v_pairs
    FROM public.confirmed_pairs cp
    JOIN public.profiles b ON cp.bride_profile_id = b.profile_id
    JOIN public.profiles g ON cp.groom_profile_id = g.profile_id
    WHERE (p_status = 'All' OR cp.status = p_status);

    RETURN v_pairs;
END;
$$;

-- G. Get Shortlists (Single Profiles, Pairs, or All)
DROP FUNCTION IF EXISTS public.admin_get_shortlists(text);
DROP FUNCTION IF EXISTS public.admin_get_shortlists(text, text);
CREATE OR REPLACE FUNCTION public.admin_get_shortlists(
    p_stage text DEFAULT 'All',
    p_type text DEFAULT 'All' -- 'All', 'Single', 'Pair'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    c_admin_uid CONSTANT uuid := '0aef2513-034c-4940-a611-e43ae188190f'::uuid;
    v_caller_uid uuid;
    v_pairs jsonb := '[]'::jsonb;
    v_singles jsonb := '[]'::jsonb;
BEGIN
    v_caller_uid := auth.uid();
    IF v_caller_uid IS NULL THEN
        RAISE EXCEPTION 'Access denied. Authentication required.' USING ERRCODE = '42501';
    END IF;
    IF v_caller_uid != c_admin_uid THEN
        RAISE EXCEPTION 'Access denied. Administrator privileges required.' USING ERRCODE = '42501';
    END IF;

    -- Pair shortlists (from public.match_shortlists)
    IF p_type IN ('All', 'Pair') THEN
        SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
                'id', ms.id,
                'shortlist_type', 'pair',
                'stage', ms.stage,
                'admin_notes', ms.admin_notes,
                'created_at', ms.created_at,
                'updated_at', ms.updated_at,
                'bride', jsonb_build_object(
                    'profile_id', b.profile_id,
                    'full_name', b.full_name,
                    'gender', b.gender,
                    'date_of_birth', b.date_of_birth,
                    'age', b.age,
                    'maslak', b.maslak,
                    'city', b.city,
                    'state', b.state,
                    'education', b.education,
                    'occupation', b.occupation,
                    'salary', b.salary,
                    'photo_url', b.photo_url,
                    'status', b.status
                ),
                'groom', jsonb_build_object(
                    'profile_id', g.profile_id,
                    'full_name', g.full_name,
                    'gender', g.gender,
                    'date_of_birth', g.date_of_birth,
                    'age', g.age,
                    'maslak', g.maslak,
                    'city', g.city,
                    'state', g.state,
                    'education', g.education,
                    'occupation', g.occupation,
                    'salary', g.salary,
                    'photo_url', g.photo_url,
                    'status', g.status
                )
            ) ORDER BY ms.updated_at DESC
        ), '[]'::jsonb) INTO v_pairs
        FROM public.match_shortlists ms
        JOIN public.profiles b ON ms.bride_profile_id = b.profile_id
        JOIN public.profiles g ON ms.groom_profile_id = g.profile_id
        WHERE (p_stage = 'All' OR ms.stage = p_stage);
    END IF;

    -- Single profile shortlists (from public.profiles where status = 'Shortlisted')
    IF p_type IN ('All', 'Single') THEN
        SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
                'id', p.id,
                'shortlist_type', 'single',
                'stage', 'Shortlisted',
                'profile_id', p.profile_id,
                'full_name', p.full_name,
                'gender', p.gender,
                'date_of_birth', p.date_of_birth,
                'age', p.age,
                'maslak', p.maslak,
                'city', p.city,
                'state', p.state,
                'education', p.education,
                'occupation', p.occupation,
                'salary', p.salary,
                'preferred_age_range', p.preferred_age_range,
                'photo_url', p.photo_url,
                'status', p.status,
                'created_at', now(),
                'updated_at', now()
            ) ORDER BY p.id DESC
        ), '[]'::jsonb) INTO v_singles
        FROM public.profiles p
        WHERE p.status = 'Shortlisted';
    END IF;

    IF p_type = 'Pair' THEN
        RETURN v_pairs;
    ELSIF p_type = 'Single' THEN
        RETURN v_singles;
    ELSE
        -- Return unified structure with both categorized arrays and combined array
        RETURN jsonb_build_object(
            'single', v_singles,
            'pair', v_pairs,
            'all', (
                SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
                FROM (
                    SELECT jsonb_array_elements(v_singles) AS elem
                    UNION ALL
                    SELECT jsonb_array_elements(v_pairs) AS elem
                ) u
            )
        );
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. MAIN MATCHING RPC: public.admin_find_ai_matches
-- Enforces:
-- 1. Strict Administrator Authentication
-- 2. Target profile & candidate status eligibility: ONLY 'New', 'Review', 'Reviewed'
-- 3. Exclusion of any profile with an Active confirmed pair
-- 4. Gender compatibility
-- 5. Strict Islamic Age-Direction (groom.dob <= bride.dob)
-- 6. Multi-Maslak grouping (Primary Same-Maslak first, then Admin selected order)
-- 7. Deterministic sorting: Group -> Age gap in days -> Mutual pref rank -> Profile ID
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_find_ai_matches(
    p_selected_profile_id text,
    p_direction text,
    p_selected_maslaks text[],
    p_status_filter text DEFAULT 'All',
    p_preference_filter text DEFAULT 'All',
    p_max_age_gap_days INT DEFAULT NULL,
    p_city_state_search text DEFAULT NULL,
    p_page INT DEFAULT 1,
    p_page_size INT DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    c_admin_uid CONSTANT uuid := '0aef2513-034c-4940-a611-e43ae188190f'::uuid;
    v_caller_uid uuid;
    v_selected record;
    v_target_gender text;
    v_expected_gender text;
    v_selected_dob date;
    v_ref_date date;
    v_selected_age int;
    v_selected_maslak_norm text;
    v_norm_status_filter text;
    v_result jsonb;
    v_total_examined int;
    v_opposite_gender_count int;
    v_same_maslak_count int := 0;
    v_additional_maslak_count int := 0;
    v_age_dir_count int := 0;
    v_both_exact_count int := 0;
    v_flexible_count int := 0;
    v_outside_count int := 0;
    v_missing_count int := 0;
    v_total_eligible int;
    v_total_pages int;
    v_offset int;
BEGIN
    -- 1. CRITICAL SECURITY CHECK: STRICT ADMINISTRATOR AUTHENTICATION
    v_caller_uid := auth.uid();
    IF v_caller_uid IS NULL THEN
        RAISE EXCEPTION 'Access denied. Authentication required.' 
            USING ERRCODE = '42501';
    END IF;
    IF v_caller_uid != c_admin_uid THEN
        RAISE EXCEPTION 'Access denied. Administrator privileges required.' 
            USING ERRCODE = '42501';
    END IF;

    -- 2. Input validation
    p_page := GREATEST(1, COALESCE(p_page, 1));
    p_page_size := GREATEST(1, COALESCE(p_page_size, 10));

    IF p_selected_profile_id IS NULL OR TRIM(p_selected_profile_id) = '' THEN
        RAISE EXCEPTION 'Selected profile ID is required.';
    END IF;

    IF p_direction NOT IN ('bride', 'groom') THEN
        RAISE EXCEPTION 'Direction must be "bride" or "groom".';
    END IF;

    IF p_selected_maslaks IS NULL OR array_length(p_selected_maslaks, 1) IS NULL OR array_length(p_selected_maslaks, 1) = 0 THEN
        RAISE EXCEPTION 'At least one Maslak must be selected.';
    END IF;

    -- Validate status filter: strictly 'All', 'New', or 'Reviewed'
    v_norm_status_filter := LOWER(TRIM(COALESCE(p_status_filter, 'All')));
    IF v_norm_status_filter NOT IN ('all', 'new', 'reviewed') THEN
        RAISE EXCEPTION 'Invalid status filter "%". Supported values are: All, New, Reviewed.', p_status_filter
            USING ERRCODE = '22023';
    END IF;

    -- 3. Load selected profile
    SELECT * INTO v_selected FROM public.profiles WHERE profile_id = p_selected_profile_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Selected profile not found: %', p_selected_profile_id;
    END IF;

    -- Target profile status eligibility: ONLY 'New' or 'Reviewed'
    IF v_selected.status IS NULL OR v_selected.status NOT IN ('New', 'Reviewed') THEN
        RAISE EXCEPTION 'Selected profile status is "%", which is ineligible for matching (must be New or Reviewed).', v_selected.status;
    END IF;

    -- Target profile confirmed pair check
    IF EXISTS (
        SELECT 1 FROM public.confirmed_pairs 
        WHERE status = 'Active' 
          AND (bride_profile_id = p_selected_profile_id OR groom_profile_id = p_selected_profile_id)
    ) THEN
        RAISE EXCEPTION 'Selected profile % is already in an active confirmed matrimonial pair.', p_selected_profile_id;
    END IF;

    v_target_gender := CASE WHEN p_direction = 'bride' THEN 'Male' ELSE 'Female' END;
    v_expected_gender := CASE WHEN p_direction = 'bride' THEN 'Female' ELSE 'Male' END;

    IF LOWER(TRIM(COALESCE(v_selected.gender, ''))) != LOWER(v_expected_gender) THEN
        RAISE EXCEPTION 'Selected profile gender is %, expected % for % search', 
            v_selected.gender, v_expected_gender, p_direction;
    END IF;

    v_selected_dob := public.safe_cast_to_date(v_selected.date_of_birth);
    IF v_selected_dob IS NULL THEN
        RAISE EXCEPTION 'Selected profile has missing or invalid date_of_birth: %', v_selected.date_of_birth;
    END IF;

    v_ref_date := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date;
    v_selected_age := COALESCE(v_selected.age, (v_ref_date - v_selected_dob) / 365);
    v_selected_maslak_norm := LOWER(TRIM(COALESCE(v_selected.maslak, '')));

    -- 4. Count total examined profiles and opposite-gender profiles
    SELECT COUNT(*) INTO v_total_examined FROM public.profiles WHERE profile_id != p_selected_profile_id;
    SELECT COUNT(*) INTO v_opposite_gender_count FROM public.profiles 
    WHERE profile_id != p_selected_profile_id AND LOWER(TRIM(COALESCE(gender, ''))) = LOWER(v_target_gender);

    -- 5. Build candidate evaluation table
    DROP TABLE IF EXISTS _tmp_ai_candidates;
    CREATE TEMP TABLE _tmp_ai_candidates ON COMMIT DROP AS
    WITH raw_candidates AS (
        SELECT 
            p.*,
            LOWER(TRIM(COALESCE(p.maslak, ''))) AS candidate_maslak_norm,
            public.safe_cast_to_date(p.date_of_birth) AS candidate_dob
        FROM public.profiles p
        WHERE p.profile_id != p_selected_profile_id
          AND LOWER(TRIM(COALESCE(p.gender, ''))) = LOWER(v_target_gender)
          AND public.safe_cast_to_date(p.date_of_birth) IS NOT NULL
          -- Mandatory status eligibility: ONLY 'New' or 'Reviewed'
          AND p.status IN ('New', 'Reviewed')
          AND (
              (v_norm_status_filter = 'all' AND p.status IN ('New', 'Reviewed')) OR
              (v_norm_status_filter = 'new' AND p.status = 'New') OR
              (v_norm_status_filter = 'reviewed' AND p.status = 'Reviewed')
          )
          -- Exclude any profile currently in an active confirmed pair
          AND p.profile_id NOT IN (
              SELECT bride_profile_id FROM public.confirmed_pairs WHERE status = 'Active'
              UNION
              SELECT groom_profile_id FROM public.confirmed_pairs WHERE status = 'Active'
          )
    ),
    maslak_filtered AS (
        SELECT 
            rc.*,
            idx.maslak_idx,
            idx.matched_maslak_orig,
            (
                rc.candidate_maslak_norm = v_selected_maslak_norm 
                AND v_selected_maslak_norm NOT IN ('', 'other', 'prefer not to say', 'prefer_not_to_say', 'prefer-not-to-say', 'prefer not say', 'not specified', 'none', 'n/a')
                AND rc.candidate_maslak_norm NOT IN ('', 'other', 'prefer not to say', 'prefer_not_to_say', 'prefer-not-to-say', 'prefer not say', 'not specified', 'none', 'n/a')
            ) AS is_same_maslak
        FROM raw_candidates rc
        CROSS JOIN LATERAL (
            SELECT 
                m_ord.ordinality AS maslak_idx,
                m_ord.val AS matched_maslak_orig
            FROM unnest(p_selected_maslaks) WITH ORDINALITY AS m_ord(val, ordinality)
            WHERE LOWER(TRIM(m_ord.val)) = rc.candidate_maslak_norm
            LIMIT 1
        ) idx
    ),
    age_direction_filtered AS (
        SELECT 
            mf.*,
            CASE 
                -- Bride matching: Groom must be older or same DOB (candidate_dob <= v_selected_dob)
                WHEN p_direction = 'bride' AND mf.candidate_dob <= v_selected_dob THEN true
                -- Groom matching: Bride must be younger or same DOB (candidate_dob >= v_selected_dob)
                WHEN p_direction = 'groom' AND mf.candidate_dob >= v_selected_dob THEN true
                ELSE false
            END AS age_dir_satisfied,
            (mf.candidate_dob = v_selected_dob) AS is_same_dob,
            ABS(v_selected_dob - mf.candidate_dob) AS diff_days
        FROM maslak_filtered mf
        WHERE (p_direction = 'bride' AND mf.candidate_dob <= v_selected_dob)
           OR (p_direction = 'groom' AND mf.candidate_dob >= v_selected_dob)
    ),
    evaluated AS (
        SELECT 
            adf.*,
            COALESCE(adf.age, (v_ref_date - adf.candidate_dob) / 365) AS evaluated_candidate_age,
            -- Group priority: Same Maslak is 0, additional Maslaks are 1, 2, 3...
            CASE WHEN adf.is_same_maslak THEN 0 ELSE adf.maslak_idx END AS group_priority,
            CASE WHEN adf.is_same_maslak THEN 'SAME_MASLAK' ELSE 'ADDITIONAL_MASLAK' END AS group_type,
            -- Preference evaluation: Selected on Candidate
            s_pref.pref_status AS s_on_c_status,
            s_pref.pref_rank AS s_on_c_rank,
            s_pref.pref_label AS s_on_c_label,
            -- Preference evaluation: Candidate on Selected
            c_pref.pref_status AS c_on_s_status,
            c_pref.pref_rank AS c_on_s_rank,
            c_pref.pref_label AS c_on_s_label,
            -- Mutual combined preference status
            CASE 
                WHEN s_pref.pref_status = 'EXACT' AND c_pref.pref_status = 'EXACT' THEN 'BOTH_EXACT'
                WHEN (s_pref.pref_status = 'EXACT' AND c_pref.pref_status = 'FLEXIBLE') OR
                     (s_pref.pref_status = 'FLEXIBLE' AND c_pref.pref_status = 'EXACT') THEN 'ONE_EXACT_ONE_FLEXIBLE'
                WHEN s_pref.pref_status = 'FLEXIBLE' AND c_pref.pref_status = 'FLEXIBLE' THEN 'BOTH_FLEXIBLE'
                WHEN s_pref.pref_status = 'OUTSIDE' OR c_pref.pref_status = 'OUTSIDE' THEN 'OUTSIDE'
                ELSE 'MISSING'
            END AS combined_pref_status,
            CASE 
                WHEN s_pref.pref_status = 'EXACT' AND c_pref.pref_status = 'EXACT' THEN 1
                WHEN (s_pref.pref_status = 'EXACT' AND c_pref.pref_status = 'FLEXIBLE') OR
                     (s_pref.pref_status = 'FLEXIBLE' AND c_pref.pref_status = 'EXACT') THEN 2
                WHEN s_pref.pref_status = 'FLEXIBLE' AND c_pref.pref_status = 'FLEXIBLE' THEN 3
                WHEN s_pref.pref_status = 'OUTSIDE' OR c_pref.pref_status = 'OUTSIDE' THEN 4
                ELSE 5
            END AS combined_pref_rank
        FROM age_direction_filtered adf
        CROSS JOIN LATERAL public.evaluate_single_age_preference(
            COALESCE(adf.age, (v_ref_date - adf.candidate_dob) / 365), 
            v_selected.preferred_age_range
        ) s_pref
        CROSS JOIN LATERAL public.evaluate_single_age_preference(
            v_selected_age, 
            adf.preferred_age_range
        ) c_pref
    )
    SELECT * FROM evaluated;

    -- 6. Calculate KPIs from evaluated table
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE is_same_maslak),
        COUNT(*) FILTER (WHERE NOT is_same_maslak),
        COUNT(*) FILTER (WHERE combined_pref_status = 'BOTH_EXACT'),
        COUNT(*) FILTER (WHERE combined_pref_status IN ('ONE_EXACT_ONE_FLEXIBLE', 'BOTH_FLEXIBLE')),
        COUNT(*) FILTER (WHERE combined_pref_status = 'OUTSIDE'),
        COUNT(*) FILTER (WHERE combined_pref_status = 'MISSING')
    INTO 
        v_age_dir_count,
        v_same_maslak_count,
        v_additional_maslak_count,
        v_both_exact_count,
        v_flexible_count,
        v_outside_count,
        v_missing_count
    FROM _tmp_ai_candidates;

    -- 7. Apply optional runtime filters
    DROP TABLE IF EXISTS _tmp_filtered_matches;
    CREATE TEMP TABLE _tmp_filtered_matches ON COMMIT DROP AS
    SELECT * FROM _tmp_ai_candidates
    WHERE (p_preference_filter = 'All' OR combined_pref_status = p_preference_filter)
      AND (p_max_age_gap_days IS NULL OR diff_days <= p_max_age_gap_days)
      AND (p_city_state_search IS NULL OR TRIM(p_city_state_search) = '' OR 
           city ILIKE '%' || TRIM(p_city_state_search) || '%' OR 
           state ILIKE '%' || TRIM(p_city_state_search) || '%');

    SELECT COUNT(*) INTO v_total_eligible FROM _tmp_filtered_matches;

    v_total_pages := GREATEST(1, CEIL(v_total_eligible::numeric / p_page_size::numeric));
    v_offset := (GREATEST(1, p_page) - 1) * p_page_size;

    -- 8. Assemble structured JSON response
    v_result := jsonb_build_object(
        'summary', jsonb_build_object(
            'total_examined', v_total_examined,
            'opposite_gender_count', v_opposite_gender_count,
            'same_maslak_count', v_same_maslak_count,
            'additional_maslak_count', v_additional_maslak_count,
            'age_direction_eligible_count', v_age_dir_count,
            'both_exact_count', v_both_exact_count,
            'flexible_count', v_flexible_count,
            'outside_count', v_outside_count,
            'missing_count', v_missing_count,
            'total_eligible_matches', v_total_eligible,
            'current_page', p_page,
            'page_size', p_page_size,
            'total_pages', v_total_pages
        ),
        'top5', (
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'profile_id', t.profile_id,
                    'full_name', t.full_name,
                    'gender', t.gender,
                    'age', t.evaluated_candidate_age,
                    'date_of_birth', t.date_of_birth,
                    'maslak', t.maslak,
                    'matched_maslak', t.matched_maslak_orig,
                    'matched_maslak_orig', t.matched_maslak_orig,
                    'is_same_maslak', t.is_same_maslak,
                    'city', t.city,
                    'state', t.state,
                    'education', t.education,
                    'occupation', t.occupation,
                    'salary', t.salary,
                    'preferred_age_range', t.preferred_age_range,
                    'status', t.status,
                    'photo_url', t.photo_url,
                    'diff_days', t.diff_days,
                    'age_difference_display', 
                        CASE WHEN t.diff_days = 0 THEN 'Same DOB' 
                             ELSE (t.diff_days / 365) || ' yrs, ' || ((t.diff_days % 365) / 30) || ' mos' END,
                    'combined_pref_status', t.combined_pref_status,
                    'mutual_pref_status', t.combined_pref_status,
                    'combined_pref_rank', t.combined_pref_rank,
                    'mutual_pref_rank', t.combined_pref_rank,
                    's_on_c_label', t.s_on_c_label,
                    'c_on_s_label', t.c_on_s_label,
                    'group_type', t.group_type,
                    'group_priority', t.group_priority,
                    'explanation', 
                        CASE WHEN t.is_same_maslak THEN 'Same Maslak (' || t.matched_maslak_orig || '). '
                             ELSE 'Admin selected ' || t.matched_maslak_orig || ' as additional Maslak. ' END ||
                        'Gender compatible. Age direction satisfied. Mutual preference: ' || t.combined_pref_status,
                    'match_explanation',
                        CASE WHEN t.is_same_maslak THEN 'Same Maslak (' || t.matched_maslak_orig || '). '
                             ELSE 'Admin selected ' || t.matched_maslak_orig || ' as additional Maslak. ' END ||
                        'Gender compatible. Age direction satisfied. Mutual preference: ' || t.combined_pref_status
                )
            ), '[]'::jsonb)
            FROM (
                SELECT * FROM _tmp_filtered_matches
                ORDER BY group_priority ASC, diff_days ASC, combined_pref_rank ASC, profile_id ASC
                LIMIT 5
            ) t
        ),
        'groups', (
            SELECT COALESCE(jsonb_agg(grp), '[]'::jsonb)
            FROM (
                SELECT 
                    g.group_priority,
                    g.matched_maslak_orig AS maslak,
                    g.is_same_maslak,
                    COUNT(*) AS count_in_group,
                    jsonb_agg(
                        jsonb_build_object(
                            'profile_id', g.profile_id,
                            'full_name', g.full_name,
                            'gender', g.gender,
                            'age', g.evaluated_candidate_age,
                            'date_of_birth', g.date_of_birth,
                            'maslak', g.maslak,
                            'matched_maslak', g.matched_maslak_orig,
                            'matched_maslak_orig', g.matched_maslak_orig,
                            'is_same_maslak', g.is_same_maslak,
                            'city', g.city,
                            'state', g.state,
                            'education', g.education,
                            'occupation', g.occupation,
                            'salary', g.salary,
                            'preferred_age_range', g.preferred_age_range,
                            'status', g.status,
                            'photo_url', g.photo_url,
                            'diff_days', g.diff_days,
                            'age_difference_display', 
                                CASE WHEN g.diff_days = 0 THEN 'Same DOB' 
                                     ELSE (g.diff_days / 365) || ' yrs, ' || ((g.diff_days % 365) / 30) || ' mos' END,
                            'combined_pref_status', g.combined_pref_status,
                            'mutual_pref_status', g.combined_pref_status,
                            'combined_pref_rank', g.combined_pref_rank,
                            'mutual_pref_rank', g.combined_pref_rank,
                            's_on_c_label', g.s_on_c_label,
                            'c_on_s_label', g.c_on_s_label,
                            'group_type', g.group_type,
                            'group_priority', g.group_priority,
                            'explanation', 
                                CASE WHEN g.is_same_maslak THEN 'Same Maslak (' || g.matched_maslak_orig || '). '
                                     ELSE 'Admin selected ' || g.matched_maslak_orig || ' as additional Maslak. ' END ||
                                'Gender compatible. Age direction satisfied. Mutual preference: ' || g.combined_pref_status,
                            'match_explanation',
                                CASE WHEN g.is_same_maslak THEN 'Same Maslak (' || g.matched_maslak_orig || '). '
                                     ELSE 'Admin selected ' || g.matched_maslak_orig || ' as additional Maslak. ' END ||
                                'Gender compatible. Age direction satisfied. Mutual preference: ' || g.combined_pref_status
                        )
                        ORDER BY g.diff_days ASC, g.combined_pref_rank ASC, g.profile_id ASC
                    ) AS candidates
                FROM _tmp_filtered_matches g
                GROUP BY g.group_priority, g.matched_maslak_orig, g.is_same_maslak
                ORDER BY g.group_priority ASC
            ) grp
        ),
        'paginated_matches', (
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'profile_id', p_match.profile_id,
                    'full_name', p_match.full_name,
                    'gender', p_match.gender,
                    'age', p_match.evaluated_candidate_age,
                    'date_of_birth', p_match.date_of_birth,
                    'maslak', p_match.maslak,
                    'matched_maslak', p_match.matched_maslak_orig,
                    'matched_maslak_orig', p_match.matched_maslak_orig,
                    'is_same_maslak', p_match.is_same_maslak,
                    'city', p_match.city,
                    'state', p_match.state,
                    'education', p_match.education,
                    'occupation', p_match.occupation,
                    'salary', p_match.salary,
                    'preferred_age_range', p_match.preferred_age_range,
                    'status', p_match.status,
                    'photo_url', p_match.photo_url,
                    'diff_days', p_match.diff_days,
                    'age_difference_display', 
                        CASE WHEN p_match.diff_days = 0 THEN 'Same DOB' 
                             ELSE (p_match.diff_days / 365) || ' yrs, ' || ((p_match.diff_days % 365) / 30) || ' mos' END,
                    'combined_pref_status', p_match.combined_pref_status,
                    'mutual_pref_status', p_match.combined_pref_status,
                    'combined_pref_rank', p_match.combined_pref_rank,
                    'mutual_pref_rank', p_match.combined_pref_rank,
                    's_on_c_label', p_match.s_on_c_label,
                    'c_on_s_label', p_match.c_on_s_label,
                    'group_type', p_match.group_type,
                    'group_priority', p_match.group_priority,
                    'explanation', 
                        CASE WHEN p_match.is_same_maslak THEN 'Same Maslak (' || p_match.matched_maslak_orig || '). '
                             ELSE 'Admin selected ' || p_match.matched_maslak_orig || ' as additional Maslak. ' END ||
                        'Gender compatible. Age direction satisfied. Mutual preference: ' || p_match.combined_pref_status,
                    'match_explanation',
                        CASE WHEN p_match.is_same_maslak THEN 'Same Maslak (' || p_match.matched_maslak_orig || '). '
                             ELSE 'Admin selected ' || p_match.matched_maslak_orig || ' as additional Maslak. ' END ||
                        'Gender compatible. Age direction satisfied. Mutual preference: ' || p_match.combined_pref_status
                )
            ), '[]'::jsonb)
            FROM (
                SELECT * FROM _tmp_filtered_matches
                ORDER BY group_priority ASC, diff_days ASC, combined_pref_rank ASC, profile_id ASC
                OFFSET v_offset
                LIMIT p_page_size
            ) p_match
        )
    );

    RETURN v_result;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. SECURITY & PERMISSIONS HARDENING
-- Revoke all execution grants from PUBLIC and anonymous users.
-- Grant execution strictly to authenticated users (admin UID validated inside each RPC).
-- (Unnecessary service_role grants removed per security policy).
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.admin_find_ai_matches(text, text, text[], text, text, INT, text, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_find_ai_matches(text, text, text[], text, text, INT, text, INT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_find_ai_matches(text, text, text[], text, text, INT, text, INT, INT) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_confirm_pair(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_confirm_pair(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_confirm_pair(text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_release_pair(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_release_pair(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_release_pair(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_unpair_and_restore(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_unpair_and_restore(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_unpair_and_restore(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_delete_pair_record(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_pair_record(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_pair_record(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_archive_pair(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_archive_pair(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_archive_pair(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_edit_pair_notes(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_edit_pair_notes(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_edit_pair_notes(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_manage_shortlist(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_manage_shortlist(text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_manage_shortlist(text, text, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_manage_single_shortlist(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_manage_single_shortlist(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_manage_single_shortlist(text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_get_pairs(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_pairs(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_pairs(text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_get_shortlists(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_shortlists(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_shortlists(text, text) TO authenticated;

-- Helper functions: strictly internal utility functions with no direct frontend invocation.
-- Revoke all permissions from PUBLIC, anon, and authenticated (defense-in-depth).
-- Internal execution by authorised SECURITY DEFINER functions (owned by postgres) remains intact.
REVOKE ALL ON FUNCTION public.safe_cast_to_date(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parse_preferred_age_range(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.evaluate_single_age_preference(INT, text) FROM PUBLIC, anon, authenticated;

-- RLS on relationship tables
ALTER TABLE public.match_shortlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.confirmed_pairs ENABLE ROW LEVEL SECURITY;

-- Grants for relationship tables: explicit minimum permissions only (NO TRUNCATE, NO REFERENCES, NO TRIGGER)
REVOKE ALL ON public.match_shortlists FROM anon, PUBLIC, authenticated;
REVOKE ALL ON public.confirmed_pairs FROM anon, PUBLIC, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.match_shortlists TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.confirmed_pairs TO authenticated;

DROP POLICY IF EXISTS "Strict Admin Shortlists" ON public.match_shortlists;
CREATE POLICY "Strict Admin Shortlists" ON public.match_shortlists 
    FOR ALL TO authenticated 
    USING (auth.uid() = '0aef2513-034c-4940-a611-e43ae188190f')
    WITH CHECK (auth.uid() = '0aef2513-034c-4940-a611-e43ae188190f');

DROP POLICY IF EXISTS "Strict Admin Confirmed Pairs" ON public.confirmed_pairs;
CREATE POLICY "Strict Admin Confirmed Pairs" ON public.confirmed_pairs 
    FOR ALL TO authenticated 
    USING (auth.uid() = '0aef2513-034c-4940-a611-e43ae188190f')
    WITH CHECK (auth.uid() = '0aef2513-034c-4940-a611-e43ae188190f');

-- ----------------------------------------------------------------------------
-- ROLLBACK SCRIPT (Provided for Owner Review)
-- ----------------------------------------------------------------------------
/*
DROP POLICY IF EXISTS "Strict Admin Confirmed Pairs" ON public.confirmed_pairs;
DROP POLICY IF EXISTS "Strict Admin Shortlists" ON public.match_shortlists;
DROP TABLE IF EXISTS public.confirmed_pairs;
DROP TABLE IF EXISTS public.match_shortlists;
DROP FUNCTION IF EXISTS public.admin_find_ai_matches(text, text, text[], text, text, INT, text, INT, INT);
DROP FUNCTION IF EXISTS public.admin_confirm_pair(text, text, text);
DROP FUNCTION IF EXISTS public.admin_unpair_and_restore(uuid, text);
DROP FUNCTION IF EXISTS public.admin_release_pair(uuid, text);
DROP FUNCTION IF EXISTS public.admin_delete_pair_record(uuid);
DROP FUNCTION IF EXISTS public.admin_archive_pair(uuid);
DROP FUNCTION IF EXISTS public.admin_edit_pair_notes(uuid, text);
DROP FUNCTION IF EXISTS public.admin_manage_shortlist(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.admin_manage_single_shortlist(text, text, text);
DROP FUNCTION IF EXISTS public.admin_get_pairs(text);
DROP FUNCTION IF EXISTS public.admin_get_shortlists(text, text);
DROP FUNCTION IF EXISTS public.evaluate_single_age_preference(INT, text);
DROP FUNCTION IF EXISTS public.parse_preferred_age_range(text);
DROP FUNCTION IF EXISTS public.safe_cast_to_date(text);
DROP INDEX IF EXISTS public.idx_profiles_status_btree;
DROP INDEX IF EXISTS public.idx_profiles_dob_btree;
DROP INDEX IF EXISTS public.idx_profiles_matching_core;
*/
