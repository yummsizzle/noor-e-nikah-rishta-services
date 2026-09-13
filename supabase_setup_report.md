# Supabase Setup & Migration Report

## 1. Supabase Project Configuration
The project is connected to Supabase using the Web SDK (via CDN).
You must provide your `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `supabase-config.js` to complete the connection.

## 2. Database Schema
A new PostgreSQL table `public.profiles` has been designed to strictly hold the existing Noor-E-Nikah profile registration form fields. All columns are in standard `snake_case`, while a two-way mapping layer has been added in the Admin panel to transparently present the data exactly as the UI originally expected it (e.g., `Mother Occupation` maps to `mother_occupation`). 

**Primary Key**: `id uuid primary key default gen_random_uuid()`
**Timestamps**: `created_at` and `updated_at` (default `now()`).

## 3. RLS Policies
Row Level Security (RLS) is STRICTLY enabled on `public.profiles`.
- **PUBLIC**: Can only `INSERT` (to submit the registration form).
- **ADMIN (Authenticated)**: Can `SELECT`, `UPDATE`, and `DELETE`.
Public users cannot list, view, edit, or delete any profile.

## 4. Storage Bucket
A **PRIVATE** bucket named `profile-photos` has been created for candidate photos. 
- **PUBLIC**: Can upload photos during form submission.
- **ADMIN (Authenticated)**: Can view and delete photos.
A "View Photo" button was integrated into the Admin profile modal which generates a short-lived signed URL for safe admin-only viewing.

## 5. Auth Implementation
The admin panel uses Supabase Auth (Email + Password) via `supabase.auth.signInWithPassword()` and maintains session using `supabase.auth.onAuthStateChange()`. Unauthenticated users are hard-redirected to the login screen.

## 6. LocalStorage Migration Status
The Admin dashboard includes a "Migrate Local Data to Supabase" button. When clicked, it parses the legacy `localStorage` data, applies the strict UI-to-DB column mapping, checks for duplicates using `profile_id`, and safely pushes existing candidate records to the Supabase database.

## 7. Files Changed
- `index.html`: Replaced Firebase with Supabase scripts, re-wrote form submission.
- `admin/index.html`: Replaced Firebase with Supabase scripts, updated migration button label.
- `admin/admin.js`: Replaced all Firebase API calls with Supabase JS v2 client calls. Introduced database field mapping logic and signed URL photo viewing.
- `supabase-config.js`: (NEW) Contains your Supabase initialization.
- `supabase_schema.sql`: (NEW) Contains the exact SQL commands required to set up your database and RLS policies.

## 8. Files Deprecated
Firebase files have been retained but marked as obsolete to avoid accidental usage:
- `firebase-config.js` -> `firebase-config.js.deprecated`
- `firestore.rules` -> `firestore.rules.deprecated`
- `storage.rules` -> `storage.rules.deprecated`

## 9. Browser E2E Test Results
**BLOCKED - PENDING MANUAL CONFIGURATION.**
Because your Supabase URL and Publishable Key are required to make genuine requests to the database, I could not complete the automated E2E browser tests without them. I have fully written the code strictly according to the Supabase JS v2 API, but the browser will report a connection error until the values are supplied.

## 10. Remaining Manual Steps (Required)

Before the application will work, you **must** perform these exact steps:

1. Open `supabase-config.js` and paste your actual `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` where indicated.
2. Go to your **Supabase Dashboard** -> **SQL Editor** -> **New Query**.
3. Open `supabase_schema.sql` (found in the project root), copy all of its contents, and paste it into the Supabase SQL Editor.
4. Click **Run** to execute the query. This will instantly create your table, bucket, and all strict security policies.
5. Go to **Authentication -> Users** in Supabase and create a new Admin user with your desired Email and Password. 
6. Open the project in your browser and perform the E2E tests manually.
