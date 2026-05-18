/**
 * URL path for the shared single-sighting page.
 *
 * @param {number|string} id
 * @returns {string}
 */
export function sightingSharePath(id) {
  return `/sighting?id=${encodeURIComponent(id)}`;
}
