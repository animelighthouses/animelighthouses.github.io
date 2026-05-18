/**
 * Wiring for browse-page chrome: burger filter panel, theme switch, and the
 * shared control bindings (search, title language, sort, media filter,
 * real-only, lighthouse dropdown, page-nav position).
 *
 * `bindCommonControls(state, onChange)` mutates `state` in place; pages then
 * re-render against the updated state. Bindings return cleanup callbacks for
 * tidy disposal in callers (current pages do full reloads, so cleanup is
 * unused but kept harmless and useful for any future SPA-style navigation).
 */

import {
  applyThemeAttr,
  persistNavPosition,
  persistTheme,
  persistTitleMode,
  readStoredNavPosition,
  readStoredTheme
} from "../preferences.js";

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

/** Toggle the burger-revealed filter panel. */
export function bindFilterPanelToggle() {
  const toggleBtn = document.getElementById("menu-toggle");
  const panel = document.getElementById("filter-panel");
  if (!toggleBtn || !panel) return;
  toggleBtn.addEventListener("click", () => panel.classList.toggle("hidden"));
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

function filterStateMatchesDefaults(state, defaults) {
  return (
    state.searchTerm === defaults.searchTerm &&
    state.showAnime === defaults.showAnime &&
    state.showManga === defaults.showManga &&
    state.realOnly === defaults.realOnly &&
    state.sortMode === defaults.sortMode &&
    state.lighthouseId === defaults.lighthouseId
  );
}

/** Push filter-panel fields from `state` into the DOM (not title/nav). */
export function syncFilterControlsFromState(state) {
  const search = document.getElementById("search");
  if (search) search.value = state.searchTerm;

  const sortMode = document.getElementById("sort-mode");
  if (sortMode) sortMode.value = state.sortMode;

  const realOnly = document.getElementById("real-only");
  if (realOnly) realOnly.checked = state.realOnly;

  const filterAnime = document.getElementById("filter-anime");
  if (filterAnime) filterAnime.checked = state.showAnime;

  const filterManga = document.getElementById("filter-manga");
  if (filterManga) filterManga.checked = state.showManga;

  const lighthouseFilter = document.getElementById("lighthouse-filter");
  if (lighthouseFilter) {
    lighthouseFilter.value =
      state.lighthouseId != null ? String(state.lighthouseId) : "";
  }
}

/** Update the filter-panel result count label. */
export function updateFilterResultCount(count) {
  const el = document.getElementById("filter-result-count");
  if (!el) return;
  el.textContent = count === 1 ? "1 result" : `${count} results`;
}

/** Enable/disable Reset when filter state already matches `defaults`. */
export function updateFilterResetDisabled(state, defaults) {
  const resetBtn = document.getElementById("filter-reset");
  if (!resetBtn || !defaults) return;
  resetBtn.disabled = filterStateMatchesDefaults(state, defaults);
}

/**
 * Bind filter-panel Reset; restores `defaults` on filter fields only.
 *
 * @param {import("./filters.js").BrowseState} state
 * @param {typeof import("./filters.js").RECENT_FILTER_DEFAULTS} defaults
 * @param {() => void} onStateChange
 */
export function bindFilterPanelFooter(state, defaults, onStateChange) {
  const resetBtn = document.getElementById("filter-reset");
  if (!resetBtn) return () => {};

  updateFilterResetDisabled(state, defaults);

  const onReset = () => {
    Object.assign(state, defaults);
    syncFilterControlsFromState(state);
    updateFilterResetDisabled(state, defaults);
    onStateChange?.();
  };

  resetBtn.addEventListener("click", onReset);
  return () => resetBtn.removeEventListener("click", onReset);
}

/**
 * Bind every shared filter control on browse pages. Each control mutates
 * `state` in place and then invokes `onStateChange()` so the host page can
 * re-render. Missing controls are tolerated (some pages omit nav-position).
 *
 * @param {import("./filters.js").BrowseState} state
 * @param {() => void} onStateChange
 */
export function bindCommonControls(state, onStateChange) {
  const cleanups = [];

  syncFilterControlsFromState(state);

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
    const onChange = e => {
      state.sortMode = e.target.value;
      onStateChange?.();
    };
    sortMode.addEventListener("change", onChange);
    cleanups.push(() => sortMode.removeEventListener("change", onChange));
  }

  const realOnly = document.getElementById("real-only");
  if (realOnly) {
    const onChange = e => {
      state.realOnly = e.target.checked;
      onStateChange?.();
    };
    realOnly.addEventListener("change", onChange);
    cleanups.push(() => realOnly.removeEventListener("change", onChange));
  }

  const filterAnime = document.getElementById("filter-anime");
  if (filterAnime) {
    const onChange = e => {
      state.showAnime = e.target.checked;
      onStateChange?.();
    };
    filterAnime.addEventListener("change", onChange);
    cleanups.push(() => filterAnime.removeEventListener("change", onChange));
  }

  const filterManga = document.getElementById("filter-manga");
  if (filterManga) {
    const onChange = e => {
      state.showManga = e.target.checked;
      onStateChange?.();
    };
    filterManga.addEventListener("change", onChange);
    cleanups.push(() => filterManga.removeEventListener("change", onChange));
  }

  const lighthouseFilter = document.getElementById("lighthouse-filter");
  if (lighthouseFilter) {
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
