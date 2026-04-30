import { fetchSightings } from "./dataservice.js";

const app = document.getElementById("app");

// ---------------- STATE ----------------
let allData = [];

let searchTerm = "";
let titleMode = "title_r";

let showAnime = true;
let showManga = true;
let realOnly = false;
let sortMode = "az";

// track expanded rows
const expanded = new Set();

// ---------------- LINK ----------------
function createLink(text, url, iconSrc) {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.className = "link-item";

  if (iconSrc) {
    const icon = document.createElement("img");
    icon.src = iconSrc;
    icon.className = "link-icon";
    a.appendChild(icon);
  }

  const label = document.createElement("span");
  label.textContent = text;
  a.appendChild(label);

  return a;
}

// ---------------- FILTER + SORT PIPELINE ----------------
function getProcessed() {
  let processed = [...allData];

  // SORT
  processed.sort((a, b) => {
    switch (sortMode) {
      case "oldest":
        return new Date(a.date_spotted) - new Date(b.date_spotted);
      case "az":
        return (a[titleMode] || "").localeCompare(b[titleMode] || "");
      case "za":
        return (b[titleMode] || "").localeCompare(a[titleMode] || "");
      case "newest":
      default:
        return new Date(b.date_spotted) - new Date(a.date_spotted);
    }
  });

  // FILTER
  return processed.filter(entry => {
    if (searchTerm) {
      const matches = Object.values(entry).some(v => {
        if (!v) return false;

        if (Array.isArray(v)) {
          return v.some(x =>
            String(x).toLowerCase().includes(searchTerm)
          );
        }

        if (typeof v === "object") {
          return Object.values(v).some(x =>
            x && String(x).toLowerCase().includes(searchTerm)
          );
        }

        return String(v).toLowerCase().includes(searchTerm);
      });

      if (!matches) return false;
    }

    if (
      (entry.media_type === "anime" && !showAnime) ||
      (entry.media_type === "manga" && !showManga)
    ) return false;

    if (realOnly && entry.lighthouse_type !== "real") return false;

    return true;
  });
}

// ---------------- CARD ----------------
function buildFullCard(entry) {
  const card = document.createElement("div");
  card.className = "card";

  // DATE
  const date = document.createElement("div");
  date.textContent = new Date(entry.date_spotted).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
  card.appendChild(date);

  // IMAGE
  if (entry.image_link?.length) {
    const img = document.createElement("img");
    img.className = "cardimg";
    img.src = entry.image_link[0];
    card.appendChild(img);
  }

  // NAME
  const name = document.createElement("div");
  name.className = "title";
  name.textContent = entry[titleMode] || entry.title_en;
  card.appendChild(name);

  // EPISODE
  if (entry.episode || entry.timestamp || entry.anilist_link) {
    const ep = document.createElement("div");
    ep.className = "meta-row";

    // --- Episode text ---
    if (entry.episode || entry.timestamp) {
      const epText = document.createElement("span");

      epText.textContent =
        `${entry.episode ?? "—"}` +
        (entry.timestamp ? ` / ${entry.timestamp}` : "");

      ep.appendChild(epText);
    }

    // --- Dot separator (only if both exist) ---
    if ((entry.episode || entry.timestamp) && entry.anilist_link) {
      const dot = document.createElement("span");
      dot.textContent = " • ";
      dot.className = "dot-sep";
      ep.appendChild(dot);
    }

    // --- AniList link ---
    if (entry.anilist_link) {
      ep.appendChild(
        createLink(
          "AniList",
          entry.anilist_link,
          "images/favicon-al.png"
        )
      );
    }

    card.appendChild(ep);
  }



  // LIGHTHOUSE block
  if (entry.lighthouse_type === "real" && entry.lighthouses) {
    const lighthouseBlock = document.createElement("div");
    lighthouseBlock.className = "lighthouse-block";

    // --- Title line ---
    const title = document.createElement("div");

    const label = document.createElement("span");

    const name = document.createElement("strong");
    name.textContent = entry.lighthouses.name_en + ' (' + entry.lighthouses.name_jp + ')';

    title.appendChild(label);
    title.appendChild(name);

    lighthouseBlock.appendChild(title);

    // --- Location (prefecture) ---
    if (entry.lighthouses.prefecture) {
      const location = document.createElement("div");

      const text = document.createElement("span");
      text.textContent = "📌 " + entry.lighthouses.prefecture;

      location.appendChild(text);

      // add Maps link next to it
      if (entry.lighthouses.google_maps_link) {
        const mapLink = createLink(
          "Maps",
          entry.lighthouses.google_maps_link,
          "images/favicon-map.png"
        );

        mapLink.style.marginLeft = "10px"; // small spacing
        location.appendChild(mapLink);
      }

      lighthouseBlock.appendChild(location);
    }

    // --- Links ---
    const links = document.createElement("div");

    if (entry.lighthouses.wiki_en) {
      links.appendChild(
        createLink("Wikipedia (EN)", entry.lighthouses.wiki_en, "images/favicon-wiki.png")
      );
    }

    if (entry.lighthouses.wiki_jp) {
      links.appendChild(
        createLink("Wikipedia (JP)", entry.lighthouses.wiki_jp, "images/favicon-wiki.png")
      );
    }

    if (entry.lighthouses.lighthouse_japan_link) {
      links.appendChild(
        createLink("Lighthouse-JAPAN.com", entry.lighthouses.lighthouse_japan_link, "images/favicon-lj.png")
      );
    }
    lighthouseBlock.appendChild(links);


    card.appendChild(lighthouseBlock);
  }
  return card;
}

// ---------------- INDEX VIEW ----------------
function renderIndexView() {
  app.innerHTML = "";

  const processed = getProcessed();

  const container = document.createElement("div");
  container.className = "index-list";

  processed.forEach(entry => {
    const id = entry.id ?? entry.date_spotted;

    const row = document.createElement("div");
    row.className = "index-row";

    const titleText = entry[titleMode] || entry.title_en;

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

    details.appendChild(buildFullCard(entry));

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
}

// ---------------- CONTROLS ----------------
function bindControls() {
  document.getElementById("search")
    ?.addEventListener("input", e => {
      searchTerm = e.target.value.toLowerCase();
      renderIndexView();
    });

  document.getElementById("title-mode")
    ?.addEventListener("change", e => {
      titleMode = e.target.value;
      renderIndexView();
    });

  document.getElementById("sort-mode")
    ?.addEventListener("change", e => {
      sortMode = e.target.value;
      renderIndexView();
    });

  document.getElementById("real-only")
    ?.addEventListener("change", e => {
      realOnly = e.target.checked;
      renderIndexView();
    });

  document.getElementById("filter-anime")
    ?.addEventListener("change", e => {
      showAnime = e.target.checked;
      renderIndexView();
    });

  document.getElementById("filter-manga")
    ?.addEventListener("change", e => {
      showManga = e.target.checked;
      renderIndexView();
    });
}

function bindUI() {
  const toggleBtn = document.getElementById("menu-toggle");
  const panel = document.getElementById("filter-panel");

  if (toggleBtn && panel) {
    toggleBtn.onclick = () => {
      panel.classList.toggle("hidden");
    };
  }
}

// ---------------- INIT ----------------
async function init() {
  allData = await fetchSightings();

  bindUI();        // 👈 ADD THIS
  bindControls();  // existing
  renderIndexView();

  const titleSelect = document.getElementById("title-mode");
  titleSelect.value = titleMode;

  const sortSelect = document.getElementById("sort-mode");
  sortSelect.value = sortMode;

}

init();