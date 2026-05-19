/**
 * Highlights the active primary nav tab using CSS class `active` on `.view-link`.
 * No client-side router: uses `window.location.pathname`.
 *
 * Exports:
 * - initViewNav — Recent vs List (paths `/` and `/list`)
 * - initSubmitNav — Sighting vs Lighthouse (`/submit-admin` vs `/submitl`)
 */

export function initViewNav() {
  const viewRecent = document.getElementById("view-recent");
  const viewIndex = document.getElementById("view-index");

  if (!viewRecent || !viewIndex) return;

  const path = (window.location.pathname || "").toLowerCase();
  const isListView = path.includes("/list");
  const isSharedSightingPage = path.includes("sighting");

  viewRecent.classList.toggle("active", !isListView && !isSharedSightingPage);
  viewIndex.classList.toggle("active", isListView);
}

export function initSubmitNav() {
  const viewSighting = document.getElementById("view-sighting");
  const viewLighthouse = document.getElementById("view-lighthouse");

  if (!viewSighting || !viewLighthouse) return;

  const path = (window.location.pathname || "").toLowerCase();
  const isLighthouse = path.includes("submitl");
  const isAdminSighting = path.includes("submit-admin");

  viewSighting.classList.toggle("active", isAdminSighting && !isLighthouse);
  viewLighthouse.classList.toggle("active", isLighthouse);
}
