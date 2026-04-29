import { fetchSightings } from "./dataservice.js";

const app = document.getElementById("app");

let currentPage = 0;
const pageSize = 5;
let allData = [];

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
  const app = document.getElementById("app");
  app.innerHTML = "";

  const start = currentPage * pageSize;
  const end = start + pageSize;

  const pageItems = [...allData]
    .sort((a, b) => new Date(b.date_spotted) - new Date(a.date_spotted))
    .slice(start, end);

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
    name.textContent = entry.title_en;
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

// LIGHTHOUSE

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

    app.appendChild(card);
  });

  renderPagination();
}

function renderPagination() {
  const app = document.getElementById("app");

  const totalPages = Math.ceil(allData.length / pageSize);

  const wrapper = document.createElement("div");
  wrapper.className = "pagination";

  // --- page indicator ---
  const label = document.createElement("div");
  label.textContent = `${currentPage * pageSize + 1}–${Math.min(
    (currentPage + 1) * pageSize,
    allData.length
  )} of ${allData.length}`;

  wrapper.appendChild(label);

  // --- prev button ---
  const prev = document.createElement("button");
  prev.textContent = "Prev";
  prev.disabled = currentPage === 0;

  prev.onclick = () => {
    currentPage--;
    renderPage();
    window.scrollTo(0, 0);
  };

  wrapper.appendChild(prev);

  // --- next button ---
  const next = document.createElement("button");
  next.textContent = "Next";
  next.disabled = currentPage >= totalPages - 1;

  next.onclick = () => {
    currentPage++;
    renderPage();
    window.scrollTo(0, 0);
  };

  wrapper.appendChild(next);

  app.appendChild(wrapper);
}

async function init() {
  allData = await fetchSightings();
  renderPage();
}

init();