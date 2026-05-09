/**
 * Tiny shared form helpers for submit pages.
 *
 * Consumers: js/pages/submit/sighting.js, js/pages/submit-lighthouse.js,
 * js/pages/submit-image.js.
 *
 * Keeps the result-banner DOM contract and the empty-string -> null
 * normalization in one place so submit pages cannot drift.
 */

/**
 * Mutate `formData` in place: replace any `""` value with `null`.
 * Lets text inputs map cleanly to nullable Postgres columns on insert.
 *
 * @param {Record<string, unknown>} formData
 */
export function nullifyEmptyStrings(formData) {
  Object.keys(formData).forEach(k => {
    if (formData[k] === "") formData[k] = null;
  });
}

/**
 * Show a result banner. `kind` toggles the success/error visual via CSS classes
 * defined in css/submit.css.
 *
 * @param {HTMLElement | null} resultDiv
 * @param {{kind?: ""|"success"|"error", text: string}} payload
 */
export function setResult(resultDiv, { kind = "", text }) {
  if (!resultDiv) return;
  resultDiv.textContent = text;
  resultDiv.className = "result";
  if (kind) resultDiv.classList.add(kind);
  resultDiv.style.display = "block";
}

/** Hide and reset the result banner. */
export function clearResult(resultDiv) {
  if (!resultDiv) return;
  resultDiv.style.display = "none";
  resultDiv.className = "result";
  resultDiv.textContent = "";
}
