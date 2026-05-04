/**
 * Shared UI for public browse pages (index.html Recent view and index-view.html).
 *
 * Exports: sighting card DOM (buildSightingCard), client-side filter/sort pipeline,
 * lighthouse dropdown population, burger filter panel, theme toggle, and shared
 * control bindings (search, title mode, sort, media type, real-only).
 *
 * Depends on: preferences.js (theme + title persistence).
 *
 * Section order: link/date helpers → scroll → card DOM → filter pipeline → panel bindings
 */

import {
  applyThemeAttr,
  persistTheme,
  persistTitleMode,
  readStoredTheme
} from "./preferences.js";

// --- Link + date helpers ----------------------------------------------------

export function createLink(text, url, iconSrc) {
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

export function formatSpottedDate(dateSpotted) {
  return new Date(dateSpotted).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

// --- Scroll -------------------------------------------------------------------

/** Snap (or smooth) the window so `el`'s top edge aligns with the viewport top. */
export function scrollWindowToElementTop(el, { behavior = "auto" } = {}) {
  requestAnimationFrame(() => {
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top, behavior });
  });
}

// --- Sighting card (single visual unit for Recent and Index expand) ----------

export function buildSightingCard(entry, { titleMode }) {
  const card = document.createElement("div");
  card.className = "card";

  // DATE
  const date = document.createElement("div");
  date.textContent = formatSpottedDate(entry.date_spotted);
  card.appendChild(date);

  // IMAGE
  if (entry.image_link?.length) {
    const img = document.createElement("img");
    img.className = "cardimg";
    img.src = entry.image_link[0];
    card.appendChild(img);
  }

  // TITLE
  const name = document.createElement("div");
  name.className = "title";
  name.textContent =
    entry?.[titleMode] || entry.title_en || entry.title_r || entry.title_jp || "";
  card.appendChild(name);

  // EPISODE / TIMESTAMP / ANILIST
  if (entry.episode || entry.timestamp || entry.anilist_link) {
    const ep = document.createElement("div");
    ep.className = "meta-row";

    if (entry.episode || entry.timestamp) {
      const epText = document.createElement("span");
      epText.textContent =
        `${entry.episode ?? "—"}` +
        (entry.timestamp ? ` / ${entry.timestamp}` : "");
      ep.appendChild(epText);
    }

    if ((entry.episode || entry.timestamp) && entry.anilist_link) {
      const dot = document.createElement("span");
      dot.textContent = " • ";
      dot.className = "dot-sep";
      ep.appendChild(dot);
    }

    if (entry.anilist_link) {
      ep.appendChild(createLink("AniList", entry.anilist_link, "images/favicon-al.png"));
    }

    card.appendChild(ep);
  }

  // LIGHTHOUSE block (real only)
  if (entry.lighthouse_type === "real" && entry.lighthouses) {
    const lighthouseBlock = document.createElement("div");
    lighthouseBlock.className = "lighthouse-block";

    const titleRow = document.createElement("div");
    const lighthouseName = document.createElement("span");
    lighthouseName.className = "lighthouse-name";
    lighthouseName.textContent =
      `${entry.lighthouses.name_en ?? ""} (${entry.lighthouses.name_jp ?? ""})`.trim();
    titleRow.appendChild(lighthouseName);
    lighthouseBlock.appendChild(titleRow);

    if (entry.lighthouses.prefecture) {
      const location = document.createElement("div");
      const text = document.createElement("span");
      text.textContent = "📌 " + entry.lighthouses.prefecture;
      location.appendChild(text);

      if (entry.lighthouses.google_maps_link) {
        const mapLink = createLink(
          "Maps",
          entry.lighthouses.google_maps_link,
          "images/favicon-map.png"
        );
        mapLink.style.marginLeft = "10px";
        location.appendChild(mapLink);
      }

      lighthouseBlock.appendChild(location);
    }

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
        createLink(
          "Lighthouse-JAPAN.com",
          entry.lighthouses.lighthouse_japan_link,
          "images/favicon-lj.png"
        )
      );
    }

    lighthouseBlock.appendChild(links);
    card.appendChild(lighthouseBlock);
  }

  // NOTES
  if (entry.notes) {
    const notesDiv = document.createElement("div");
    notesDiv.className = "notes";

    const label = document.createElement("span");
    label.className = "notes-label";
    label.textContent = "Notes: ";

    const text = document.createElement("span");
    text.textContent = entry.notes;

    notesDiv.appendChild(label);
    notesDiv.appendChild(text);
    card.appendChild(notesDiv);
  }

  return card;
}

// --- Client-side filter pipeline ----------------------------------------------

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

/** Sort then filter; returns a new array (does not mutate allData). */
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

/** Debounce search input so filtering runs after typing pauses (~200 ms). */
function debounce(fn, waitMs) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, waitMs);
  };
}

// --- Filter panel (burger + controls in browse HTML) -------------------------

export function bindFilterPanelToggle() {
  const toggleBtn = document.getElementById("menu-toggle");
  const panel = document.getElementById("filter-panel");

  if (!toggleBtn || !panel) return () => {};

  const onClick = () => panel.classList.toggle("hidden");
  toggleBtn.addEventListener("click", onClick);
  return () => toggleBtn.removeEventListener("click", onClick);
}

/** Light theme switch (off = dark default) → localStorage + `data-theme` on `<html>`. */
export function bindAppearanceMode() {
  const btn = document.getElementById("theme-light-toggle");
  if (!btn) return () => {};

  function syncSwitch(lightOn) {
    btn.setAttribute("aria-checked", lightOn ? "true" : "false");
  }

  syncSwitch(readStoredTheme() === "light");

  const onClick = () => {
    const goingLight = readStoredTheme() !== "light";
    const v = goingLight ? "light" : "dark";
    persistTheme(v);
    applyThemeAttr(v);
    syncSwitch(goingLight);
  };

  btn.addEventListener("click", onClick);
  return () => btn.removeEventListener("click", onClick);
}

/** Search, title language, sort, media checkboxes, real-only → calls onStateChange */
export function bindCommonControls(state, onStateChange) {
  const cleanups = [];

  const search = document.getElementById("search");
  if (search) {
    const onInputDebounced = debounce(e => {
      state.searchTerm = e.target.value.toLowerCase();
      onStateChange?.();
    }, 200);
    search.addEventListener("input", onInputDebounced);
    cleanups.push(() => search.removeEventListener("input", onInputDebounced));
  }

  const titleMode = document.getElementById("title-mode");
  if (titleMode) {
    titleMode.value = state.titleMode;
    const onChange = e => {
      state.titleMode = e.target.value;
      persistTitleMode(state.titleMode);
      onStateChange?.();
    };
    titleMode.addEventListener("change", onChange);
    cleanups.push(() => titleMode.removeEventListener("change", onChange));
  }

  const sortMode = document.getElementById("sort-mode");
  if (sortMode) {
    sortMode.value = state.sortMode;
    const onChange = e => {
      state.sortMode = e.target.value;
      onStateChange?.();
    };
    sortMode.addEventListener("change", onChange);
    cleanups.push(() => sortMode.removeEventListener("change", onChange));
  }

  const realOnly = document.getElementById("real-only");
  if (realOnly) {
    realOnly.checked = state.realOnly;
    const onChange = e => {
      state.realOnly = e.target.checked;
      onStateChange?.();
    };
    realOnly.addEventListener("change", onChange);
    cleanups.push(() => realOnly.removeEventListener("change", onChange));
  }

  const filterAnime = document.getElementById("filter-anime");
  if (filterAnime) {
    filterAnime.checked = state.showAnime;
    const onChange = e => {
      state.showAnime = e.target.checked;
      onStateChange?.();
    };
    filterAnime.addEventListener("change", onChange);
    cleanups.push(() => filterAnime.removeEventListener("change", onChange));
  }

  const filterManga = document.getElementById("filter-manga");
  if (filterManga) {
    filterManga.checked = state.showManga;
    const onChange = e => {
      state.showManga = e.target.checked;
      onStateChange?.();
    };
    filterManga.addEventListener("change", onChange);
    cleanups.push(() => filterManga.removeEventListener("change", onChange));
  }

  const lighthouseFilter = document.getElementById("lighthouse-filter");
  if (lighthouseFilter) {
    lighthouseFilter.value =
      state.lighthouseId != null ? String(state.lighthouseId) : "";
    const onChange = e => {
      const v = e.target.value;
      state.lighthouseId = v === "" ? null : Number(v);
      onStateChange?.();
    };
    lighthouseFilter.addEventListener("change", onChange);
    cleanups.push(() =>
      lighthouseFilter.removeEventListener("change", onChange)
    );
  }

  return () => cleanups.forEach(fn => fn());
}
