/**
 * Single Supabase client for the browser.
 *
 * Depends on the global from the CDN script in each HTML page:
 *   https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2
 *
 * PRD 3: Postgres on Supabase — RLS should enforce who can write; anon key is typical for SPAs.
 */

const supabaseClient = supabase.createClient(
  "https://ogningqqgxhwkmozikmu.supabase.co",
  "sb_publishable_Q9SEFHhKlsG05lL4dmrSqw_hwbvmEAB"
);

export default supabaseClient;

