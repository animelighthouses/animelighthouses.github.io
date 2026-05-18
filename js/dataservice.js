/**
 * Public read access: fetch all sightings with nested `lighthouses` row.
 *
 * Used by js/main.js and js/index.js; both pages filter and sort in memory.
 * Results are cached in sessionStorage for a short TTL to limit repeat requests.
 */

import supabaseClient from "./supabaseClient.js";

/**
 * Sighting row shape returned by Supabase (mirrors docs/SCHEMA.txt).
 *
 * `lighthouses` is the embedded join row populated when `lighthouse_id` is
 * non-null and a matching row exists in `public.lighthouses`.
 *
 * @typedef {object} LighthouseRow
 * @property {number} id
 * @property {string|null} name_en
 * @property {string|null} name_jp
 * @property {string|null} wiki_en
 * @property {string|null} wiki_jp
 * @property {string|null} lighthouse_japan_link
 * @property {string|null} google_maps_link
 * @property {string|null} notes_l
 * @property {string|null} prefecture
 *
 * @typedef {object} SightingRow
 * @property {number} id
 * @property {string} date_spotted              ISO `YYYY-MM-DD` (required column).
 * @property {string|null} title_en
 * @property {string|null} title_r
 * @property {string|null} title_jp
 * @property {string|null} media_id
 * @property {string|null} anilist_link
 * @property {string|null} episode
 * @property {string|null} timestamp
 * @property {number|null} lighthouse_id
 * @property {string[]|null} image_link         Public Storage URLs.
 * @property {"real"|"fictional"|"unidentified"} lighthouse_type
 * @property {"anime"|"manga"|"other"} media_type
 * @property {string|null} notes
 * @property {LighthouseRow|null} [lighthouses] Join row when `lighthouse_id` is set.
 */

/** Bump if cache shape changes */
const SIGHTINGS_CACHE_KEY = "animelighthouses.sightings.v1";
/** Max age before refetch (ms). Keeps session fresh without hammering Supabase. */
const SIGHTINGS_CACHE_TTL_MS = 5 * 60 * 1000;

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

/**
 * Fetch every `public.sightings` row with the nested `lighthouses` join.
 * Results are cached in sessionStorage for `SIGHTINGS_CACHE_TTL_MS`.
 *
 * @returns {Promise<SightingRow[]>}
 */
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

/**
 * Fetch one sighting by primary key (shared sighting page).
 *
 * @param {number} id
 * @returns {Promise<SightingRow|null>}
 */
export async function fetchSightingById(id) {
  const { data, error } = await supabaseClient
    .from("sightings")
    .select(`
      *,
      lighthouses (*)
    `)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("Error fetching sighting:", error);
    return null;
  }

  return data;
}
