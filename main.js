import { fetchSightings } from "./dataservice.js";

const app = document.getElementById("app");

let currentPage = 0;
const pageSize = 5;
let allData = [];

let searchTerm = "";
let titleMode = "title_r";

let showAnime = true;
let showManga = true;
let realOnly = false;
let sortMode = "newest";

let viewMode = "recent"; // "recent" | "index"

function createLink(text, url, iconSrc) {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.className = "link-item";

  if (iconSrc) {
    const icon = document.createElement("img");
    icon.src = iconSrc;
    icon.alt = "";
    icon.className = "link-icon";
    a.appendChild(icon);
  }

  const label = document.createElement("span");
  label.textContent = text;

  a.appendChild(label);

  return a;
}

function renderPage() {
  let processed = [...allData];

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

  const app = document.getElementById("app");
  app.innerHTML = "";

  const start = currentPage * pageSize;
  const end = start + pageSize;

  // --- filter first ---
  const filtered = processed.filter(entry => {
    // --- search filter ---
    if (searchTerm) {
      const matchesSearch = Object.values(entry).some(value => {
        if (!value) return false;

        if (Array.isArray(value)) {
          return value.some(v =>
            String(v).toLowerCase().includes(searchTerm)
          );
        }

        if (typeof value === "object") {
          return Object.values(value).some(v =>
            v && String(v).toLowerCase().includes(searchTerm)
          );
        }

        return String(value).toLowerCase().includes(searchTerm);
      });

      if (!matchesSearch) return false;
    }

    // --- media filter ---
    if (
      (entry.media_type === "anime" && !showAnime) ||
      (entry.media_type === "manga" && !showManga)
    ) {
      return false;
    }

    // --- real only filter ---
    if (realOnly && entry.lighthouse_type !== "real") {
      return false;
    }

    return true;
  });

  // --- then paginate ---
  const pageItems = filtered.slice(start, end);

  // --- cards ---
  pageItems.forEach(entry => {

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

   // --- Notes ---
if (entry.notes) {
  const notesDiv = document.createElement("div");
  notesDiv.className = "notes";

  const label = document.createElement("strong");
  label.textContent = "Notes: ";

  const text = document.createElement("span");
  text.textContent = entry.notes;

  notesDiv.appendChild(label);
  notesDiv.appendChild(text);

  card.appendChild(notesDiv); // ✅ attach to card
}
   

    app.appendChild(card);
  });

  renderPagination(filtered.length);
}

function renderPagination(totalItems) {
  const app = document.getElementById("app");

  const totalPages = Math.ceil(totalItems / pageSize);
  const start = currentPage * pageSize;
  const end = start + pageSize;

  const wrapper = document.createElement("div");
  wrapper.className = "pagination";

  // --- first page ---
  const first = document.createElement("button");
  first.textContent = "<<";
  first.disabled = currentPage === 0;
  first.onclick = () => {
    currentPage = 0;
    renderPage();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  wrapper.appendChild(first);

  // --- prev ---
  const prev = document.createElement("button");
  prev.textContent = "<";
  prev.disabled = currentPage === 0;
  prev.onclick = () => {
    currentPage--;
    renderPage();
    window.scrollTo(0, 0);
  };
  wrapper.appendChild(prev);

  // --- label ---
  const label = document.createElement("div");
  label.textContent = `${start + 1}–${Math.min(end, totalItems)} of ${totalItems}`;
  wrapper.appendChild(label);

  // --- next ---
  const next = document.createElement("button");
  next.textContent = ">";
  next.disabled = currentPage >= totalPages - 1;
  next.onclick = () => {
    currentPage++;
    renderPage();
    window.scrollTo(0, 0);
  };
  wrapper.appendChild(next);

  // --- last ---
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



/* NEW SECTION FOR CONTROL PANEL */

const toggleBtn = document.getElementById("menu-toggle");
const panel = document.getElementById("filter-panel");

toggleBtn.onclick = () => {
  panel.classList.toggle("hidden");
};

/* Live search */

const searchInput = document.getElementById("search");

searchInput.addEventListener("input", (e) => {
  searchTerm = e.target.value.toLowerCase();
  currentPage = 0; // reset to first page
  renderPage();
});

/* Title lang dropdown */
const titleSelect = document.getElementById("title-mode");

titleSelect.addEventListener("change", (e) => {
  titleMode = e.target.value;
  renderPage();
});

/* sort */
const sortSelect = document.getElementById("sort-mode");

sortSelect.addEventListener("change", (e) => {
  sortMode = e.target.value;
  currentPage = 0;
  renderPage();
});


/* Filters */
const realCheckbox = document.getElementById("real-only");

realCheckbox.addEventListener("change", (e) => {
  realOnly = e.target.checked;
  currentPage = 0;
  renderPage();
});

const animeCheckbox = document.getElementById("filter-anime");
const mangaCheckbox = document.getElementById("filter-manga");

animeCheckbox.addEventListener("change", (e) => {
  showAnime = e.target.checked;
  currentPage = 0;
  renderPage();
});

mangaCheckbox.addEventListener("change", (e) => {
  showManga = e.target.checked;
  currentPage = 0;
  renderPage();
});



/* Views */
const viewRecent = document.getElementById("view-recent");
const viewIndex = document.getElementById("view-index");

viewRecent.onclick = () => {
  viewMode = "recent";
  currentPage = 0;
  renderPage();
  updateViewUI();
};

viewIndex.onclick = () => {
  viewMode = "index";
  currentPage = 0;
  renderPage();
  updateViewUI();
};

function updateViewUI() {
  viewRecent.classList.toggle("active", viewMode === "recent");
  viewIndex.classList.toggle("active", viewMode === "index");
}



async function init() {
  allData = await fetchSightings();
  renderPage();
  
  const titleSelect = document.getElementById("title-mode");
  titleSelect.value = titleMode;

  updateViewUI();
}

init();