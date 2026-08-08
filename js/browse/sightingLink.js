/**
 * URL helpers for the shared single-sighting page.
 *
 * @param {number|string} id
 * @returns {string}
 */
export function sightingSharePath(id) {
  return `/sighting?id=${encodeURIComponent(id)}`;
}

const PRODUCTION_ORIGIN = "https://www.toudai.moe";

/**
 * Absolute production URL for a sighting (for clipboard / external embeds).
 *
 * @param {number|string} id
 * @returns {string}
 */
export function sightingShareAbsoluteUrl(id) {
  return `${PRODUCTION_ORIGIN}${sightingSharePath(id)}`;
}

/**
 * AniList-compatible markdown: visible image hotlink wrapped in a sighting URL.
 *
 * @param {string} imageUrl
 * @param {number|string} id
 * @returns {string}
 */
export function anilistSightingMarkdown(imageUrl, id) {
  return `[ img420(${imageUrl}) ](${sightingShareAbsoluteUrl(id)})`;
}
