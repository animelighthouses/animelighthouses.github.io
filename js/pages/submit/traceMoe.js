/**
 * trace.moe screenshot identification (https://soruly.github.io/trace.moe-api/).
 *
 * Shipped behavior preserved from the original submit-sighting.js:
 * - anonymous tier (no API key); upload mode posts raw bytes, URL mode passes
 *   the source URL via query string; `anilistInfo=1` expands titles, `cutBorders` trims letterbox
 * - three-tier confidence (TRACE_HIGH auto-accepts visually, TRACE_LOW is the failure floor)
 * - on Insert click: episode + timestamp ALWAYS overwrite; AniList side fills only when blank
 *
 * Episode formatter exposed here is reused by sauceNao.js for visual parity.
 */

import { resolveLookupImageUrl } from "../../imgurProxy.js";

const TRACE_MOE_ENDPOINT = "https://api.trace.moe/search?anilistInfo=1&cutBorders";

/** Three-tier thresholds; tweak if matches feel too permissive or too strict. */
export const TRACE_HIGH = 0.9;
export const TRACE_LOW = 0.75;

/** Numeric -> `E<nn>` (0-9 padded to two digits); non-numeric pass-through (e.g. "OVA"). */
export function formatEpisode(ep) {
  if (ep == null || ep === "") return "";
  const s = String(ep);
  if (!/^\d+$/.test(s)) return s;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n)) return s;
  if (n >= 0 && n <= 9) return `E${String(n).padStart(2, "0")}`;
  return `E${s}`;
}

/** Seconds-from-start (float) -> `hh:mm:ss`. */
export function formatTimestamp(secondsFromStart) {
  if (typeof secondsFromStart !== "number" || !Number.isFinite(secondsFromStart)) return "";
  const total = Math.max(0, Math.floor(secondsFromStart));
  const hh = String(Math.floor(total / 3600)).padStart(2, "0");
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * Single query function for both image-source modes.
 *
 * @param {{kind: "file", file: File} | {kind: "url", url: string}} source
 * @returns {Promise<object>} The top result (highest similarity).
 */
export async function queryTraceMoe(source) {
  let url;
  let init;
  if (source.kind === "url") {
    const u = resolveLookupImageUrl(String(source.url ?? "").trim());
    if (!u) throw new Error("Please enter an image URL.");
    url = `${TRACE_MOE_ENDPOINT}&url=${encodeURIComponent(u)}`;
  } else {
    if (!source.file) throw new Error("Please select an image file.");
    url = TRACE_MOE_ENDPOINT;
    init = {
      method: "POST",
      headers: { "Content-Type": source.file.type || "application/octet-stream" },
      body: source.file
    };
  }

  const res = await fetch(url, init);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`trace.moe ${res.status}: ${txt || res.statusText}`);
  }
  const json = await res.json();
  const top = Array.isArray(json?.result) ? json.result[0] : null;
  if (!top) throw new Error("No match returned.");
  return top;
}

/** Map a similarity score (0..1) to a confidence tier label. */
export function tierFromConfidence(conf) {
  if (conf < TRACE_LOW) return "low";
  return conf >= TRACE_HIGH ? "high" : "mid";
}
