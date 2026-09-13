// supabase-config.js

// =====================================================================
// SUPABASE CONFIGURATION
// =====================================================================
// Replace these with your actual Supabase project URL and ANON (Publishable) key.
// Do NOT place your "service_role" (secret) key here!
const SUPABASE_URL = "https://xaemytjqdjsqhjclgtgi.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_2qDYWWIHnoZRMRLTGpjZSA_IkIbCpfH";

// Initialize Supabase Client
window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
