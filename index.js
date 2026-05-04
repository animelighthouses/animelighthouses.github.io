import { fetchSightings } from "./dataservice.js";
import {
  bindCommonControls,
  bindFilterPanelToggle,
  buildSightingCard,
  filterAndSortSightings
} from "./ui/common.js";

const app = document.getElementById("app");

let allData = [];
const state = {
  searchTerm: "",
  titleMode: "title_r",
  showAnime: true,
  showManga: true,
  realOnly: false,
  sortMode: "az"
};

// track expanded rows
const expanded = new Set();

// ---------------- INDEX VIEW ----------------
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

    if (!expanded.has(id)) {
      details.classList.add("hidden");
    }

    details.appendChild(buildSightingCard(entry, { titleMode: state.titleMode }));

    title.onclick = () => {
      if (expanded.has(id)) {
        expanded.delete(id);
        details.classList.add("hidden");
      } else {
        expanded.add(id);
        details.classList.remove("hidden");
      }
    };

    row.appendChild(title);
    row.appendChild(details);
    container.appendChild(row);
  });

  app.appendChild(container);

  // --- collapse all button ---
const collapseWrapper = document.createElement("div");
collapseWrapper.className = "collapse-wrapper";

const collapseBtn = document.createElement("button");
collapseBtn.textContent = "Collapse All";

collapseBtn.onclick = () => {
    expanded.clear();
  document.querySelectorAll(".index-details").forEach(el => {
    el.classList.add("hidden");
  });
};

collapseWrapper.appendChild(collapseBtn);
app.appendChild(collapseWrapper);
}

// ---------------- INIT ----------------
async function init() {
  allData = await fetchSightings();

  bindFilterPanelToggle();
  bindCommonControls(state, () => {
    expanded.clear();
    renderIndexView();
  });
  renderIndexView();
}

init();