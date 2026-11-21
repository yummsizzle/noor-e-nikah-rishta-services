-- =============================================================================
-- NOOR-E-NIKAH MATCHMAKING — SECURE PROFILE ID REGISTRY & NATIVE PLACE MIGRATION
-- Project: Noor-E-Nikah Rishta Services
-- Target: Supabase PostgreSQL (`public.profiles`, `public.profile_id_tracker`, `public.profile_id_registry`)
-- Version: 3.3 (Final Hardened: Trusted Search Path Order, Explicit Qualification & Schema Isolation)
--
-- AUDIT & SECURITY CONTROLS:
-- 1. Trusted Search Path Order:
--    - All seven SECURITY DEFINER functions explicitly set:
--      `SET search_path = pg_catalog, public, extensions, pg_temp;`
--    - Putting `pg_catalog` first ensures core PostgreSQL system functions always resolve
--      directly to PostgreSQL's trusted catalog, preventing object-shadowing attacks.
--    - Keeping `pg_temp` last ensures temporary tables cannot hijack persistent tables.
-- 2. Schema Privilege Hardening:
--    - Explicitly revokes CREATE privileges on `public` and `extensions` schemas from
--      PUBLIC, anon, and authenticated roles to guarantee zero unauthorized schema pollution.
-- 3. Explicit Function Qualification:
--    - Explicitly qualifies `extensions.gen_random_bytes(32)` and `pg_catalog` utilities
--      wherever appropriate.
-- 4. Fail-Safe 256-Bit CSPRNG Token Generation:
--    - Strictly uses genuine 32-byte (256-bit) cryptographic random bytes.
--    - Fails safely if unavailable without silent, insecure fallbacks.
-- 5. Role & Maintenance Privilege Isolation:
--    - `cleanup_expired_profile_id_reservations()` is granted strictly to `service_role`.
--    - Direct table manipulation on tracker and registry is REVOKED from public, anon, and authenticated.
-- 6. Strict Lifecycle & No-Reuse Guarantee:
--    - 'reserved' -> 'active' -> 'deleted' / 'retired'
--    - Deleted or retired IDs can NEVER be reused or reallocated.
-- 7. Repeated Migration Idempotency:
--    - Safe to run multiple times without resetting sequence counters or altering data.
--    - Preserves all 16 existing customer profiles (`NN-2026-XXXX`).
--
-- STRICT RESTRICTION:
-- This file is for review and execution by the database administrator in the Supabase SQL Editor.
-- =============================================================================

-- Ensure pgcrypto extension is installed in schema extensions (default Supabase) or public
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
EXCEPTION WHEN OTHERS THEN
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
END $$;

-- Defensive Schema Privilege Hardening: Ensure untrusted roles cannot CREATE objects in public or extensions
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
    EXECUTE 'REVOKE CREATE ON SCHEMA extensions FROM PUBLIC, anon, authenticated';
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;


-- =============================================================================
-- SECTION 1: NATIVE PLACE & TRANSIT COLUMNS ON public.profiles
-- =============================================================================

-- 1.1 Add native_place column if it does not already exist
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS native_place text;

COMMENT ON COLUMN public.profiles.native_place IS 'Candidate native place / ancestral origin (e.g. Village / City, District, State)';

-- 1.2 Add reservation_token column as temporary transit field (cleared by trigger before persistence)
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS reservation_token text;

COMMENT ON COLUMN public.profiles.reservation_token IS 'Temporary transit token for validating reservation ownership during profile insertion (cleared immediately by trigger)';

-- 1.3 Backfill existing records bidirectionally without overwriting populated fields
UPDATE public.profiles 
SET native_place = family_location 
WHERE native_place IS NULL AND family_location IS NOT NULL;

UPDATE public.profiles 
SET family_location = native_place 
WHERE family_location IS NULL AND native_place IS NOT NULL;


-- =============================================================================
-- SECTION 2: PROFILE ID TRACKER & PERMANENT REGISTRY TABLES
-- =============================================================================

-- 2.1 Atomic sequence tracker (records the highest issued sequence number per year)
CREATE TABLE IF NOT EXISTS public.profile_id_tracker (
    year integer PRIMARY KEY,
    last_serial integer NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.profile_id_tracker IS 'Atomic sequence tracker for sequential Profile IDs (NN-YYYY-01)';

-- 2.2 Permanent Profile ID Registry (records full lifecycle, cryptographic token hash, and prevents reuse)
CREATE TABLE IF NOT EXISTS public.profile_id_registry (
    profile_id text PRIMARY KEY,
    registration_year integer NOT NULL,
    serial_number integer NOT NULL,
    issued_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    expires_at timestamptz NOT NULL DEFAULT (pg_catalog.now() + interval '15 minutes'),
    token_hash text,
    profile_uuid uuid,
    status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'active', 'deleted', 'retired'))
);

COMMENT ON TABLE public.profile_id_registry IS 'Permanent audit registry of all issued Profile IDs with cryptographic token hash and strict lifecycle tracking';

-- Ensure token_hash and expires_at exist if table was previously created
ALTER TABLE public.profile_id_registry 
ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (pg_catalog.now() + interval '15 minutes');

ALTER TABLE public.profile_id_registry 
ADD COLUMN IF NOT EXISTS token_hash text;

-- 2.3 Hardened Access Control & Row Level Security
ALTER TABLE public.profile_id_tracker ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_id_registry ENABLE ROW LEVEL SECURITY;

-- Revoke all direct privileges from public, anon, and authenticated users.
-- Ordinary users and web clients cannot query, insert, update, or delete these tables directly.
REVOKE ALL ON TABLE public.profile_id_tracker FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.profile_id_registry FROM PUBLIC, anon, authenticated;

-- Grant access to service_role for backend administrative maintenance if required
GRANT ALL ON TABLE public.profile_id_tracker TO service_role;
GRANT ALL ON TABLE public.profile_id_registry TO service_role;


-- =============================================================================
-- SECTION 3: INITIALIZE TRACKER & REGISTER EXISTING PROFILES
-- =============================================================================

-- 3.1 Initialize tracker for current operational year
INSERT INTO public.profile_id_tracker (year, last_serial)
VALUES (EXTRACT(YEAR FROM CURRENT_DATE)::integer, 0)
ON CONFLICT (year) DO NOTHING;

-- 3.2 Synchronize tracker with existing sequential profiles (< 1000) only
-- CRITICAL: Explicitly ignores legacy 4-digit random numbers like NN-2026-6966 so sequence begins cleanly at 01
-- GREATEST() guarantees rerunning the migration will never decrement last_serial
INSERT INTO public.profile_id_tracker (year, last_serial)
SELECT 
    sub.yr,
    COALESCE(MAX(sub.serial_num), 0)
FROM (
    SELECT 
        substring(profile_id from 'NN-(\d{4})-')::integer as yr,
        substring(profile_id from 'NN-\d{4}-(\d+)')::integer as serial_num
    FROM public.profiles
    WHERE profile_id ~ '^NN-\d{4}-\d{1,3}$'
      AND substring(profile_id from 'NN-\d{4}-(\d+)')::integer < 1000
) sub
GROUP BY sub.yr
ON CONFLICT (year) DO UPDATE
SET last_serial = GREATEST(public.profile_id_tracker.last_serial, EXCLUDED.last_serial);

-- 3.3 Register all existing active profiles in public.profiles into the registry
-- ON CONFLICT DO NOTHING preserves any existing status, token_hash, or timestamps on reruns
INSERT INTO public.profile_id_registry (profile_id, registration_year, serial_number, issued_at, profile_uuid, status)
SELECT 
    profile_id,
    COALESCE(substring(profile_id from 'NN-(\d{4})-')::integer, EXTRACT(YEAR FROM CURRENT_DATE)::integer),
    COALESCE(substring(profile_id from 'NN-\d{4}-(\d+)')::integer, 0),
    COALESCE(created_at, pg_catalog.now()),
    id,
    'active'
FROM public.profiles
WHERE profile_id IS NOT NULL AND TRIM(profile_id) <> ''
ON CONFLICT (profile_id) DO NOTHING;

-- 3.4 Safely retire any legacy unverified reservations that lack a valid cryptographic token_hash
UPDATE public.profile_id_registry
SET status = 'retired', token_hash = NULL
WHERE status = 'reserved' AND (token_hash IS NULL OR TRIM(token_hash) = '');


-- =============================================================================
-- SECTION 4: SECURE ATOMIC RPC SEQUENCE GENERATOR (GENUINE 32-BYTE CSPRNG TOKEN)
-- =============================================================================

-- Drop previous function overload if return type was text
DROP FUNCTION IF EXISTS public.get_next_profile_id(integer);
DROP FUNCTION IF EXISTS public.get_next_profile_id();

CREATE OR REPLACE FUNCTION public.get_next_profile_id(p_year integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_current_year integer := EXTRACT(YEAR FROM CURRENT_DATE)::integer;
    v_year integer;
    v_next_serial integer;
    v_serial_str text;
    v_profile_id text;
    v_collision boolean := true;
    v_raw_token text;
    v_token_hash text;
    v_expires_at timestamptz;
BEGIN
    -- 1. Validate requested year: Must strictly match current year (or NULL defaulting to current year)
    -- Prevents arbitrary historical back-dating or rogue future year allocations
    IF p_year IS NULL THEN
        v_year := v_current_year;
    ELSIF p_year <> v_current_year THEN
        RAISE EXCEPTION 'Security Violation: Profile ID generation is only permitted for the current operational year (%). Requested: %', v_current_year, p_year;
    ELSE
        v_year := p_year;
    END IF;

    -- 2. Transaction-safe maintenance: Retire any expired reservations in this independent committing transaction
    UPDATE public.profile_id_registry
    SET status = 'retired', token_hash = NULL
    WHERE status = 'reserved' AND expires_at < pg_catalog.now();

    -- 3. Atomically increment sequence counter with row-level lock on tracker
    WHILE v_collision LOOP
        INSERT INTO public.profile_id_tracker (year, last_serial)
        VALUES (v_year, 1)
        ON CONFLICT (year) DO UPDATE
        SET last_serial = public.profile_id_tracker.last_serial + 1
        RETURNING last_serial INTO v_next_serial;

        -- Format serial: minimum 2 digits (01..99, then 100, 101, ...)
        IF v_next_serial < 100 THEN
            v_serial_str := pg_catalog.lpad(v_next_serial::text, 2, '0');
        ELSE
            v_serial_str := v_next_serial::text;
        END IF;

        v_profile_id := 'NN-' || v_year::text || '-' || v_serial_str;

        -- Collision check: Verify candidate ID does NOT exist in:
        -- a) Any active record in public.profiles
        -- b) Any entry in public.profile_id_registry (reserved, active, deleted, or retired)
        IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE profile_id = v_profile_id)
           AND NOT EXISTS (SELECT 1 FROM public.profile_id_registry WHERE profile_id = v_profile_id) THEN
            v_collision := false;
        END IF;
    END LOOP;

    -- 4. Generate genuine 32-byte (256-bit) cryptographically secure random token
    -- Explicitly qualifies extensions.gen_random_bytes(32) and fails safely if unavailable
    BEGIN
        v_raw_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
    EXCEPTION WHEN undefined_function THEN
        BEGIN
            v_raw_token := pg_catalog.encode(gen_random_bytes(32), 'hex');
        EXCEPTION WHEN undefined_function THEN
            RAISE EXCEPTION 'Cryptographic Failure: gen_random_bytes(32) is unavailable. Please verify pgcrypto extension is installed in schema extensions or public.';
        END;
    END;
    
    -- Compute one-way SHA-256 hash for database storage (raw token is NEVER stored in database)
    -- Explicitly resolves pg_catalog.sha256 or extensions.digest(..., 'sha256') reliably
    BEGIN
        v_token_hash := pg_catalog.encode(pg_catalog.sha256(v_raw_token::bytea), 'hex');
    EXCEPTION WHEN undefined_function THEN
        BEGIN
            v_token_hash := pg_catalog.encode(extensions.digest(v_raw_token::bytea, 'sha256'), 'hex');
        EXCEPTION WHEN undefined_function THEN
            v_token_hash := pg_catalog.encode(digest(v_raw_token::bytea, 'sha256'), 'hex');
        END;
    END;

    v_expires_at := pg_catalog.now() + interval '15 minutes';

    -- 5. Reserve ID in registry with status 'reserved' and token_hash
    INSERT INTO public.profile_id_registry (profile_id, registration_year, serial_number, issued_at, expires_at, token_hash, status)
    VALUES (v_profile_id, v_year, v_next_serial, pg_catalog.now(), v_expires_at, v_token_hash, 'reserved');

    -- Return JSON payload containing profile_id, raw one-time reservation token, and expiry timestamp
    RETURN jsonb_build_object(
        'profile_id', v_profile_id,
        'reservation_token', v_raw_token,
        'expires_at', v_expires_at
    );
END;
$$;

-- Revoke default public execution privileges
REVOKE ALL ON FUNCTION public.get_next_profile_id(integer) FROM PUBLIC;

-- Grant execution strictly to authorized registration roles (anon, authenticated, service_role)
GRANT EXECUTE ON FUNCTION public.get_next_profile_id(integer) TO anon, authenticated, service_role;


-- 4.2 Standalone Administrative Cleanup RPC for Expired Reservations
-- RESTRICTED: Exclusively for administrative maintenance / service_role. Revoked from anon and authenticated.
CREATE OR REPLACE FUNCTION public.cleanup_expired_profile_id_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_retired_count integer;
BEGIN
    UPDATE public.profile_id_registry
    SET status = 'retired', token_hash = NULL
    WHERE status = 'reserved' AND expires_at < pg_catalog.now();
    
    GET DIAGNOSTICS v_retired_count = ROW_COUNT;
    RETURN v_retired_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_profile_id_reservations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_profile_id_reservations() TO service_role;


-- =============================================================================
-- SECTION 5: PROFILE INSERT VALIDATION & ACTIVATION TRIGGERS
-- =============================================================================

-- 5.1 BEFORE INSERT: Validate supplied Profile ID and verify reservation token ownership
CREATE OR REPLACE FUNCTION public.validate_and_set_profile_id_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_year integer := EXTRACT(YEAR FROM COALESCE(NEW.created_at, CURRENT_DATE))::integer;
    v_registry_status text;
    v_registry_uuid uuid;
    v_registry_token_hash text;
    v_registry_expires_at timestamptz;
    v_auto_alloc jsonb;
    v_incoming_hash text;
BEGIN
    -- 1. If profile_id is not provided, automatically allocate a fresh reserved ID via RPC logic
    IF NEW.profile_id IS NULL OR TRIM(NEW.profile_id) = '' THEN
        v_auto_alloc := public.get_next_profile_id(v_year);
        NEW.profile_id := v_auto_alloc->>'profile_id';
        NEW.reservation_token := v_auto_alloc->>'reservation_token';
    END IF;

    NEW.profile_id := TRIM(NEW.profile_id);

    -- 2. Look up the supplied profile_id in public.profile_id_registry
    SELECT status, profile_uuid, token_hash, expires_at
    INTO v_registry_status, v_registry_uuid, v_registry_token_hash, v_registry_expires_at
    FROM public.profile_id_registry
    WHERE profile_id = NEW.profile_id;

    -- Strict lifecycle validation:
    IF v_registry_status IS NULL THEN
        RAISE EXCEPTION 'Security Violation: Profile ID % is invalid (not issued by official reservation system).', NEW.profile_id;
    ELSIF v_registry_status = 'deleted' THEN
        RAISE EXCEPTION 'Security Violation: Profile ID % was previously deleted and can NEVER be reused under any circumstances.', NEW.profile_id;
    ELSIF v_registry_status = 'retired' THEN
        RAISE EXCEPTION 'Security Violation: Profile ID % has been retired and cannot be assigned.', NEW.profile_id;
    ELSIF v_registry_status = 'active' THEN
        RAISE EXCEPTION 'Security Violation: Profile ID % is already active on profile UUID %.', NEW.profile_id, v_registry_uuid;
    ELSIF v_registry_status <> 'reserved' THEN
        RAISE EXCEPTION 'Security Violation: Profile ID % is in invalid status (%).', NEW.profile_id, v_registry_status;
    END IF;

    -- Check reservation expiration: Fails transaction clearly without false claim of rolled-back in-place update
    IF v_registry_expires_at IS NOT NULL AND v_registry_expires_at < pg_catalog.now() THEN
        RAISE EXCEPTION 'Security Violation: Reservation for Profile ID % expired at %. Please request a new Profile ID.', NEW.profile_id, v_registry_expires_at;
    END IF;

    -- 3. CRYPTOGRAPHIC RESERVATION TOKEN OWNERSHIP VALIDATION
    -- Legacy rows without token_hash or missing incoming token are strictly rejected
    IF v_registry_token_hash IS NULL OR TRIM(v_registry_token_hash) = '' THEN
        RAISE EXCEPTION 'Security Violation: Profile ID % has no valid reservation ownership token on record. It cannot be assigned.', NEW.profile_id;
    END IF;

    IF NEW.reservation_token IS NULL OR TRIM(NEW.reservation_token) = '' THEN
        RAISE EXCEPTION 'Security Violation: Profile ID % requires a valid reservation ownership token.', NEW.profile_id;
    END IF;

    -- Compute incoming token SHA-256 hash using pg_catalog.sha256 or extensions.digest
    BEGIN
        v_incoming_hash := pg_catalog.encode(pg_catalog.sha256(TRIM(NEW.reservation_token)::bytea), 'hex');
    EXCEPTION WHEN undefined_function THEN
        BEGIN
            v_incoming_hash := pg_catalog.encode(extensions.digest(TRIM(NEW.reservation_token)::bytea, 'sha256'), 'hex');
        EXCEPTION WHEN undefined_function THEN
            v_incoming_hash := pg_catalog.encode(digest(TRIM(NEW.reservation_token)::bytea, 'sha256'), 'hex');
        END;
    END;

    IF v_incoming_hash <> v_registry_token_hash THEN
        RAISE EXCEPTION 'Security Violation: Invalid reservation token for Profile ID %. Reservation ownership verification failed.', NEW.profile_id;
    END IF;

    -- 4. HARDENED PRIVACY: Wipe the raw token before the row is stored in public.profiles
    -- Ensures raw reservation tokens are NEVER persisted to disk in publicly readable tables
    NEW.reservation_token := NULL;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_and_set_profile_id ON public.profiles;
CREATE TRIGGER trg_validate_and_set_profile_id
BEFORE INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.validate_and_set_profile_id_trigger();


-- 5.2 AFTER INSERT: Transition registry status from 'reserved' to 'active' and link profile_uuid
CREATE OR REPLACE FUNCTION public.activate_profile_id_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
BEGIN
    UPDATE public.profile_id_registry
    SET status = 'active',
        profile_uuid = NEW.id,
        token_hash = NULL -- Nullify token_hash so the one-time token can never be reused
    WHERE profile_id = NEW.profile_id;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_activate_profile_id ON public.profiles;
CREATE TRIGGER trg_activate_profile_id
AFTER INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.activate_profile_id_trigger();


-- =============================================================================
-- SECTION 6: PERMANENT DELETION RETIREMENT TRIGGER
-- =============================================================================

CREATE OR REPLACE FUNCTION public.retire_profile_id_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
BEGIN
    IF OLD.profile_id IS NOT NULL AND TRIM(OLD.profile_id) <> '' THEN
        -- Permanently mark status as 'deleted' and clear token_hash.
        -- Registry entries are NEVER deleted; the counter is NEVER decremented.
        UPDATE public.profile_id_registry
        SET status = 'deleted',
            token_hash = NULL
        WHERE profile_id = OLD.profile_id;

        -- If registry entry was missing (e.g. historical profile predating the registry)
        IF NOT FOUND THEN
            INSERT INTO public.profile_id_registry (profile_id, registration_year, serial_number, issued_at, profile_uuid, status)
            VALUES (
                OLD.profile_id,
                COALESCE(substring(OLD.profile_id from 'NN-(\d{4})-')::integer, EXTRACT(YEAR FROM CURRENT_DATE)::integer),
                COALESCE(substring(OLD.profile_id from 'NN-\d{4}-(\d+)')::integer, 0),
                pg_catalog.now(),
                OLD.id,
                'deleted'
            );
        END IF;
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_retire_profile_id ON public.profiles;
CREATE TRIGGER trg_retire_profile_id
AFTER DELETE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.retire_profile_id_trigger();


-- =============================================================================
-- SECTION 7: IMMUTABILITY TRIGGER (PREVENT POST-REGISTRATION ID ALTERATION)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.prevent_profile_id_update_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
BEGIN
    IF NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
        RAISE EXCEPTION 'Security Violation: Profile ID cannot be modified once assigned (Current: %, Attempted: %).', OLD.profile_id, NEW.profile_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_id_update ON public.profiles;
CREATE TRIGGER trg_prevent_profile_id_update
BEFORE UPDATE OF profile_id ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_profile_id_update_trigger();


-- =============================================================================
-- SECTION 8: NATIVE PLACE SYNCHRONIZATION (INSERT & UPDATE)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_native_place_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- On INSERT: Bidirectional synchronization for new rows
        IF NEW.native_place IS NULL AND NEW.family_location IS NOT NULL THEN
            NEW.native_place := NEW.family_location;
        ELSIF NEW.family_location IS NULL AND NEW.native_place IS NOT NULL THEN
            NEW.family_location := NEW.native_place;
        END IF;

    ELSIF TG_OP = 'UPDATE' THEN
        -- On UPDATE: Keep both columns synchronized whenever either is updated
        IF NEW.native_place IS DISTINCT FROM OLD.native_place THEN
            NEW.family_location := NEW.native_place;
        ELSIF NEW.family_location IS DISTINCT FROM OLD.family_location THEN
            NEW.native_place := NEW.family_location;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_native_place ON public.profiles;
CREATE TRIGGER trg_sync_native_place
BEFORE INSERT OR UPDATE OF native_place, family_location ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_native_place_trigger();


-- =============================================================================
-- SECTION 9: SAFE UNIQUE CONSTRAINT ON public.profiles.profile_id
-- =============================================================================

DO $$
DECLARE
    v_dup_count integer;
BEGIN
    -- Check for duplicate Profile IDs prior to applying UNIQUE constraint
    SELECT COUNT(*) INTO v_dup_count
    FROM (
        SELECT profile_id
        FROM public.profiles
        WHERE profile_id IS NOT NULL AND TRIM(profile_id) <> ''
        GROUP BY profile_id
        HAVING COUNT(*) > 1
    ) sub;

    IF v_dup_count > 0 THEN
        RAISE NOTICE 'WARNING: Found % duplicate Profile ID group(s) in public.profiles. UNIQUE constraint was NOT applied. Run Preflight Query 1 to inspect.', v_dup_count;
    ELSE
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'uq_profiles_profile_id'
        ) THEN
            ALTER TABLE public.profiles ADD CONSTRAINT uq_profiles_profile_id UNIQUE (profile_id);
            RAISE NOTICE 'SUCCESS: UNIQUE constraint uq_profiles_profile_id created successfully.';
        END IF;
    END IF;
END $$;
