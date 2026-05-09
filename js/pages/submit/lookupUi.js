/**
 * Generic match-and-confirm UI used by both screenshot identification
 * services on submit.html (trace.moe and SauceNAO).
 *
 * Each service has the same DOM shape:
 *
 *   #serviceStatus  (live status text + [data-state] for colour)
 *   #serviceMatch   (preview panel + [data-tier] border)
 *     #serviceThumb (matched-frame thumbnail)
 *     #serviceMeta  (title / episode / timestamp summary)
 *   #serviceInsertBtn  (hidden until a match is offered)
 *   #serviceClearBtn   (hidden until a match is offered or fails)
 *
 * `createLookupUi` wires the Clear button automatically and exposes show/hide
 * helpers; the service-specific module decides what `tier` to assign and what
 * to do on Insert click.
 */

/**
 * @typedef {object} LookupUiIds
 * @property {string} status
 * @property {string} match
 * @property {string} thumb
 * @property {string} meta
 * @property {string} insertBtn
 * @property {string} clearBtn
 */

/**
 * @typedef {object} LookupUi
 * @property {{statusEl: HTMLElement | null, matchEl: HTMLElement | null,
 *   thumbEl: HTMLImageElement | null, metaEl: HTMLElement | null,
 *   insertBtn: HTMLButtonElement | null, clearBtn: HTMLButtonElement | null}} elements
 * @property {(text: string, state?: ""|"ok"|"warn"|"fail") => void} setStatus
 * @property {() => void} clearMatch
 * @property {(view: {thumbSrc?: string, thumbTitle?: string, metaText: string,
 *   tier: "high"|"mid"|"low"}) => void} showMatch
 * @property {() => void} hideInsertBtn
 * @property {(onClick: () => void) => void} showInsertBtn
 * @property {() => void} showClearBtn
 * @property {() => void} hideClearBtn
 * @property {() => void} reset
 */

/**
 * @param {LookupUiIds} ids
 * @returns {LookupUi}
 */
export function createLookupUi(ids) {
  const statusEl = document.getElementById(ids.status);
  const matchEl = document.getElementById(ids.match);
  const thumbEl = /** @type {HTMLImageElement | null} */ (document.getElementById(ids.thumb));
  const metaEl = document.getElementById(ids.meta);
  const insertBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById(ids.insertBtn));
  const clearBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById(ids.clearBtn));

  function setStatus(text, state = "") {
    if (!statusEl) return;
    statusEl.textContent = text ?? "";
    if (state) statusEl.dataset.state = state;
    else delete statusEl.dataset.state;
  }

  function clearMatch() {
    if (matchEl) {
      matchEl.setAttribute("hidden", "");
      delete matchEl.dataset.tier;
    }
    if (thumbEl) thumbEl.removeAttribute("src");
    if (metaEl) metaEl.textContent = "";
  }

  function showMatch({ thumbSrc, thumbTitle, metaText, tier }) {
    if (!matchEl || !thumbEl || !metaEl) return;
    if (thumbSrc) thumbEl.src = thumbSrc;
    if (thumbTitle) thumbEl.title = thumbTitle;
    metaEl.textContent = metaText ?? "";
    matchEl.dataset.tier = tier;
    matchEl.removeAttribute("hidden");
  }

  function hideInsertBtn() {
    if (!insertBtn) return;
    insertBtn.setAttribute("hidden", "");
    insertBtn.onclick = null;
  }

  function showInsertBtn(onClick) {
    if (!insertBtn) return;
    insertBtn.removeAttribute("hidden");
    insertBtn.onclick = () => {
      hideInsertBtn();
      onClick();
    };
  }

  function showClearBtn() {
    if (clearBtn) clearBtn.removeAttribute("hidden");
  }

  function hideClearBtn() {
    if (clearBtn) clearBtn.setAttribute("hidden", "");
  }

  function reset() {
    setStatus("");
    clearMatch();
    hideInsertBtn();
    hideClearBtn();
  }

  clearBtn?.addEventListener("click", reset);

  return {
    elements: { statusEl, matchEl, thumbEl, metaEl, insertBtn, clearBtn },
    setStatus,
    clearMatch,
    showMatch,
    hideInsertBtn,
    showInsertBtn,
    showClearBtn,
    hideClearBtn,
    reset
  };
}
