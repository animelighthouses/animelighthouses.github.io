/**
 * Centered chevron SVG for multi-image nav, pagination, and lightbox controls.
 */

const IMAGE_NAV_VIEW_BOX = "0 0 24 24";

/** @type {Record<"prev"|"next"|"first"|"last", string>} */
const IMAGE_NAV_PATHS = {
  prev: "M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z",
  next: "M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z",
  first:
    "M18.41 16.59L13.83 12l4.58-4.59L17 6l-6 6 6 6 1.41-1.41L13.83 12zM10.41 16.59L5.83 12l4.58-4.59L9 6l-6 6 6 6 1.41-1.41L5.83 12z",
  last:
    "M5.59 16.59L10.17 12 5.59 7.41 7 6l6 6-6 6-1.41-1.41L10.17 12zM13.59 16.59L18.17 12 13.59 7.41 15 6l6 6-6 6-1.41-1.41L18.17 12z"
};

/** @param {"prev"|"next"|"first"|"last"} direction */
export function createImageNavIcon(direction) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", IMAGE_NAV_VIEW_BOX);
  svg.setAttribute("class", "image-nav-icon");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", IMAGE_NAV_PATHS[direction]);
  path.setAttribute("fill", "currentColor");
  svg.appendChild(path);
  return svg;
}
