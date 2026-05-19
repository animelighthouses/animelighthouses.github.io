/**
 * Public sighting submission (submit.html) — no OAuth; posts via Edge Function.
 */

import { bindAppearanceMode } from "../browse/index.js";
import supabaseClient from "../supabaseClient.js";
import { canonicalAniListUrl, parseAniListUrl } from "./aniListClient.js";
import { clearResult, setResult } from "./formUtils.js";

const NEED_ONE_OR_OTHER_MSG =
  "Please provide an image URL or AniList media URL.";

const ANILIST_FORMAT_MSG =
  "AniList URL must be anilist.co/anime/… or anilist.co/manga/…";

function isHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * @param {HTMLInputElement | null} input
 * @param {string} message
 * @returns {false}
 */
function failField(input, message) {
  if (!input) return false;
  input.setCustomValidity(message);
  input.reportValidity();
  input.focus();
  return false;
}

/** @param {HTMLInputElement | null} input */
function clearFieldValidity(input) {
  input?.setCustomValidity("");
}

/**
 * @param {HTMLInputElement | null} imageInput
 * @param {HTMLInputElement | null} anilistInput
 */
function validateForm(imageInput, anilistInput) {
  clearFieldValidity(imageInput);
  clearFieldValidity(anilistInput);

  const imageUrl = String(imageInput?.value ?? "").trim();
  const anilistLink = String(anilistInput?.value ?? "").trim();
  const hasImage = imageUrl.length > 0;
  const hasAnilist = anilistLink.length > 0;

  if (!hasImage && !hasAnilist) {
    return failField(imageInput, NEED_ONE_OR_OTHER_MSG);
  }
  if (hasImage && !isHttpUrl(imageUrl)) {
    return failField(imageInput, "Image URL must start with http:// or https://");
  }
  if (hasAnilist && !parseAniListUrl(anilistLink)) {
    return failField(anilistInput, ANILIST_FORMAT_MSG);
  }
  return true;
}

document.addEventListener("DOMContentLoaded", () => {
  bindAppearanceMode();

  const form = /** @type {HTMLFormElement | null} */ (document.getElementById("publicSubmitForm"));
  const resultDiv = document.getElementById("result");
  const imageInput = /** @type {HTMLInputElement | null} */ (document.getElementById("image_url"));
  const anilistInput = /** @type {HTMLInputElement | null} */ (document.getElementById("anilist_link"));

  function clearAllFieldValidity() {
    clearFieldValidity(imageInput);
    clearFieldValidity(anilistInput);
  }

  for (const el of [imageInput, anilistInput]) {
    el?.addEventListener("input", clearAllFieldValidity);
    el?.addEventListener("change", clearAllFieldValidity);
  }

  form?.addEventListener("submit", async e => {
    e.preventDefault();
    clearResult(resultDiv);

    if (!validateForm(imageInput, anilistInput)) return;
    clearAllFieldValidity();

    const fd = new FormData(form);
    const body = Object.fromEntries(fd.entries());
    body.form_mode = "basic";
    const anilistCanonical = canonicalAniListUrl(String(body.anilist_link ?? ""));
    if (anilistCanonical) body.anilist_link = anilistCanonical;

    try {
      setResult(resultDiv, { kind: "", text: "Sending…" });

      const { data, error } = await supabaseClient.functions.invoke("public-submit-sighting", {
        body
      });

      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));

      setResult(resultDiv, {
        kind: "success",
        text: "Thanks — your submission is pending review."
      });
      form.reset();
      clearFieldValidity(imageInput);
      clearFieldValidity(anilistInput);
    } catch (err) {
      console.error(err);
      setResult(resultDiv, {
        kind: "error",
        text: "Error: " + (err?.message ?? "Could not send submission.")
      });
    }
  });
});
