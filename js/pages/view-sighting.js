/**
 * Shared sighting page (sighting.html): one card from ?id= numeric sightings.id.
 * Invalid/missing/not-found id redirects to /.
 */

import { fetchSightingById } from "../dataservice.js";
import { initViewNav } from "../nav.js";
import { readStoredTitleMode, persistTitleMode } from "../preferences.js";
import {
  bindAppearanceMode,
  bindTitleMode,
  buildSightingCard,
  closeLightboxIfOpen,
  trimmedDisplay
} from "../browse/index.js";

const app = document.getElementById("app");

/** @type {import("../dataservice.js").SightingRow | null} */
let currentRow = null;

let titleMode = readStoredTitleMode("title_r");

function redirectHome() {
  location.replace("/");
}

function parseSightingIdFromUrl() {
  const raw = new URLSearchParams(location.search).get("id")?.trim() ?? "";
  if (!/^\d+$/.test(raw)) return null;
  const id = Number.parseInt(raw, 10);
  if (!Number.isFinite(id) || id <= 0) return null;
  return id;
}

function cardTitleForDocument(row, mode) {
  return (
    trimmedDisplay(row?.[mode]) ||
    trimmedDisplay(row?.title_en) ||
    trimmedDisplay(row?.title_r) ||
    trimmedDisplay(row?.title_jp) ||
    "Sighting"
  );
}

function syncDocumentTitle(row) {
  if (!row) return;
  const base = cardTitleForDocument(row, titleMode);
  const ep = trimmedDisplay(row.episode);
  document.title = ep
    ? `Anime Lighthouse Index | ${base} (${ep})`
    : `Anime Lighthouse Index | ${base}`;
}

function renderCard() {
  if (!app || !currentRow) return;
  closeLightboxIfOpen();
  app.innerHTML = "";
  app.appendChild(
    buildSightingCard(currentRow, { titleMode, recentImageSlot: true })
  );
  syncDocumentTitle(currentRow);
}

async function init() {
  const id = parseSightingIdFromUrl();
  if (id == null) {
    redirectHome();
    return;
  }

  initViewNav();
  bindAppearanceMode();
  bindTitleMode({
    getTitleMode: () => titleMode,
    onTitleModeChange: next => {
      titleMode = next;
      renderCard();
    }
  });

  const row = await fetchSightingById(id);
  if (!row) {
    redirectHome();
    return;
  }

  currentRow = row;
  renderCard();
}

init();
