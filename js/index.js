/**
 * Compact index view — index-view.html
 *
 * PRD:
 * - 2.3: Compact list rows; expand shows the same card as Recent (buildSightingCard)
 * - 2.4–2.7: Same filter panel semantics as Recent
 *
 * Deferred cards: collapsed rows have no `.card` and no `<img>` until first expand (PRD 2.3, perf).
 *
 * File layout: imports → state → renderIndexView → init
 */

import { fetchSightings } from "./dataservice.js";
import {
  bindCommonControls,
  bindFilterPanelToggle,
  buildSightingCard,
  filterAndSortSightings,
  populateLighthouseFilter,
  scrollWindowToElementTop
} from "./ui/common.js";

const app = document.getElementById("app");

let allData = [];
const state = {
  searchTerm: "",
  titleMode: "title_r",
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
  app.innerHTML = "";

  const processed = filterAndSortSightings(allData, state);

  const container = document.createElement("div");
  container.className = "index-list";

  processed.forEach(entry => {
    const id = entry.id ?? entry.date_spotted;

    const row = document.createElement("div");
    row.className = "index-row";

    const titleText = entry[state.titleMode] || entry.title_en;
    const lighthouse =
      entry.lighthouse_type === "real" && entry.lighthouses
        ? ` (${entry.lighthouses.name_en})`
        : "";

    const title = document.createElement("div");
    title.className = "index-title";
    title.textContent = titleText + lighthouse;

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
  allData = await fetchSightings();
  populateLighthouseFilter(allData, state);

  bindFilterPanelToggle();
  bindCommonControls(state, () => {
    expanded.clear();
    renderIndexView();
  });

  renderIndexView();
}

init();

