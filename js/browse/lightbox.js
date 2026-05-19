import { createImageNavIcon } from "./imageNavIcon.js";

/**
 * Singleton image lightbox shared by every sighting card.
 *
 * Cards register their own image controller via `openLightbox(controller)`.
 * The lightbox keeps a reference to whichever controller most recently opened
 * it so left/right arrow keys, on-screen prev/next buttons, and edge-tap
 * zones all delegate back to the card. Re-rendering a card list MUST call
 * `closeLightboxIfOpen()` first so the lightbox does not point at orphaned
 * card DOM.
 *
 * Body-scroll lock pins the page during display (works around iOS Safari
 * still scrolling under `overflow: hidden`).
 */

let lightboxEl = null;
let lightboxImgEl = null;
let lightboxPrevBtn = null;
let lightboxNextBtn = null;
/** The card-image controller currently driving the lightbox (or null when closed). */
let activeController = null;
let restoreBodyOverflow = null;
let onLightboxKeydown = null;

/** Toggle a nav button between fully hidden+disabled and visible+enabled. */
export function setNavBtnHidden(btn, hidden) {
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
  lightboxPrevBtn.appendChild(createImageNavIcon("prev"));

  lightboxNextBtn = document.createElement("button");
  lightboxNextBtn.type = "button";
  lightboxNextBtn.className = "lightbox-nav lightbox-next";
  lightboxNextBtn.setAttribute("aria-label", "Next image");
  lightboxNextBtn.appendChild(createImageNavIcon("next"));

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
 * Open the lightbox driven by the given card image controller.
 * The controller is the single source of truth for the current image index;
 * card thumbnail and lightbox stay in sync via shared state.
 */
export function openLightbox(controller) {
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

/**
 * Internal-use: card.js needs to know whether a controller currently drives the
 * lightbox so it can mirror image src/nav visibility while the user navigates.
 */
export function isActiveLightboxController(controller) {
  return activeController === controller;
}

/**
 * Internal-use: card.js calls this to push image-source updates into the
 * lightbox image while it's open and driven by the given controller.
 */
export function syncLightboxImageSrc(controller, src) {
  if (activeController === controller && lightboxImgEl) {
    lightboxImgEl.src = src;
  }
}

/**
 * Internal-use: card.js calls this after a setIndex so the lightbox nav
 * buttons reflect first/last bounds when this controller is driving.
 */
export function syncLightboxNavVisibility(controller, { atStart, atEnd }) {
  if (activeController !== controller) return;
  setNavBtnHidden(lightboxPrevBtn, atStart);
  setNavBtnHidden(lightboxNextBtn, atEnd);
}
