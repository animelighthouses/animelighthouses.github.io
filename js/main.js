/**
 * Recent sighting view (home) — index.html
 *
 * PRD:
 * - 2.2: Blog-style recent list, paginated
 * - 2.4–2.7: Search, filters, sort, title mode (shared control panel in HTML)
 * - 2.6: titleMode drives card titles via buildSightingCard
 *
 * File layout: imports → constants/state → render helpers → init
 */

import { fetchSightings } from "./dataservice.js";
import {
  bindCommonControls,
  bindFilterPanelToggle,
  buildSightingCard,
  filterAndSortSightings,
  populateLighthouseFilter
} from "./ui/common.js";

const app = document.getElementById("app");

/** Zero-based page index; reset when filters/search/sort change */
let currentPage = 0;
const pageSize = 10;
let allData = [];

const state = {
  searchTerm: "",
  titleMode: "title_r",
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
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  wrapper.appendChild(first);

  const prev = document.createElement("button");
  prev.textContent = "<";
  prev.disabled = currentPage === 0;
  prev.onclick = () => {
    currentPage--;
    renderPage();
    window.scrollTo(0, 0);
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
    window.scrollTo(0, 0);
  };
  wrapper.appendChild(next);

  const last = document.createElement("button");
  last.textContent = ">>";
  last.disabled = currentPage >= totalPages - 1;
  last.onclick = () => {
    currentPage = totalPages - 1;
    renderPage();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  wrapper.appendChild(last);

  app.appendChild(wrapper);
}

async function init() {
  allData = await fetchSightings();
  populateLighthouseFilter(allData, state);
  bindFilterPanelToggle();
  bindCommonControls(state, () => {
    currentPage = 0;
    renderPage();
  });
  renderPage();
}

init();

