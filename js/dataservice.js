/**
 * Public read access: fetch all sightings with nested `lighthouses` row.
 *
 * Used by js/main.js and js/index.js; both pages filter and sort in memory.
 * Results are cached in sessionStorage for a short TTL to limit repeat requests.
 */

import supabaseClient from "./supabaseClient.js";

/** Bump if cache shape changes */
const SIGHTINGS_CACHE_KEY = "animelighthouses.sightings.v1";
/** Max age before refetch (ms). Keeps session fresh without hammering Supabase. */
const SIGHTINGS_CACHE_TTL_MS = 10 * 60 * 1000;

function readSightingsCache() {
  try {
    const raw = sessionStorage.getItem(SIGHTINGS_CACHE_KEY);
    if (!raw) return null;
    const { ts, rows } = JSON.parse(raw);
    if (!ts || !Array.isArray(rows)) return null;
    if (Date.now() - ts > SIGHTINGS_CACHE_TTL_MS) {
      sessionStorage.removeItem(SIGHTINGS_CACHE_KEY);
      return null;
    }
    return rows;
  } catch {
    try {
      sessionStorage.removeItem(SIGHTINGS_CACHE_KEY);
    } catch {
      /* ignore */
    }
    return null;
  }
}

function writeSightingsCache(rows) {
  try {
    sessionStorage.setItem(
      SIGHTINGS_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), rows })
    );
  } catch {
    /* quota / private mode — skip cache */
  }
}

export async function fetchSightings() {
  const cached = readSightingsCache();
  if (cached) return cached;

  const { data, error } = await supabaseClient
    .from("sightings")
    .select(`
      *,
      lighthouses (*)
    `)
    .order("id", { ascending: false });

  if (error) {
    console.error("Error fetching data:", error);
    return [];
  }

  const rows = data ?? [];
  writeSightingsCache(rows);
  return rows;
}

