/**
 * AniList GraphQL client + the title-fill chain shared by sighting submit
 * (manual Fetch button, trace.moe accept, SauceNAO accept).
 *
 * AniList is queried directly from the browser via their public GraphQL
 * endpoint. The chain only ever overwrites blank title fields and refines
 * the cached media_type — deliberately conservative so user edits are safe.
 */

const ANILIST_GRAPHQL_ENDPOINT = "https://graphql.anilist.co";

/**
 * Extract media type + numeric id from an `anilist.co/anime/<id>` or
 * `anilist.co/manga/<id>` URL.
 *
 * @param {string} url
 * @returns {{type: "anime"|"manga", id: string} | null}
 */
export function parseAniListUrl(url) {
  try {
    const match = String(url ?? "")
      .trim()
      .match(/(?:https?:\/\/)?(?:www\.)?anilist\.co\/(anime|manga)\/(\d+)\/?/i);
    if (!match) return null;
    return {
      type: /** @type {"anime"|"manga"} */ (match[1].toLowerCase()),
      id: match[2],
    };
  } catch {
    return null;
  }
}

/**
 * Canonical https AniList media URL, or null if not parseable.
 *
 * @param {string} url
 * @returns {string | null}
 */
export function canonicalAniListUrl(url) {
  const parsed = parseAniListUrl(url);
  if (!parsed) return null;
  return `https://anilist.co/${parsed.type}/${parsed.id}`;
}

/**
 * Fetch romaji/english/native titles + media type from AniList by numeric id.
 * Returns the `Media` object or null when not found.
 */
export async function fetchAniListById(id) {
  const query = `
    query ($id: Int) {
      Media(id: $id) {
        title { romaji english native }
        type
      }
    }
  `;
  const res = await fetch(ANILIST_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { id: Number(id) } })
  });
  const json = await res.json();
  return json?.data?.Media ?? null;
}

/**
 * Fill blank title inputs from an AniList `Media` row and refine the media_type
 * cache via `setMediaType`. Existing non-blank inputs are never overwritten.
 *
 * @param {HTMLFormElement | null | undefined} form
 * @param {{title?: {english?: string|null, romaji?: string|null, native?: string|null}, type?: string|null} | null} media
 * @param {{setMediaType?: (t: string) => void}} [refs]
 */
export function applyAniListMediaToBlankTitles(form, media, refs = {}) {
  if (!form || !media) return;

  const titleEnEl = form.querySelector('[name="title_en"]');
  const titleREl = form.querySelector('[name="title_r"]');
  const titleJpEl = form.querySelector('[name="title_jp"]');

  const isEmpty = el => !el || !el.value.trim();
  if (isEmpty(titleEnEl)) {
    titleEnEl.value = media.title?.english || media.title?.romaji || "";
  }
  if (isEmpty(titleREl)) titleREl.value = media.title?.romaji || "";
  if (isEmpty(titleJpEl)) titleJpEl.value = media.title?.native || "";

  if (media.type && typeof refs.setMediaType === "function") {
    refs.setMediaType(String(media.type).toLowerCase());
  }
}

/**
 * Convenience: fetch by id then apply to the form. Swallowed on failure
 * (logs a warning) since this is always a best-effort enrichment after the
 * user has already accepted a primary lookup result.
 */
export async function fetchAndApplyAniList(id, form, refs) {
  try {
    const media = await fetchAniListById(id);
    applyAniListMediaToBlankTitles(form, media, refs);
    return media;
  } catch (e) {
    console.warn("AniList auto-fetch failed:", e);
    return null;
  }
}

/**
 * Mutable media-id/type cache used by the sighting form (shared across the
 * AniList Fetch button and the trace.moe / SauceNAO accept paths).
 *
 * @typedef {{id: string|null, type: string|null}} MediaCache
 * @returns {MediaCache}
 */
export function createMediaCache() {
  return { id: null, type: null };
}

/**
 * Apply an accepted lookup result's AniList id to the form and chain a
 * GraphQL lookup for blank-title fill + media_type refinement.
 *
 * Conservative: never overwrites the AniList input or cached id/type when
 * already present; only fills blank title fields.
 *
 * @param {{
 *   form: HTMLFormElement | null,
 *   anilistInput: HTMLInputElement | null,
 *   anilistId: string | number | null,
 *   mediaCache: MediaCache,
 * }} args
 */
export function acceptAniListId({ form, anilistInput, anilistId, mediaCache }) {
  if (!anilistId) return;
  if (mediaCache.id == null) mediaCache.id = String(anilistId);
  if (mediaCache.type == null) mediaCache.type = "anime";
  if (anilistInput && !anilistInput.value.trim()) {
    anilistInput.value = `https://anilist.co/anime/${anilistId}`;
  }
  // Fire-and-forget AniList enrichment (best effort).
  fetchAndApplyAniList(anilistId, form, {
    setMediaType: t => {
      mediaCache.type = t;
    }
  });
}
