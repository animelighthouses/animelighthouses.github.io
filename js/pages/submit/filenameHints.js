/**
 * Parse episode/timestamp hints from uploaded screenshot filenames (submit.html).
 *
 * Timestamp: `NNh_NNm_NNs` with optional fractional seconds (ignored).
 * Episode: `SxxExx` first; else if `SubsPlease` in name, ` - NN (1080p)`.
 */

import { formatEpisode, formatTimestamp } from "./traceMoe.js";

const RE_TIMESTAMP = /(\d+)h_(\d+)m_(\d+)(?:\.\d+)?s/gi;
const RE_EPISODE_SXE = /S\d+E(\d+)/gi;
const RE_EPISODE_SUBSPLEASE = /- (\d+) \(1080p\)/gi;

/** @param {string} filename */
function lastRegexMatch(re, filename) {
  const source = String(filename ?? "");
  re.lastIndex = 0;
  let match;
  let last = null;
  while ((match = re.exec(source)) !== null) last = match;
  return last;
}

/**
 * @param {string} filename
 * @returns {string} `hh:mm:ss` or ""
 */
export function parseFilenameTimestamp(filename) {
  const match = lastRegexMatch(RE_TIMESTAMP, filename);
  if (!match) return "";

  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const s = parseInt(match[3], 10);
  if (![h, m, s].every(n => Number.isFinite(n) && n >= 0)) return "";

  return formatTimestamp(h * 3600 + m * 60 + s);
}

/**
 * @param {string} filename
 * @returns {string} Episode label (e.g. `E07`) or ""
 */
export function parseFilenameEpisode(filename) {
  const name = String(filename ?? "");

  const sxe = lastRegexMatch(RE_EPISODE_SXE, name);
  if (sxe) return formatEpisode(sxe[1]);

  if (!/subsplease/i.test(name)) return "";

  const sp = lastRegexMatch(RE_EPISODE_SUBSPLEASE, name);
  if (!sp) return "";

  return formatEpisode(sp[1]);
}

/**
 * @param {string} filename
 * @returns {{ timestamp: string, episode: string }}
 */
export function parseFilenameHints(filename) {
  return {
    timestamp: parseFilenameTimestamp(filename),
    episode: parseFilenameEpisode(filename)
  };
}
