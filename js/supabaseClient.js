/**
 * Single Supabase client for the browser (default export).
 *
 * Requires the global `supabase` from the CDN script on each HTML page:
 *   https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2
 *
 * Uses the publishable anon key; Postgres RLS policies should restrict writes to trusted users.
 */

const supabaseClient = supabase.createClient(
  "https://ogningqqgxhwkmozikmu.supabase.co",
  "sb_publishable_Q9SEFHhKlsG05lL4dmrSqw_hwbvmEAB"
);

export default supabaseClient;

