/**
 * SauceNAO backup identification (https://saucenao.com/user.php?page=search-api).
 *
 * The browser cannot call SauceNAO directly due to CORS. We invoke the
 * Supabase Edge Function `saucenao-proxy` via the authenticated client; the
 * function forwards to SauceNAO and returns the raw JSON.
 *
 * Behaviour preserved from the original submit-sighting.js:
 * - search constrained to the Anime* index (db=21)
 * - similarity is a percent string; thresholds tuned separately from trace.moe
 * - on Insert click: episode + timestamp ALWAYS overwrite; AniList side fills only when blank
 *
 * The API key is stored in localStorage (never committed) and sent inside the
 * proxy request body so the upstream sees it as a normal SauceNAO query.
 */

import supabaseClient from "../../supabaseClient.js";

/** Anime* index: yields `part` (episode) + `est_time` (timestamp/duration) when available. */
const SAUCENAO_DB_ANIME = 21;

/** localStorage key for the user's personal SauceNAO API key. */
const SAUCENAO_STORAGE_KEY = "animelighthouse.saucenaoKey";

/** Three-tier thresholds (percent). */
export const SAUCE_HIGH = 80;
export const SAUCE_LOW = 60;

/** Read the SauceNAO key from localStorage; "" when missing or unavailable. */
export function getSauceKey() {
  try {
    return localStorage.getItem(SAUCENAO_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

/** Persist (or clear) the SauceNAO key in localStorage. */
export function setSauceKey(value) {
  const v = String(value ?? "").trim();
  try {
    if (v) localStorage.setItem(SAUCENAO_STORAGE_KEY, v);
    else localStorage.removeItem(SAUCENAO_STORAGE_KEY);
  } catch (_) {
    // Private mode / storage disabled — silently ignore.
  }
}

/** Anime* est_time format: "<timestamp> / <episode length>"; we keep the left side. */
export function parseSauceEstTime(estTime) {
  const raw = String(estTime ?? "");
  const left = raw.split("/")[0]?.trim() ?? "";
  return left;
}

/**
 * Single query function for both image-source modes.
 *
 * @param {{kind: "file", file: File} | {kind: "url", url: string}} source
 * @returns {Promise<object>} Raw SauceNAO JSON response (parsed by edge function).
 */
export async function querySauceNao(source) {
  const key = getSauceKey();
  if (!key) throw new Error("Missing SauceNAO API key.");

  const payload = {
    apiKey: key,
    db: SAUCENAO_DB_ANIME,
    numres: 3,
    dedupe: 2
  };

  if (source.kind === "url") {
    const { data, error } = await supabaseClient.functions.invoke("saucenao-proxy", {
      body: { ...payload, url: source.url }
    });
    if (error) throw error;
    return data;
  }

  // Upload mode: send image bytes as a base64 data URL to the edge function.
  const imageBase64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(source.file);
  });

  const { data, error } = await supabaseClient.functions.invoke("saucenao-proxy", {
    body: { ...payload, imageBase64 }
  });
  if (error) throw error;
  return data;
}

/** Map a percent similarity to a confidence tier label. */
export function tierFromSimilarity(percent) {
  const sim = Number.parseFloat(percent ?? "0");
  if (sim < SAUCE_LOW) return "low";
  return sim >= SAUCE_HIGH ? "high" : "mid";
}
