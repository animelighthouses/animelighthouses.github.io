/**
 * Sighting submission orchestrator for submit.html.
 *
 * Wires together:
 * - GitHub OAuth gate (../submitAuth.js)
 * - Real / fictional UI + lazy lighthouse dropdown (live Supabase read)
 * - Image source toggle (Upload vs URL)
 * - AniList Fetch button + the shared title-fill chain (../aniListClient.js)
 * - trace.moe lookup (./traceMoe.js + ./lookupUi.js)
 * - SauceNAO lookup (./sauceNao.js + ./lookupUi.js)
 * - Image upload pipeline (../../imageProcessing.js) + insert into Supabase
 * - Filename hints (./filenameHints.js): episode + timestamp from upload name
 *
 * On both lookups, episode + timestamp ALWAYS overwrite once the user clicks
 * Insert; AniList side fields only fill when currently empty/blank.
 */

import supabaseClient from "../../supabaseClient.js";
import { initSubmitNav } from "../../nav.js";
import {
  assertImageFile,
  processSightingsImageFromUrl,
  resizeImageForUpload,
  uploadSightingsImageViaEdge
} from "../../imageProcessing.js";
import {
  acceptAniListId,
  createMediaCache,
  fetchAniListById,
  parseAniListUrl
} from "../aniListClient.js";
import { clearResult, nullifyEmptyStrings, setResult } from "../formUtils.js";
import {
  handleSubmitAuthButtonClick,
  setFormEnabledFromSession
} from "../submitAuth.js";
import { parseFilenameHints } from "./filenameHints.js";
import { createLookupUi } from "./lookupUi.js";
import {
  formatEpisode,
  formatTimestamp,
  queryTraceMoe,
  tierFromConfidence
} from "./traceMoe.js";
import {
  getSauceKey,
  parseSauceEstTime,
  querySauceNao,
  setSauceKey,
  tierFromSimilarity
} from "./sauceNao.js";

/** Local `yyyy-mm-dd` for the Date spotted input default. */
function todayYmd() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0")
  ].join("-");
}

document.addEventListener("DOMContentLoaded", async () => {
  // --- Nav + auth (GitHub session gates the form) -----------------------------
  initSubmitNav();

  const form = /** @type {HTMLFormElement | null} */ (document.getElementById("lighthouseForm"));
  const loginBtn = document.getElementById("loginBtn");
  const noticeEl = document.getElementById("submitAdminNotice");
  const resultDiv = document.getElementById("result");

  loginBtn?.addEventListener("click", () =>
    handleSubmitAuthButtonClick({ form, loginBtn, noticeEl })
  );
  await setFormEnabledFromSession({ form, loginBtn, noticeEl });

  // --- Real lighthouse: show selector and clear when fictional ---------------
  const isReal = /** @type {HTMLInputElement | null} */ (document.getElementById("isReal"));
  const lighthouseSection = document.getElementById("lighthouseSection");
  const lighthouseSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById("lighthouseSelect"));

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
   * Fetch `lighthouses` rows once (anonymous visitors never hit this query
   * unless they check Real?). Reads live from Supabase — not derived from the
   * sightings sessionStorage cache.
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

  // --- Image source: Upload vs URL (lookup-only for URL mode) -----------------
  const imageSourceUploadBtn = document.getElementById("imageSourceUploadBtn");
  const imageSourceUrlBtn = document.getElementById("imageSourceUrlBtn");
  const imageUploadRow = document.getElementById("imageUploadRow");
  const imageUrlRow = document.getElementById("imageUrlRow");
  const imageUrlInput = /** @type {HTMLInputElement | null} */ (document.getElementById("imageUrlInput"));
  const imageFileInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById("imageFileInput") || form?.querySelector('[name="image_file"]')
  );
  const imagePreview = /** @type {HTMLImageElement | null} */ (document.getElementById("imagePreview"));

  /** @type {"upload"|"url"} */
  let imageSourceMode = "upload";
  let previewObjectUrl = null;

  /** Free the active object-URL preview, if any. */
  function revokePreviewObjectUrl() {
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
    }
  }

  /** Replace the preview image with the picked File (creating a fresh object URL). */
  function setPreviewFromFile(file) {
    if (!imagePreview) return;
    revokePreviewObjectUrl();
    if (!file) {
      imagePreview.setAttribute("hidden", "");
      imagePreview.removeAttribute("src");
      return;
    }
    previewObjectUrl = URL.createObjectURL(file);
    imagePreview.src = previewObjectUrl;
    imagePreview.removeAttribute("hidden");
  }

  /** Replace the preview image with the typed URL string (no object URL). */
  function setPreviewFromUrl(url) {
    if (!imagePreview) return;
    revokePreviewObjectUrl();
    const trimmed = String(url ?? "").trim();
    if (!trimmed) {
      imagePreview.setAttribute("hidden", "");
      imagePreview.removeAttribute("src");
      return;
    }
    imagePreview.src = trimmed;
    imagePreview.removeAttribute("hidden");
  }

  function setImageSourceMode(mode) {
    imageSourceMode = mode === "url" ? "url" : "upload";

    if (imageUploadRow) imageUploadRow.toggleAttribute("hidden", imageSourceMode !== "upload");
    if (imageUrlRow) imageUrlRow.toggleAttribute("hidden", imageSourceMode !== "url");

    if (imageSourceUploadBtn) imageSourceUploadBtn.classList.toggle("is-active", imageSourceMode === "upload");
    if (imageSourceUrlBtn) imageSourceUrlBtn.classList.toggle("is-active", imageSourceMode === "url");

    // Switching modes invalidates any prior lookup state, but keeps the user's inputs.
    resetTraceUi();
    resetSauceUi();

    // Bug fix: rebuild preview from the *target* mode's input rather than
    // relying on the change handler — fixes stale preview when both inputs
    // already hold values.
    if (imageSourceMode === "upload") {
      setPreviewFromFile(imageFileInput?.files?.[0] ?? null);
    } else {
      setPreviewFromUrl(imageUrlInput?.value ?? "");
    }
  }

  function getActiveImageSource() {
    if (imageSourceMode === "url") {
      return { kind: "url", url: String(imageUrlInput?.value ?? "").trim() };
    }
    return { kind: "file", file: imageFileInput?.files?.[0] ?? null };
  }

  imageSourceUploadBtn?.addEventListener("click", () => setImageSourceMode("upload"));
  imageSourceUrlBtn?.addEventListener("click", () => setImageSourceMode("url"));

  imageUrlInput?.addEventListener("input", () => {
    resetTraceUi();
    resetSauceUi();
    const url = String(imageUrlInput.value ?? "").trim();
    const hasUrl = Boolean(url);
    const traceUrlBtn = document.getElementById("traceMoeFetchBtnUrl");
    if (traceUrlBtn) traceUrlBtn.disabled = !hasUrl;
    setPreviewFromUrl(url);
    updateSauceEnabled();
  });

  imagePreview?.addEventListener("error", () => {
    if (imageSourceMode === "url") {
      // Keep the user in URL mode, but make failure visible without blocking.
      traceUi.setStatus(
        "Image preview failed to load. URL may be invalid or blocked by CORS.",
        "warn"
      );
    }
  });

  // --- AniList: cache media_id / media_type for submit payload ---------------
  const anilistInput = /** @type {HTMLInputElement | null} */ (document.getElementById("anilistInput"));
  const fetchBtn = document.getElementById("anilistFetchBtn");
  const mediaCache = createMediaCache();

  fetchBtn?.addEventListener("click", async () => {
    const url = (anilistInput?.value ?? "").trim();
    const parsed = parseAniListUrl(url);
    if (!parsed) {
      alert("Invalid AniList URL");
      return;
    }

    const { id, type } = parsed;
    mediaCache.id = id;
    mediaCache.type = type;

    try {
      const media = await fetchAniListById(id);
      if (!media) {
        alert("AniList entry not found");
        return;
      }

      const titleEnEl = form?.querySelector('[name="title_en"]');
      if (titleEnEl) titleEnEl.value = media.title.english || media.title.romaji || "";

      const titleREl = form?.querySelector('[name="title_r"]');
      if (titleREl) titleREl.value = media.title.romaji || "";

      const titleJpEl = form?.querySelector('[name="title_jp"]');
      if (titleJpEl) titleJpEl.value = media.title.native || "";
    } catch (err) {
      console.error(err);
      alert("Failed to fetch AniList data");
    }
  });

  // --- trace.moe: identify uploaded screenshot --------------------------------
  // Three-tier confidence (all "good" tiers require an explicit Insert click;
  // styling differs to make the confidence obvious at a glance):
  //   conf >= TRACE_HIGH         → green "Strong match" + Insert button
  //   TRACE_LOW <= conf < HIGH   → blue  "Possible match" + Insert button
  //   conf < TRACE_LOW           → red   warning, no Insert offered
  // On Insert (both good tiers): episode + timestamp ALWAYS overwrite, then
  // chain a GraphQL fetch to fill blank title fields and refine media_type.
  const traceBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById("traceMoeFetchBtn"));
  const traceUrlBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById("traceMoeFetchBtnUrl"));

  const traceUi = createLookupUi({
    status: "traceMoeStatus",
    match: "traceMoeMatch",
    thumb: "traceMoeThumb",
    meta: "traceMoeMeta",
    insertBtn: "traceMoeInsertBtn",
    clearBtn: "traceMoeClearBtn"
  });

  function resetTraceUi() {
    traceUi.reset();
    const src = getActiveImageSource();
    const hasSource = src.kind === "file" ? Boolean(src.file) : Boolean(src.url);
    if (traceBtn) traceBtn.disabled = !(imageSourceMode === "upload" && hasSource);
    if (traceUrlBtn) traceUrlBtn.disabled = !(imageSourceMode === "url" && hasSource);
  }

  /**
   * Apply an accepted trace.moe result to the form.
   * Episode + timestamp always overwrite; AniList side only fills when empty.
   */
  function applyTraceMoeResult(top) {
    const epEl = form?.querySelector('[name="episode"]');
    const tsEl = form?.querySelector('[name="timestamp"]');
    if (epEl) epEl.value = formatEpisode(top.episode);
    if (tsEl) tsEl.value = formatTimestamp(top.from);

    acceptAniListId({
      form,
      anilistInput,
      anilistId: top?.anilist?.id ?? null,
      mediaCache
    });
  }

  async function runTraceMoeLookup() {
    const src = getActiveImageSource();
    if (src.kind === "file" && !src.file) return;
    if (src.kind === "url" && !src.url) return;

    if (traceBtn) traceBtn.disabled = true;
    if (traceUrlBtn) traceUrlBtn.disabled = true;
    traceUi.hideInsertBtn();
    traceUi.clearMatch();
    traceUi.setStatus("Identifying…");

    try {
      const top = await queryTraceMoe(src);
      const conf = Number(top.similarity ?? 0);
      const pct = (conf * 100).toFixed(1);
      const titleLabel =
        top?.anilist?.title?.english ?? top?.anilist?.title?.romaji ?? "?";
      const tier = tierFromConfidence(conf);

      const epLabel = formatEpisode(top?.episode);
      const metaParts = [titleLabel];
      if (epLabel) metaParts.push(epLabel);
      metaParts.push(formatTimestamp(top?.from ?? 0));

      traceUi.showMatch({
        thumbSrc: top?.image,
        thumbTitle: top?.filename,
        metaText: metaParts.join(" · "),
        tier
      });

      if (tier === "low") {
        traceUi.setStatus(
          `No reliable match (best: ${titleLabel} @ ${pct}%). Verify manually.`,
          "fail"
        );
        traceUi.showClearBtn();
        return;
      }

      const isHigh = tier === "high";
      traceUi.setStatus(
        isHigh
          ? `Strong match: ${titleLabel} (${pct}%).`
          : `Possible match: ${titleLabel} (${pct}%).`,
        isHigh ? "ok" : "warn"
      );
      traceUi.showInsertBtn(() => {
        applyTraceMoeResult(top);
        traceUi.setStatus(`Inserted: ${titleLabel} (${pct}%).`, "ok");
      });
      traceUi.showClearBtn();
    } catch (err) {
      console.error(err);
      traceUi.setStatus(`Lookup failed: ${err?.message ?? "unknown error"}.`, "fail");
      traceUi.showClearBtn();
    } finally {
      resetTraceUi();
    }
  }

  traceBtn?.addEventListener("click", runTraceMoeLookup);
  traceUrlBtn?.addEventListener("click", runTraceMoeLookup);

  // --- SauceNAO: backup identification (Anime* index only) --------------------
  const sauceKeyInput = /** @type {HTMLInputElement | null} */ (document.getElementById("sauceNaoApiKeyInput"));
  const sauceBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById("sauceNaoFetchBtn"));

  const sauceUi = createLookupUi({
    status: "sauceNaoStatus",
    match: "sauceNaoMatch",
    thumb: "sauceNaoThumb",
    meta: "sauceNaoMeta",
    insertBtn: "sauceNaoInsertBtn",
    clearBtn: "sauceNaoClearBtn"
  });

  function updateSauceEnabled() {
    const src = getActiveImageSource();
    const hasSource = src.kind === "file" ? Boolean(src.file) : Boolean(src.url);
    const hasKey = Boolean(getSauceKey());
    if (sauceBtn) sauceBtn.disabled = !(hasSource && hasKey);
  }

  function resetSauceUi() {
    sauceUi.reset();
    updateSauceEnabled();
  }

  // Initialize key input from localStorage.
  if (sauceKeyInput) sauceKeyInput.value = getSauceKey();
  sauceKeyInput?.addEventListener("input", () => {
    setSauceKey(sauceKeyInput.value);
    resetSauceUi();
  });

  function applySauceResult(top) {
    const epEl = form?.querySelector('[name="episode"]');
    const tsEl = form?.querySelector('[name="timestamp"]');
    if (epEl) epEl.value = formatEpisode(top?.data?.part ?? null);
    if (tsEl) tsEl.value = parseSauceEstTime(top?.data?.est_time);

    acceptAniListId({
      form,
      anilistInput,
      anilistId: top?.data?.anilist_id ?? null,
      mediaCache
    });
  }

  sauceBtn?.addEventListener("click", async () => {
    const src = getActiveImageSource();
    if (src.kind === "file" && !src.file) return;
    if (src.kind === "url" && !src.url) return;

    if (sauceBtn) sauceBtn.disabled = true;
    sauceUi.hideInsertBtn();
    sauceUi.clearMatch();
    sauceUi.setStatus("Searching…");

    try {
      const json = await querySauceNao(src);
      const top = Array.isArray(json?.results) ? json.results[0] : null;
      if (!top) throw new Error("No results returned.");

      const sim = Number.parseFloat(top?.header?.similarity ?? "0");
      const tier = tierFromSimilarity(top?.header?.similarity);

      const source = top?.data?.source ?? "?";
      const epLabel = formatEpisode(top?.data?.part);
      const ts = parseSauceEstTime(top?.data?.est_time);
      const simStr = String(top?.header?.similarity ?? "").trim();
      const metaParts = [source];
      if (epLabel) metaParts.push(epLabel);
      if (ts) metaParts.push(ts);
      if (simStr) metaParts.push(`${simStr}%`);

      sauceUi.showMatch({
        thumbSrc: top?.header?.thumbnail,
        metaText: metaParts.join(" · "),
        tier
      });

      if (tier === "low") {
        sauceUi.setStatus(`Low confidence: ${sim.toFixed(2)}%.`, "fail");
        sauceUi.showClearBtn();
        return;
      }

      const isHigh = tier === "high";
      sauceUi.setStatus(
        isHigh ? `Strong match: ${sim.toFixed(2)}%.` : `Possible match: ${sim.toFixed(2)}%.`,
        isHigh ? "ok" : "warn"
      );
      sauceUi.showInsertBtn(() => {
        applySauceResult(top);
        sauceUi.setStatus(`Inserted: ${sim.toFixed(2)}%.`, "ok");
      });
      sauceUi.showClearBtn();
    } catch (err) {
      console.error(err);
      sauceUi.setStatus(`Lookup failed: ${err?.message ?? "unknown error"}.`, "fail");
      sauceUi.showClearBtn();
    } finally {
      updateSauceEnabled();
    }
  });

  // --- Date spotted + image defaults -----------------------------------------
  const dateSpottedInput = /** @type {HTMLInputElement | null} */ (form?.querySelector('[name="date_spotted"]'));

  function initDateAndImageDefaults() {
    if (dateSpottedInput) dateSpottedInput.value = todayYmd();
    if (imageFileInput) imageFileInput.value = "";
    // Bug fix: revoke any active preview object URL before clearing the
    // <img> src — otherwise every successful submit leaks one URL.
    revokePreviewObjectUrl();
    if (imagePreview) {
      imagePreview.setAttribute("hidden", "");
      imagePreview.removeAttribute("src");
    }
    if (imageUrlInput) imageUrlInput.value = "";
    setImageSourceMode("upload");
    resetTraceUi();
    resetSauceUi();
    // SauceNAO API key sits inside <form>; form.reset would clear it — keep field in sync with localStorage.
    if (sauceKeyInput) sauceKeyInput.value = getSauceKey();
  }

  initDateAndImageDefaults();

  imageFileInput?.addEventListener("change", () => {
    const file = imageFileInput?.files?.[0] ?? null;

    // New / cleared file invalidates any previous lookup.
    resetTraceUi();
    resetSauceUi();

    if (!file) {
      setPreviewFromFile(null);
      return;
    }

    try {
      assertImageFile(file);
    } catch (e) {
      alert(e?.message ?? "Invalid image.");
      imageFileInput.value = "";
      setPreviewFromFile(null);
      resetTraceUi();
      resetSauceUi();
      return;
    }

    setPreviewFromFile(file);

    const { timestamp, episode } = parseFilenameHints(file.name);
    if (timestamp) {
      const tsEl = form?.querySelector('[name="timestamp"]');
      if (tsEl) tsEl.value = timestamp;
    }
    if (episode) {
      const epEl = form?.querySelector('[name="episode"]');
      if (epEl) epEl.value = episode;
    }

    if (imageSourceMode === "upload" && traceBtn) traceBtn.disabled = false;
    updateSauceEnabled();
  });

  // --- Submit to Supabase -----------------------------------------------------
  form?.addEventListener("submit", async e => {
    e.preventDefault();

    clearResult(resultDiv);

    const fd = new FormData(form);
    const formData = Object.fromEntries(fd);
    nullifyEmptyStrings(formData);

    if (isReal?.checked) {
      formData.lighthouse_type = "real";
    } else {
      formData.lighthouse_type = "fictional";
      formData.lighthouse_id = null;
    }

    // image_file (File) is not a DB column; we will upload and set image_link (text[]).
    delete formData.image_file;

    if (mediaCache.id) formData.media_id = mediaCache.id;
    if (mediaCache.type) formData.media_type = mediaCache.type;

    try {
      const ymd = dateSpottedInput?.value ?? todayYmd();
      const mediaId = mediaCache.id ? String(mediaCache.id) : null;
      let publicUrl;

      if (imageSourceMode === "url") {
        const sourceUrl = String(imageUrlInput?.value ?? "").trim();
        if (!sourceUrl) {
          throw new Error("Please enter an image URL before submitting.");
        }
        setResult(resultDiv, { kind: "", text: "Processing image from URL…" });
        const uploaded = await processSightingsImageFromUrl({
          sourceUrl,
          ymd,
          mediaId
        });
        publicUrl = uploaded.publicUrl;
      } else {
        const file = imageFileInput?.files?.[0] ?? null;
        if (!file) {
          throw new Error("Please upload an image before submitting.");
        }
        setResult(resultDiv, { kind: "", text: "Processing and uploading image…" });
        const resized = await resizeImageForUpload(file);
        const uploaded = await uploadSightingsImageViaEdge({
          blob: resized.blob,
          ymd,
          mediaId
        });
        publicUrl = uploaded.publicUrl;
      }

      formData.image_link = [publicUrl];

      const { data, error } = await supabaseClient
        .from("sightings")
        .insert([formData])
        .select("id")
        .single();

      if (error) throw error;

      setResult(resultDiv, {
        kind: "success",
        text: `Sighting added successfully. ID: ${data.id}`
      });

      form.reset();
      initDateAndImageDefaults();
      mediaCache.id = null;
      mediaCache.type = null;
      lighthouseOptionsLoaded = false;
      if (lighthouseSelect) lighthouseSelect.innerHTML = `<option value="">-- Select lighthouse --</option>`;
      updateTypeUI();
      if (isReal?.checked) await loadLighthousesOnce();
    } catch (err) {
      console.error(err);
      setResult(resultDiv, {
        kind: "error",
        text: "Error: " + (err?.message ? String(err.message) : "Unknown error")
      });
    }
  });
});
