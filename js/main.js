/**
 * Recent sightings view for index.html: paginated cards and shared filter panel.
 *
 * Fetches all sightings once (with cache in dataservice), filters/sorts client-side
 * via common.js, and marks the Recent/Index tab via nav.js.
 */

import { fetchSightings } from "./dataservice.js";
import { readStoredTitleMode } from "./preferences.js";
import { initViewNav } from "./nav.js";
import {
  bindAppearanceMode,
  bindCommonControls,
  bindFilterPanelToggle,
  buildSightingCard,
  filterAndSortSightings,
  populateLighthouseFilter,
  scrollWindowToElementTop
} from "./common.js";

const app = document.getElementById("app");

/** Zero-based page index; reset when filters/search/sort change */
let currentPage = 0;
const pageSize = 10;
let allData = [];

const state = {
  searchTerm: "",
  titleMode: readStoredTitleMode("title_r"),
  showAnime: true,
  showManga: true,
  realOnly: false,
  sortMode: "newest",
  /** When set, only sightings with this lighthouse_id (merged JSON from Supabase) */
  lighthouseId: null
};

/** Renders current page slice + pagination bar */
function renderPage() {
  const processed = filterAndSortSightings(allData, state);
  app.innerHTML = "";

  const start = currentPage * pageSize;
  const end = start + pageSize;

  const pageItems = processed.slice(start, end);
  pageItems.forEach(entry => {
    app.appendChild(buildSightingCard(entry, { titleMode: state.titleMode }));
  });

  renderPagination(processed.length);
}

/** Classic << < range > >> controls anchored after the cards */
function renderPagination(totalItems) {
  const totalPages = Math.ceil(totalItems / pageSize);
  const start = currentPage * pageSize;
  const end = start + pageSize;

  const wrapper = document.createElement("div");
  wrapper.className = "pagination";

  const first = document.createElement("button");
  first.textContent = "<<";
  first.disabled = currentPage === 0;
  first.onclick = () => {
    currentPage = 0;
    renderPage();
    scrollWindowToElementTop(app);
  };
  wrapper.appendChild(first);

  const prev = document.createElement("button");
  prev.textContent = "<";
  prev.disabled = currentPage === 0;
  prev.onclick = () => {
    currentPage--;
    renderPage();
    scrollWindowToElementTop(app);
  };
  wrapper.appendChild(prev);

  const label = document.createElement("div");
  label.textContent = `${start + 1}–${Math.min(end, totalItems)} of ${totalItems}`;
  wrapper.appendChild(label);

  const next = document.createElement("button");
  next.textContent = ">";
  next.disabled = currentPage >= totalPages - 1;
  next.onclick = () => {
    currentPage++;
    renderPage();
    scrollWindowToElementTop(app);
  };
  wrapper.appendChild(next);

  const last = document.createElement("button");
  last.textContent = ">>";
  last.disabled = currentPage >= totalPages - 1;
  last.onclick = () => {
    currentPage = totalPages - 1;
    renderPage();
    scrollWindowToElementTop(app);
  };
  wrapper.appendChild(last);

  app.appendChild(wrapper);
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
