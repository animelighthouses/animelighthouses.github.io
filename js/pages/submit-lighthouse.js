/**
 * Lighthouse (reference row) submission — submitl.html
 *
 * PRD:
 * - 2.8: Insert into lighthouses table (real-world reference data)
 * - 2.10: Same OAuth gating as sighting form
 *
 * Structure: helpers → DOMContentLoaded (nav, auth, Lighthouse-JAPAN URL → prefecture, submit)
 */

import supabaseClient from "../supabaseClient.js";
import { initSubmitNav } from "../ui/nav.js";
import { setFormEnabledFromSession, signInWithGithub } from "./submitAuth.js";

function nullifyEmptyStrings(formData) {
  Object.keys(formData).forEach(k => {
    if (formData[k] === "") formData[k] = null;
  });
}

/**
 * First path segment after hostname: lighthouse-japan.com/[prefecture]/...
 * e.g. https://lighthouse-japan.com/hokkaido/shirakamimisaki/shirakamimisaki.html → "hokkaido"
 */
function parseLighthouseJapanPrefectureSlug(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== "lighthouse-japan.com" && host !== "www.lighthouse-japan.com") {
    return null;
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;

  const segment = parts[0].replace(/\.html?$/i, "");
  if (!segment) return null;

  return segment.toLowerCase();
}

/** Match slug to <select name="prefecture"> options (label = English prefecture name). */
function applyPrefectureFromLighthouseJapanUrl(url, prefectureSelect) {
  if (!prefectureSelect) return;

  const slug = parseLighthouseJapanPrefectureSlug(url);
  if (!slug) return;

  for (let i = 0; i < prefectureSelect.options.length; i++) {
    const opt = prefectureSelect.options[i];
    const label = (opt.textContent ?? "").trim().toLowerCase();
    if (label && label === slug) {
      prefectureSelect.selectedIndex = i;
      return;
    }
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  initSubmitNav();

  const form = document.getElementById("lighthouseForm");
  const loginBtn = document.getElementById("loginBtn");
  const resultDiv = document.getElementById("result");

  loginBtn?.addEventListener("click", signInWithGithub);
  await setFormEnabledFromSession({ form, loginBtn });

  const lighthouseJapanInput = form?.querySelector('[name="lighthouse_japan_link"]');
  const prefectureSelect = form?.querySelector('[name="prefecture"]');

  function onLighthouseJapanInput() {
    const url = (lighthouseJapanInput?.value ?? "").trim();
    if (!url) return;
    applyPrefectureFromLighthouseJapanUrl(url, prefectureSelect);
  }

  /* `input` fires after paste/typing with the new value; `change` only on blur */
  lighthouseJapanInput?.addEventListener("input", onLighthouseJapanInput);
  lighthouseJapanInput?.addEventListener("change", onLighthouseJapanInput);

  form?.addEventListener("submit", async e => {
    e.preventDefault();

    if (resultDiv) {
      resultDiv.style.display = "none";
      resultDiv.className = "result";
    }

    const formData = Object.fromEntries(new FormData(form));
    nullifyEmptyStrings(formData);

    const { data, error } = await supabaseClient
      .from("lighthouses")
      .insert([formData])
      .select("id")
      .single();

    if (error) {
      if (resultDiv) {
        resultDiv.textContent = "Error: " + error.message;
        resultDiv.classList.add("error");
        resultDiv.style.display = "block";
      }
      return;
    }

    const id = data.id;
    if (resultDiv) {
      resultDiv.textContent = `Lighthouse added successfully. ID: ${id}`;
      resultDiv.classList.add("success");
      resultDiv.style.display = "block";
    }

    form.reset();
  });
});
