/**
 * Sighting submission — submit.html
 *
 * PRD:
 * - 2.8: Authenticated submit to sightings table
 * - 2.9: AniList GraphQL to prefill titles from URL
 * - 2.10: OAuth gating via submitAuth.js
 *
 * Structure: small helpers → DOMContentLoaded (nav, auth, real/fictional UI,
 *            lighthouse dropdown fetched only when "Real?" is checked, AniList, submit)
 */

import supabaseClient from "../supabaseClient.js";
import { initSubmitNav } from "../ui/nav.js";
import {
  handleSubmitAuthButtonClick,
  setFormEnabledFromSession
} from "./submitAuth.js";

/** Local `yyyy-mm-dd` for date inputs */
function todayYmd() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0")
  ].join("-");
}

/** Default image filename pattern: same date as "Date spotted" */
function imageFilenameFromYmd(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "";
  return `${ymd}.jpg`;
}

/** Matches RULES.txt: empty strings become null before insert */
function nullifyEmptyStrings(formData) {
  Object.keys(formData).forEach(k => {
    if (formData[k] === "") formData[k] = null;
  });
}

/** Extract media type + numeric id from an anilist.co anime/manga URL */
function parseAniListUrl(url) {
  try {
    const match = url.match(/anilist\.co\/(anime|manga)\/(\d+)/);
    if (!match) return null;
    return { type: match[1], id: match[2] };
  } catch {
    return null;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  // --- Nav + auth (PRD 2.10) ------------------------------------------------
  initSubmitNav();

  const form = document.getElementById("lighthouseForm");
  const loginBtn = document.getElementById("loginBtn");
  const noticeEl = document.getElementById("submitAdminNotice");
  const resultDiv = document.getElementById("result");

  loginBtn?.addEventListener("click", () =>
    handleSubmitAuthButtonClick({ form, loginBtn, noticeEl })
  );
  await setFormEnabledFromSession({ form, loginBtn, noticeEl });

  // --- Real lighthouse: show selector and clear when fictional ---------------
  const isReal = document.getElementById("isReal");
  const lighthouseSection = document.getElementById("lighthouseSection");
  const lighthouseSelect = document.getElementById("lighthouseSelect");

  /** True after we have populated the dropdown from Supabase at least once. */
  let lighthouseOptionsLoaded = false;

  function updateTypeUI() {
    if (!isReal || !lighthouseSection || !lighthouseSelect) return;
    if (isReal.checked) {
      lighthouseSection.style.display = "block";
    } else {
      lighthouseSection.style.display = "none";
      lighthouseSelect.value = "";
    }
  }

  /**
   * Fetches `lighthouses` rows once (anonymous visitors never hit this query unless they check Real?).
   * Still reads live data from Supabase — not derived from sightings `sessionStorage` cache.
   */
  async function loadLighthousesOnce() {
    if (!lighthouseSelect || lighthouseOptionsLoaded) return;

    const { data, error } = await supabaseClient
      .from("lighthouses")
      .select("id, name_en")
      .order("name_en");

    if (error) {
      console.error(error);
      return;
    }

    lighthouseSelect.innerHTML = `<option value="">-- Select lighthouse --</option>`;
    data.forEach(l => {
      const opt = document.createElement("option");
      opt.value = l.id;
      opt.textContent = l.name_en;
      lighthouseSelect.appendChild(opt);
    });

    lighthouseOptionsLoaded = true;
  }

  isReal?.addEventListener("change", async () => {
    updateTypeUI();
    if (isReal.checked) await loadLighthousesOnce();
  });

  updateTypeUI();
  if (isReal?.checked) await loadLighthousesOnce();

  // --- AniList (PRD 2.9): cache media_id / media_type for submit payload -----
  const anilistInput = document.getElementById("anilistInput");
  const fetchBtn = document.getElementById("anilistFetchBtn");
  let cachedMediaId = null;
  let cachedMediaType = null;

  fetchBtn?.addEventListener("click", async () => {
    const url = (anilistInput?.value ?? "").trim();
    const parsed = parseAniListUrl(url);
    if (!parsed) {
      alert("Invalid AniList URL");
      return;
    }

    const { id, type } = parsed;
    cachedMediaId = id;
    cachedMediaType = type;

    const query = `
      query ($id: Int) {
        Media(id: $id) {
          title {
            romaji
            english
            native
          }
        }
      }
    `;

    try {
      const res = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: { id: Number(id) } })
      });

      const json = await res.json();
      const media = json?.data?.Media;

      if (!media) {
        alert("AniList entry not found");
        return;
      }

      const title_en = media.title.english || media.title.romaji;
      const title_r = media.title.romaji;
      const title_jp = media.title.native;

      const titleEnEl = form?.querySelector('[name="title_en"]');
      if (titleEnEl) titleEnEl.value = title_en || "";

      const titleREl = form?.querySelector('[name="title_r"]');
      if (titleREl) titleREl.value = title_r || "";

      const titleJpEl = form?.querySelector('[name="title_jp"]');
      if (titleJpEl) titleJpEl.value = title_jp || "";
    } catch (err) {
      console.error(err);
      alert("Failed to fetch AniList data");
    }
  });

  // --- Date spotted + image filename (yyyy-mm-dd.jpg; sync on date change) ----
  const dateSpottedInput = form?.querySelector('[name="date_spotted"]');
  const imageLinkInput = form?.querySelector('[name="image_link"]');

  function syncImageFilenameToDate() {
    if (!dateSpottedInput || !imageLinkInput) return;
    const ymd = dateSpottedInput.value;
    imageLinkInput.value = imageFilenameFromYmd(ymd);
  }

  function initDateAndImageDefaults() {
    if (dateSpottedInput) dateSpottedInput.value = todayYmd();
    syncImageFilenameToDate();
  }

  initDateAndImageDefaults();
  dateSpottedInput?.addEventListener("change", syncImageFilenameToDate);

  // --- Submit to Supabase (PRD 2.8) -------------------------------------------
  form?.addEventListener("submit", async e => {
    e.preventDefault();

    if (resultDiv) {
      resultDiv.style.display = "none";
      resultDiv.className = "result";
    }

    const formData = Object.fromEntries(new FormData(form));
    nullifyEmptyStrings(formData);

    if (isReal?.checked) {
      formData.lighthouse_type = "real";
    } else {
      formData.lighthouse_type = "fictional";
      formData.lighthouse_id = null;
    }

    if (formData.image_link) {
      const filename = String(formData.image_link).trim();
      formData.image_link = filename ? [`images/${filename}`] : null;
    } else {
      formData.image_link = null;
    }

    if (cachedMediaId) formData.media_id = cachedMediaId;
    if (cachedMediaType) formData.media_type = cachedMediaType;

    const { data, error } = await supabaseClient
      .from("sightings")
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

    if (resultDiv) {
      resultDiv.textContent = `Sighting added successfully. ID: ${data.id}`;
      resultDiv.classList.add("success");
      resultDiv.style.display = "block";
    }

    form.reset();
    initDateAndImageDefaults();
    cachedMediaId = null;
    cachedMediaType = null;
    lighthouseOptionsLoaded = false;
    if (lighthouseSelect) lighthouseSelect.innerHTML = `<option value="">-- Select lighthouse --</option>`;
    updateTypeUI();
    if (isReal?.checked) await loadLighthousesOnce();
  });
});
