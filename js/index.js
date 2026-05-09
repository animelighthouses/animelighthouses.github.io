/**
 * Compact index view for index-view.html: one row per sighting, expand for full card.
 *
 * Reuses buildSightingCard from js/browse/card.js (same card as Recent). Collapsed
 * rows defer creating card DOM and images until first expand to avoid loading every
 * image at once.
 */

import { fetchSightings } from "./dataservice.js";
import { readStoredTitleMode } from "./preferences.js";
import { initViewNav } from "./nav.js";
import {
  bindAppearanceMode,
  bindCommonControls,
  bindFilterPanelToggle,
  buildSightingCard,
  closeLightboxIfOpen,
  filterAndSortSightings,
  populateLighthouseFilter,
  scrollWindowToElementTop,
  trimmedDisplay
} from "./browse/index.js";

const app = document.getElementById("app");

/** @type {import("./dataservice.js").SightingRow[]} */
let allData = [];

/** @type {import("./browse/filters.js").BrowseState} */
const state = {
  searchTerm: "",
  titleMode: readStoredTitleMode("title_r"),
  showAnime: true,
  showManga: true,
  realOnly: false,
  sortMode: "az",
  lighthouseId: null
};

/** Expanded row ids (stable key: sighting id, else date_spotted string) */
const expanded = new Set();

function syncCollapseAllDisabled() {
  const btn = document.querySelector(".collapse-wrapper button");
  if (!btn) return;
  btn.disabled = expanded.size === 0;
}

function renderIndexView() {
  // Card DOM is wiped below; close any open lightbox so its active controller
  // doesn't reference an orphaned card image.
  closeLightboxIfOpen();
  app.innerHTML = "";

  const processed = filterAndSortSightings(allData, state);

  const container = document.createElement("div");
  container.className = "index-list";

  processed.forEach(entry => {
    const id = entry.id ?? entry.date_spotted;

    const row = document.createElement("div");
    row.className = "index-row";

    const titleText = entry[state.titleMode] || entry.title_en;
    const ep = trimmedDisplay(entry.episode);
    const episodeSuffix = ep ? ` — ${ep}` : "";
    const lighthouse =
      entry.lighthouse_type === "real" && entry.lighthouses
        ? ` (${entry.lighthouses.name_en})`
        : "";

    const title = document.createElement("div");
    title.className = "index-title";
    title.textContent = titleText + episodeSuffix + lighthouse;

    const details = document.createElement("div");
    details.className = "index-details";
    /** Avoid rebuilding card on re-expand (keeps decoded images warm in memory). */
    let cardBuilt = false;

    if (!expanded.has(id)) details.classList.add("hidden");

    title.onclick = () => {
      if (expanded.has(id)) {
        expanded.delete(id);
        details.classList.add("hidden");
      } else {
        expanded.add(id);
        details.classList.remove("hidden");
        if (!cardBuilt) {
          details.appendChild(buildSightingCard(entry, { titleMode: state.titleMode }));
          cardBuilt = true;
        }
      }
      syncCollapseAllDisabled();
    };

    row.appendChild(title);
    row.appendChild(details);
    container.appendChild(row);
  });

  app.appendChild(container);

  const collapseWrapper = document.createElement("div");
  collapseWrapper.className = "collapse-wrapper";

  const entryCount = processed.length;
  const countSpan = document.createElement("span");
  countSpan.className = "index-view-count";
  countSpan.textContent = `${entryCount} ${entryCount === 1 ? "entry" : "entries"}`;

  const collapseBtn = document.createElement("button");
  collapseBtn.type = "button";
  collapseBtn.textContent = "Collapse All";
  collapseBtn.onclick = () => {
    expanded.clear();
    document.querySelectorAll(".index-details").forEach(el => el.classList.add("hidden"));
    syncCollapseAllDisabled();
    scrollWindowToElementTop(app);
  };

  collapseWrapper.appendChild(collapseBtn);
  collapseWrapper.appendChild(countSpan);
  app.appendChild(collapseWrapper);

  syncCollapseAllDisabled();
}

async function init() {
  initViewNav();
  allData = await fetchSightings();
  populateLighthouseFilter(allData, state);

  bindFilterPanelToggle();
  bindAppearanceMode();
  bindCommonControls(state, () => {
    expanded.clear();
    renderIndexView();
  });

  renderIndexView();
}

init();
