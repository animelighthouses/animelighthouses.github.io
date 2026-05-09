/**
 * Single Supabase client for the browser (default export).
 *
 * Requires the global `supabase` from the CDN script on each HTML page:
 *   https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2
 *
 * NOTE: The publishable anon key below is intentionally committed and shipped
 * to every browser. The real security boundary is Postgres Row-Level Security
 * (see docs/SCHEMA.txt) — never the client. Treat any UI gating in this repo
 * as ergonomic only.
 */

const supabaseClient = supabase.createClient(
  "https://ogningqqgxhwkmozikmu.supabase.co",
  "sb_publishable_Q9SEFHhKlsG05lL4dmrSqw_hwbvmEAB"
);

export default supabaseClient;
