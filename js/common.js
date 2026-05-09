/**
 * Shared UI for public browse pages (index.html Recent view and index-view.html).
 *
 * Exports: sighting card DOM (buildSightingCard), trimmedDisplay, client-side filter/sort pipeline,
 * lighthouse dropdown population, burger filter panel, theme toggle, and shared
 * control bindings (search, title mode, sort, media type, real-only).
 *
 * Depends on: preferences.js (theme + title persistence).
 *
 * Section order: link/date helpers → scroll → card DOM → filter pipeline → panel bindings
 */

import {
  applyThemeAttr,
  persistNavPosition,
  persistTheme,
  persistTitleMode,
  readStoredNavPosition,
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

/** For display: non-empty trimmed string, or "" if null/undefined/whitespace-only. */
export function trimmedDisplay(value) {
  if (value == null) return "";
  const s = String(value).trim();
  return s;
}

// --- Scroll -------------------------------------------------------------------

/** Snap (or smooth) the window so `el`'s top edge aligns with the viewport top. */
export function scrollWindowToElementTop(el, { behavior = "auto" } = {}) {
  requestAnimationFrame(() => {
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top, behavior });
  });
}

/** Snap (or smooth) the window so `el`'s bottom edge aligns with the viewport top. */
export function scrollWindowToElementBottom(el, { behavior = "auto" } = {}) {
  requestAnimationFrame(() => {
    const bottom = el.getBoundingClientRect().bottom + window.scrollY;
    window.scrollTo({ top: bottom, behavior });
  });
}

// --- Sighting card image: lightbox singleton + per-card multi-image nav -----

let lightboxEl = null;
let lightboxImgEl = null;
let lightboxPrevBtn = null;
let lightboxNextBtn = null;
/** The card-image controller currently driving the lightbox (or null when closed). */
let activeController = null;
let restoreBodyOverflow = null;
let onLightboxKeydown = null;

/** Toggle a nav button between fully hidden+disabled and visible+enabled. */
function setNavBtnHidden(btn, hidden) {
  if (!btn) return;
  if (hidden) {
    btn.setAttribute("hidden", "");
    btn.setAttribute("aria-hidden", "true");
    btn.disabled = true;
  } else {
    btn.removeAttribute("hidden");
    btn.removeAttribute("aria-hidden");
    btn.disabled = false;
  }
}

function ensureLightbox() {
  if (lightboxEl && lightboxImgEl) return;

  lightboxEl = document.createElement("div");
  lightboxEl.className = "lightbox hidden";
  lightboxEl.setAttribute("role", "dialog");
  lightboxEl.setAttribute("aria-modal", "true");

  const backdrop = document.createElement("div");
  backdrop.className = "lightbox-backdrop";

  lightboxImgEl = document.createElement("img");
  lightboxImgEl.className = "lightbox-img";
  lightboxImgEl.alt = "";
  lightboxImgEl.decoding = "async";

  lightboxPrevBtn = document.createElement("button");
  lightboxPrevBtn.type = "button";
  lightboxPrevBtn.className = "lightbox-nav lightbox-prev";
  lightboxPrevBtn.setAttribute("aria-label", "Previous image");
  lightboxPrevBtn.textContent = "‹";

  lightboxNextBtn = document.createElement("button");
  lightboxNextBtn.type = "button";
  lightboxNextBtn.className = "lightbox-nav lightbox-next";
  lightboxNextBtn.setAttribute("aria-label", "Next image");
  lightboxNextBtn.textContent = "›";

  // Backdrop and image close the lightbox; nav buttons stop propagation
  // and route navigation through the active controller.
  backdrop.addEventListener("click", () => closeLightbox());
  lightboxImgEl.addEventListener("click", () => closeLightbox());

  lightboxPrevBtn.addEventListener("click", e => {
    e.stopPropagation();
    if (activeController) activeController.setIndex(activeController.getIndex() - 1);
  });
  lightboxNextBtn.addEventListener("click", e => {
    e.stopPropagation();
    if (activeController) activeController.setIndex(activeController.getIndex() + 1);
  });

  lightboxEl.appendChild(backdrop);
  lightboxEl.appendChild(lightboxImgEl);
  lightboxEl.appendChild(lightboxPrevBtn);
  lightboxEl.appendChild(lightboxNextBtn);
  document.body.appendChild(lightboxEl);
}

/**
 * Build a card's image block: image plus optional left/right overlay nav columns.
 *
 * Returns { wrap, controller } where `controller` is the single source of truth
 * for the current image index and is reused by the lightbox while open so card
 * thumbnail and lightbox stay in sync.
 */
function buildCardImageBlock(entry) {
  const urls = (entry.image_link || []).slice();
  let index = 0;

  const wrap = document.createElement("div");
  wrap.className = "card-image-wrap";

  const cardImg = document.createElement("img");
  cardImg.className = "cardimg";
  cardImg.src = urls[0];
  cardImg.loading = "lazy";
  cardImg.decoding = "async";

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "card-image-nav card-image-prev";
  prevBtn.setAttribute("aria-label", "Previous image");
  prevBtn.textContent = "‹";

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "card-image-nav card-image-next";
  nextBtn.setAttribute("aria-label", "Next image");
  nextBtn.textContent = "›";

  const isMulti = urls.length > 1;
  setNavBtnHidden(prevBtn, !isMulti || index <= 0);
  setNavBtnHidden(nextBtn, !isMulti || index >= urls.length - 1);

  function preloadNeighbors(i) {
    for (const n of [i - 1, i + 1]) {
      if (n >= 0 && n < urls.length) {
        const im = new Image();
        im.decoding = "async";
        im.src = urls[n];
      }
    }
  }

  function syncNavVisibility() {
    if (!isMulti) return;
    setNavBtnHidden(prevBtn, index <= 0);
    setNavBtnHidden(nextBtn, index >= urls.length - 1);
    if (activeController === controller) {
      setNavBtnHidden(lightboxPrevBtn, index <= 0);
      setNavBtnHidden(lightboxNextBtn, index >= urls.length - 1);
    }
  }

  function setIndex(next) {
    // Card has been removed from the DOM (filter re-render) and we are not
    // driving the lightbox either: nothing to update.
    if (!cardImg.isConnected && activeController !== controller) return;

    const clamped = Math.max(0, Math.min(urls.length - 1, next));
    if (clamped !== index) {
      index = clamped;
      cardImg.src = urls[index];
      if (activeController === controller && lightboxImgEl) {
        lightboxImgEl.src = urls[index];
      }
    }
    syncNavVisibility();
    preloadNeighbors(index);
  }

  const controller = {
    urls,
    getIndex: () => index,
    setIndex,
    cardImg,
    prevBtn,
    nextBtn
  };

  cardImg.addEventListener("click", () => openLightbox(controller));
  prevBtn.addEventListener("click", e => {
    e.stopPropagation();
    setIndex(index - 1);
  });
  nextBtn.addEventListener("click", e => {
    e.stopPropagation();
    setIndex(index + 1);
  });

  wrap.appendChild(cardImg);
  wrap.appendChild(prevBtn);
  wrap.appendChild(nextBtn);

  return { wrap, controller };
}

function openLightbox(controller) {
  if (!controller?.urls?.length) return;
  ensureLightbox();

  activeController = controller;
  const i = controller.getIndex();
  lightboxImgEl.src = controller.urls[i];

  const isMulti = controller.urls.length > 1;
  setNavBtnHidden(lightboxPrevBtn, !isMulti || i <= 0);
  setNavBtnHidden(lightboxNextBtn, !isMulti || i >= controller.urls.length - 1);

  lightboxEl.classList.remove("hidden");

  if (!restoreBodyOverflow) {
    const prev = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    const prevPosition = document.body.style.position;
    const prevTop = document.body.style.top;
    const prevLeft = document.body.style.left;
    const prevRight = document.body.style.right;
    const prevWidth = document.body.style.width;
    const scrollY = window.scrollY || 0;
    const scrollbarWidth =
      Math.max(0, window.innerWidth - document.documentElement.clientWidth) || 0;
    restoreBodyOverflow = () => {
      document.body.style.overflow = prev;
      document.body.style.paddingRight = prevPaddingRight;
      document.body.style.position = prevPosition;
      document.body.style.top = prevTop;
      document.body.style.left = prevLeft;
      document.body.style.right = prevRight;
      document.body.style.width = prevWidth;
      window.scrollTo(0, scrollY);
      restoreBodyOverflow = null;
    };
    document.body.style.overflow = "hidden";
    if (scrollbarWidth) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    // iOS Safari can still scroll with overflow hidden; pin the page.
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
  }

  if (!onLightboxKeydown) {
    onLightboxKeydown = e => {
      if (e.key === "Escape") {
        closeLightbox();
      } else if (e.key === "ArrowRight" && activeController) {
        activeController.setIndex(activeController.getIndex() + 1);
      } else if (e.key === "ArrowLeft" && activeController) {
        activeController.setIndex(activeController.getIndex() - 1);
      }
    };
    window.addEventListener("keydown", onLightboxKeydown);
  }
}

function closeLightbox() {
  if (!lightboxEl) return;
  lightboxEl.classList.add("hidden");
  if (lightboxImgEl) lightboxImgEl.src = "";
  activeController = null;

  restoreBodyOverflow?.();
  if (onLightboxKeydown) {
    window.removeEventListener("keydown", onLightboxKeydown);
    onLightboxKeydown = null;
  }
}

/** Hide the lightbox if it's currently open. Call before re-rendering card lists. */
export function closeLightboxIfOpen() {
  if (lightboxEl && !lightboxEl.classList.contains("hidden")) {
    closeLightbox();
  }
}

export function buildSightingCard(entry, { titleMode }) {
  const card = document.createElement("div");
  card.className = "card";

  // DATE
  const date = document.createElement("div");
  date.textContent = formatSpottedDate(entry.date_spotted);
  card.appendChild(date);

  // IMAGE
  if (entry.image_link?.length) {
    const { wrap } = buildCardImageBlock(entry);
    card.appendChild(wrap);
  }

  // TITLE
  const name = document.createElement("div");
  name.className = "title";
  const titleStr =
    entry?.[titleMode] || entry.title_en || entry.title_r || entry.title_jp || "";
  const titleSpan = document.createElement("span");
  titleSpan.className = "title-text";
  titleSpan.textContent = titleStr;
  name.appendChild(titleSpan);
  const nImages = entry.image_link?.length ?? 0;
  if (nImages > 1) {
    const multi = document.createElement("span");
    multi.className = "card-multi-image-indicator";
    multi.setAttribute("aria-label", `${nImages} images`);
    multi.title = `${nImages} images`;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 -960 960 960");
    svg.setAttribute("class", "card-multi-image-indicator-svg");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      "M360-400h400L622-580l-92 120-62-80-108 140Zm-40 160q-33 0-56.5-23.5T240-320v-480q0-33 23.5-56.5T320-880h480q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H320Zm0-80h480v-480H320v480ZM160-80q-33 0-56.5-23.5T80-160v-560h80v560h560v80H160Zm160-720v480-480Z"
    );
    path.setAttribute("fill", "currentColor");
    svg.appendChild(path);
    multi.appendChild(svg);
    name.appendChild(multi);
  }
  card.appendChild(name);

  // EPISODE / TIMESTAMP / ANILIST
  const epPart = trimmedDisplay(entry.episode);
  const tsPart = trimmedDisplay(entry.timestamp);
  const aniUrl = trimmedDisplay(entry.anilist_link);
  const hasEpTs = !!(epPart || tsPart);
  const hasAnilist = !!aniUrl;

  if (hasEpTs || hasAnilist) {
    const ep = document.createElement("div");
    ep.className = "meta-row";

    if (hasEpTs) {
      const epText = document.createElement("span");
      epText.textContent =
        epPart && tsPart ? `${epPart} / ${tsPart}` : epPart || tsPart;
      ep.appendChild(epText);
    }

    if (hasEpTs && hasAnilist) {
      const dot = document.createElement("span");
      dot.textContent = " • ";
      dot.className = "dot-sep";
      ep.appendChild(dot);
    }

    if (hasAnilist) {
      ep.appendChild(createLink("AniList", aniUrl, "images/favicon-al.png"));
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

  const navPos = document.getElementById("nav-position");
  if (navPos) {
    if (typeof state.navPosition !== "string") {
      state.navPosition = readStoredNavPosition("bottom");
    }
    navPos.value = state.navPosition;
    const onChange = e => {
      state.navPosition = e.target.value;
      persistNavPosition(state.navPosition);
      onStateChange?.();
    };
    navPos.addEventListener("change", onChange);
    cleanups.push(() => navPos.removeEventListener("change", onChange));
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
