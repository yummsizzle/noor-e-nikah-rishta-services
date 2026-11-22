-- =============================================================================
-- NOOR-E-NIKAH MATCHMAKING — READ-ONLY PREFLIGHT AUDIT QUERIES
-- Project: Noor-E-Nikah Rishta Services
-- Target: Supabase PostgreSQL (`public.profiles`)
--
-- DESCRIPTION:
-- Run these read-only queries in the Supabase SQL Editor BEFORE applying
-- `supabase_profile_id_and_native_place.sql`.
-- None of these queries modify, lock, or delete any data.
-- =============================================================================

-- =============================================================================
-- PREFLIGHT CHECK 1: DUPLICATE PROFILE ID DETECTION
-- Returns any duplicate Profile IDs currently present in public.profiles.
-- Expected Result: 0 rows.
-- If rows are returned, STOP and inspect them. Do not delete customer records.
-- =============================================================================
SELECT 
    profile_id, 
    COUNT(*) AS duplicate_count,
    array_agg(id) AS profile_uuids,
    array_agg(full_name) AS candidate_names,
    array_agg(created_at ORDER BY created_at ASC) AS registration_timestamps
FROM public.profiles
WHERE profile_id IS NOT NULL AND TRIM(profile_id) <> ''
GROUP BY profile_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, profile_id ASC;


-- =============================================================================
-- PREFLIGHT CHECK 2: NULL OR BLANK PROFILE ID DETECTION
-- Returns any profile records lacking a valid Profile ID.
-- =============================================================================
SELECT 
    id AS profile_uuid,
    full_name,
    mobile,
    city,
    status,
    created_at
FROM public.profiles
WHERE profile_id IS NULL OR TRIM(profile_id) = ''
ORDER BY created_at DESC;


-- =============================================================================
-- PREFLIGHT CHECK 3: INSPECT EXISTING COLUMNS IN public.profiles
-- Confirms column names, types, and nullability for native_place & family_location.
-- =============================================================================
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'profiles' 
  AND column_name IN ('id', 'profile_id', 'reservation_token', 'native_place', 'family_location', 'full_name', 'status', 'created_at', 'updated_at')
ORDER BY ordinal_position;


-- =============================================================================
-- PREFLIGHT CHECK 4: INSPECT EXISTING CONSTRAINTS ON public.profiles
-- Lists existing primary keys, unique constraints, and check constraints.
-- =============================================================================
SELECT 
    con.conname AS constraint_name,
    con.contype AS constraint_type, -- 'p' = primary key, 'u' = unique, 'c' = check
    pg_get_constraintdef(con.oid) AS constraint_definition
FROM pg_constraint con
JOIN pg_class cls ON cls.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
WHERE nsp.nspname = 'public' 
  AND cls.relname = 'profiles'
ORDER BY con.contype, con.conname;


-- =============================================================================
-- PREFLIGHT CHECK 5: INSPECT EXISTING TRIGGERS ON public.profiles
-- Identifies any previously created triggers on the profiles table.
-- =============================================================================
SELECT 
    trigger_name,
    event_manipulation,
    action_timing,
    action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table = 'profiles'
ORDER BY trigger_name;


-- =============================================================================
-- PREFLIGHT CHECK 6: PROFILE ID PATTERN DISTRIBUTION
-- Shows breakdown between legacy random 4-digit IDs and sequential format IDs.
-- =============================================================================
SELECT 
    CASE 
        WHEN profile_id ~ '^NN-\d{4}-\d{1,2}$' THEN 'Sequential Format (NN-YYYY-01..99)'
        WHEN profile_id ~ '^NN-\d{4}-\d{3}$' THEN 'Sequential Format (NN-YYYY-100..999)'
        WHEN profile_id ~ '^NN-\d{4}-\d{4,}$' THEN 'Legacy Random Format (NN-YYYY-XXXX)'
        ELSE 'Other / Non-Standard'
    END AS id_format_category,
    COUNT(*) AS total_count,
    MIN(profile_id) AS sample_min,
    MAX(profile_id) AS sample_max
FROM public.profiles
WHERE profile_id IS NOT NULL AND TRIM(profile_id) <> ''
GROUP BY 1
ORDER BY total_count DESC;


-- =============================================================================
-- PREFLIGHT CHECK 7: CHECK IF TRACKER OR REGISTRY TABLES ALREADY EXIST
-- Confirms current state before running migration.
-- =============================================================================
SELECT 
    table_name,
    (SELECT COUNT(*) FROM information_schema.columns c WHERE c.table_name = t.table_name AND c.table_schema = 'public') AS column_count
FROM information_schema.tables t
WHERE table_schema = 'public' 
  AND table_name IN ('profile_id_tracker', 'profile_id_registry', 'profile_id_rate_limit');


-- =============================================================================
-- PREFLIGHT CHECK 8: SCHEMA PRIVILEGES AUDIT (CREATE & USAGE ON public / extensions)
-- Confirms that anon, authenticated, and public roles DO NOT possess CREATE privileges.
-- Expected Result: has_create = false for anon, authenticated, and public.
-- =============================================================================
SELECT 
    n.nspname AS schema_name,
    r.rolname AS role_name,
    has_schema_privilege(r.rolname, n.nspname, 'USAGE') AS has_usage,
    has_schema_privilege(r.rolname, n.nspname, 'CREATE') AS has_create
FROM pg_namespace n
CROSS JOIN (
    SELECT rolname 
    FROM pg_roles 
    WHERE rolname IN ('anon', 'authenticated', 'public')
) r
WHERE n.nspname IN ('public', 'extensions')
ORDER BY n.nspname, r.rolname;
