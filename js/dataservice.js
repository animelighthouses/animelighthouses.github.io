/**
 * Data access for public browse views.
 *
 * PRD mapping:
 * - 2.1 / 2.2: Sightings + joined lighthouse row for real entries
 * - Loaded once by Recent (js/main.js) and Index (js/index.js); both filter client-side
 *
 * Small dataset (~few hundred rows): full fetch every time is fine; we still cache in
 * sessionStorage for repeat navigations within the same tab (short TTL; see below).
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

