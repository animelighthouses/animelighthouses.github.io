/**
 * Sighting card builder shared by the Recent (index.html) and List
 * (list.html) views.
 *
 * Exports:
 * - createLink — anchor with optional favicon (used in card body + lighthouse block)
 * - formatSpottedDate — "9 May 2026" UK long form
 * - trimmedDisplay — "" for null/whitespace, trimmed string otherwise
 * - buildSightingCard — the card DOM (image, title, meta row, lighthouse block, notes;
 *   notes support [label](https://...) links via noteText.js)
 *
 * Multi-image cards expose left/right nav columns and tap edges; the same
 * controller drives the lightbox so card thumbnail and lightbox stay in sync.
 */

import {
  isActiveLightboxController,
  openLightbox,
  setNavBtnHidden,
  syncLightboxImageSrc,
  syncLightboxNavVisibility
} from "./lightbox.js";
import { createImageNavIcon } from "./imageNavIcon.js";
import { appendFormattedNoteText } from "./noteText.js";
import { sightingSharePath } from "./sightingLink.js";

const SVG_VIEW_BOX = "0 -960 960 960";

const MULTI_IMAGE_ICON_PATH =
  "M360-400h400L622-580l-92 120-62-80-108 140Zm-40 160q-33 0-56.5-23.5T240-320v-480q0-33 23.5-56.5T320-880h480q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H320Zm0-80h480v-480H320v480ZM160-80q-33 0-56.5-23.5T80-160v-560h80v560h560v80H160Zm160-720v480-480Z";

const DIRECT_LINK_ICON_PATH =
  "M318-120q-82 0-140-58t-58-140q0-40 15-76t43-64l134-133 56 56-134 134q-17 17-25.5 38.5T200-318q0 49 34.5 83.5T318-200q23 0 45-8.5t39-25.5l133-134 57 57-134 133q-28 28-64 43t-76 15Zm79-220-57-57 223-223 57 57-223 223Zm251-28-56-57 134-133q17-17 25-38t8-44q0-50-34-85t-84-35q-23 0-44.5 8.5T558-726L425-592l-57-56 134-134q28-28 64-43t76-15q82 0 139.5 58T839-641q0 39-14.5 75T782-502L648-368Z";

/** @param {string} pathD @param {string} svgClass */
function createCardMaterialIcon(pathD, svgClass) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", SVG_VIEW_BOX);
  svg.setAttribute("class", svgClass);
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathD);
  path.setAttribute("fill", "currentColor");
  svg.appendChild(path);
  return svg;
}

function isPositiveSightingId(id) {
  const raw = String(id).trim();
  if (!/^\d+$/.test(raw)) return false;
  const n = Number.parseInt(raw, 10);
  return n > 0;
}

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
  return String(value).trim();
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
  prevBtn.appendChild(createImageNavIcon("prev"));

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "card-image-nav card-image-next";
  nextBtn.setAttribute("aria-label", "Next image");
  nextBtn.appendChild(createImageNavIcon("next"));

  const isMulti = urls.length > 1;
  setNavBtnHidden(prevBtn, !isMulti || index <= 0);
  setNavBtnHidden(nextBtn, !isMulti || index >= urls.length - 1);

  function preloadNext(i) {
    const n = i + 1;
    if (n < urls.length) {
      const im = new Image();
      im.decoding = "async";
      im.src = urls[n];
    }
  }

  function syncNavVisibility() {
    if (!isMulti) return;
    setNavBtnHidden(prevBtn, index <= 0);
    setNavBtnHidden(nextBtn, index >= urls.length - 1);
    syncLightboxNavVisibility(controller, {
      atStart: index <= 0,
      atEnd: index >= urls.length - 1
    });
  }

  function setIndex(next) {
    // Card has been removed from the DOM (filter re-render) and we are not
    // driving the lightbox either: nothing to update.
    if (!cardImg.isConnected && !isActiveLightboxController(controller)) return;

    const clamped = Math.max(0, Math.min(urls.length - 1, next));
    if (clamped !== index) {
      index = clamped;
      cardImg.src = urls[index];
      syncLightboxImageSrc(controller, urls[index]);
    }
    syncNavVisibility();
    preloadNext(index);
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

  if (isMulti) preloadNext(0);

  return { wrap, controller };
}

export function buildSightingCard(entry, { titleMode, recentImageSlot = false } = {}) {
  const card = document.createElement("div");
  card.className = "card";
  if (recentImageSlot) {
    card.classList.add("card--recent");
  }

  // DATE + direct link
  const headerRow = document.createElement("div");
  headerRow.className = "card-header-row";

  const date = document.createElement("div");
  date.className = "card-date";
  date.textContent = formatSpottedDate(entry.date_spotted);
  headerRow.appendChild(date);

  if (entry.id != null && isPositiveSightingId(entry.id)) {
    const directLink = document.createElement("a");
    directLink.href = sightingSharePath(entry.id);
    directLink.className = "card-direct-link";
    directLink.title = "Direct link";
    directLink.setAttribute("aria-label", "Direct link");
    directLink.appendChild(
      createCardMaterialIcon(DIRECT_LINK_ICON_PATH, "card-direct-link-svg")
    );
    headerRow.appendChild(directLink);
  }

  card.appendChild(headerRow);

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
    multi.appendChild(
      createCardMaterialIcon(MULTI_IMAGE_ICON_PATH, "card-multi-image-indicator-svg")
    );
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
    appendFormattedNoteText(text, entry.notes);

    notesDiv.appendChild(label);
    notesDiv.appendChild(text);
    card.appendChild(notesDiv);
  }

  return card;
}
