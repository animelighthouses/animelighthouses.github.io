/**
 * Recent sightings view for index.html: paginated cards and shared filter panel.
 *
 * Fetches all sightings once (with cache in dataservice), filters/sorts client-side
 * via js/browse/, and marks the Recent/Index tab via nav.js.
 */

import { fetchSightings } from "./dataservice.js";
import { readStoredNavPosition, readStoredTitleMode } from "./preferences.js";
import { initViewNav } from "./nav.js";
import {
  bindAppearanceMode,
  bindCommonControls,
  bindFilterPanelToggle,
  buildSightingCard,
  closeLightboxIfOpen,
  filterAndSortSightings,
  populateLighthouseFilter,
  scrollWindowToElementTop
} from "./browse/index.js";

const app = document.getElementById("app");

/** Zero-based page index; reset when filters/search/sort change */
let currentPage = 0;
const pageSize = 10;
/** @type {import("./dataservice.js").SightingRow[]} */
let allData = [];

/** Keep preloaded Image objects alive (url -> Image). */
const preloadImageByUrl = new Map();

/** @type {import("./browse/filters.js").BrowseState} */
const state = {
  searchTerm: "",
  titleMode: readStoredTitleMode("title_r"),
  navPosition: readStoredNavPosition("bottom"),
  showAnime: true,
  showManga: true,
  realOnly: false,
  sortMode: "newest",
  lighthouseId: null
};

function preloadPageHeroImages(processed, pageIndex) {
  const start = pageIndex * pageSize;
  const end = start + pageSize;
  const items = processed.slice(start, end);
  if (!items.length) return;

  for (const entry of items) {
    const url = entry?.image_link?.[0];
    if (!url || preloadImageByUrl.has(url)) continue;
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    preloadImageByUrl.set(url, img);
  }
}

/** Renders current page slice + pagination bar */
function renderPage() {
  // Card DOM is wiped below; close any open lightbox so its active controller
  // doesn't reference an orphaned card image.
  closeLightboxIfOpen();
  const processed = filterAndSortSightings(allData, state);
  app.innerHTML = "";

  const start = currentPage * pageSize;
  const end = start + pageSize;

  const shouldTop = state.navPosition === "top" || state.navPosition === "both";
  const shouldBottom =
    state.navPosition === "bottom" || state.navPosition === "both" || !state.navPosition;

  if (shouldTop) {
    app.appendChild(createPagination(processed.length, { scrollAfter: "lastCardTop" }));
  }

  const pageItems = processed.slice(start, end);
  pageItems.forEach(entry => {
    app.appendChild(
      buildSightingCard(entry, {
        titleMode: state.titleMode,
        recentImageSlot: true
      })
    );
  });

  if (shouldBottom) {
    app.appendChild(createPagination(processed.length, { scrollAfter: "top" }));
  }

  // Preload the next page's hero URLs via Image(); current page uses lazy <img> in the slot.
  preloadPageHeroImages(processed, currentPage + 1);
}

function scrollAfterPageChange(scrollAfter) {
  if (scrollAfter === "lastCardTop") {
    const cards = app.querySelectorAll(".card");
    const lastCard = cards.length ? cards[cards.length - 1] : null;
    if (lastCard) scrollWindowToElementTop(lastCard);
    else scrollWindowToElementTop(app);
    return;
  }
  scrollWindowToElementTop(app);
}

/** Classic << < range > >> controls */
function createPagination(totalItems, { scrollAfter = "top" } = {}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const start = currentPage * pageSize;
  const end = start + pageSize;

  const safeTotal = Math.max(0, Number(totalItems) || 0);
  const labelStart = safeTotal === 0 ? 0 : start + 1;
  const labelEnd = Math.min(end, safeTotal);

  const wrapper = document.createElement("div");
  wrapper.className = "pagination";

  const first = document.createElement("button");
  first.textContent = "<<";
  first.disabled = currentPage === 0;
  first.onclick = () => {
    currentPage = 0;
    renderPage();
    scrollAfterPageChange(scrollAfter);
  };
  wrapper.appendChild(first);

  const prev = document.createElement("button");
  prev.textContent = "<";
  prev.disabled = currentPage === 0;
  prev.onclick = () => {
    currentPage--;
    renderPage();
    scrollAfterPageChange(scrollAfter);
  };
  wrapper.appendChild(prev);

  const label = document.createElement("div");
  label.className = "pagination-label";
  label.textContent = `${labelStart}–${labelEnd} of ${safeTotal}`;
  wrapper.appendChild(label);

  const next = document.createElement("button");
  next.textContent = ">";
  next.disabled = currentPage >= totalPages - 1;
  next.onclick = () => {
    currentPage++;
    renderPage();
    scrollAfterPageChange(scrollAfter);
  };
  wrapper.appendChild(next);

  const last = document.createElement("button");
  last.textContent = ">>";
  last.disabled = currentPage >= totalPages - 1;
  last.onclick = () => {
    currentPage = totalPages - 1;
    renderPage();
    scrollAfterPageChange(scrollAfter);
  };
  wrapper.appendChild(last);

  return wrapper;
}

async function init() {
  initViewNav();
  allData = await fetchSightings();
  populateLighthouseFilter(allData, state);
  bindFilterPanelToggle();
  bindAppearanceMode();
  bindCommonControls(state, () => {
    currentPage = 0;
    renderPage();
  });
  renderPage();
}

init();
