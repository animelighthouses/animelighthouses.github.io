/**
 * Client-side filter, sort, and lighthouse-dropdown logic for browse views.
 *
 * The Recent and List views fetch all sightings once (via dataservice.js +
 * sessionStorage cache) and then run this pipeline in memory on every state
 * change. The dataset is small enough (~hundreds of rows) that this is
 * cheaper than refetching.
 */

/**
 * @typedef {object} BrowseState
 * @property {string} searchTerm   Lower-case search term (already debounced).
 * @property {string} titleMode    Active title field: "title_en" | "title_r" | "title_jp".
 * @property {string} [navPosition] "top" | "bottom" | "both" (Recent only).
 * @property {boolean} showAnime
 * @property {boolean} showManga
 * @property {boolean} realOnly
 * @property {string} sortMode      "newest" | "oldest" | "az" | "za".
 * @property {number | null} lighthouseId
 */

/** Default filter-panel fields for Recent (index.html). */
export const RECENT_FILTER_DEFAULTS = {
  searchTerm: "",
  showAnime: true,
  showManga: true,
  realOnly: false,
  sortMode: "newest",
  lighthouseId: null
};

/** Default filter-panel fields for List (list.html). */
export const INDEX_FILTER_DEFAULTS = {
  ...RECENT_FILTER_DEFAULTS,
  sortMode: "az"
};

/**
 * Match a row against the user's search term.
 *
 * Recurses one level deep so that joined `lighthouses` columns are searched
 * alongside top-level fields. Arrays (e.g. `image_link`) are joined as
 * strings; nested objects beyond one level are intentionally ignored.
 */
function matchesSearch(entry, searchTerm) {
  if (!searchTerm) return true;

  return Object.values(entry).some(value => {
    if (!value) return false;

    if (Array.isArray(value)) {
      return value.some(v => String(v).toLowerCase().includes(searchTerm));
    }

    if (typeof value === "object") {
      return Object.values(value).some(v => v && String(v).toLowerCase().includes(searchTerm));
    }

    return String(value).toLowerCase().includes(searchTerm);
  });
}

/** Sort then filter; returns a new array (does not mutate `allData`). */
export function filterAndSortSightings(allData, state) {
  const processed = [...allData];

  processed.sort((a, b) => {
    switch (state.sortMode) {
      case "oldest":
        return new Date(a.date_spotted) - new Date(b.date_spotted);
      case "az":
        return (a[state.titleMode] || "").localeCompare(b[state.titleMode] || "");
      case "za":
        return (b[state.titleMode] || "").localeCompare(a[state.titleMode] || "");
      case "newest":
      default:
        return new Date(b.date_spotted) - new Date(a.date_spotted);
    }
  });

  return processed.filter(entry => {
    if (!matchesSearch(entry, state.searchTerm)) return false;

    if (
      (entry.media_type === "anime" && !state.showAnime) ||
      (entry.media_type === "manga" && !state.showManga)
    ) return false;

    if (state.realOnly && entry.lighthouse_type !== "real") return false;

    if (
      state.lighthouseId != null &&
      Number(entry.lighthouse_id) !== Number(state.lighthouseId)
    ) {
      return false;
    }

    return true;
  });
}

/** Build #lighthouse-filter options from merged sighting rows (uses lighthouses join when present). */
export function populateLighthouseFilter(allData, state) {
  const sel = document.getElementById("lighthouse-filter");
  if (!sel || !state) return;

  const byId = new Map();
  for (const row of allData) {
    const lid = row.lighthouse_id;
    if (lid == null || lid === "") continue;

    const idNum = Number(lid);
    if (Number.isNaN(idNum) || byId.has(idNum)) continue;

    const name =
      row.lighthouses?.name_en?.trim() ||
      row.lighthouses?.name_jp?.trim() ||
      `Lighthouse (${idNum})`;
    byId.set(idNum, name);
  }

  const pairs = [...byId.entries()].sort((a, b) =>
    a[1].localeCompare(b[1], undefined, { sensitivity: "base" })
  );

  sel.replaceChildren();

  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = "All lighthouses";
  sel.appendChild(allOpt);

  for (const [idNum, label] of pairs) {
    const opt = document.createElement("option");
    opt.value = String(idNum);
    opt.textContent = label;
    sel.appendChild(opt);
  }

  const current = state.lighthouseId != null ? String(state.lighthouseId) : "";
  if (current && [...byId.keys()].includes(Number(current))) sel.value = current;
  else {
    sel.value = "";
    state.lighthouseId = null;
  }
}
