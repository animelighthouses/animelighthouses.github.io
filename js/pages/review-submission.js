/**
 * Review public submissions (review.html): edit-like dropdown, prefilled form,
 * maintainer image upload required for approve (submitter URL never published).
 */

import supabaseClient from "../supabaseClient.js";
import {
  assertImageFile,
  processImageToWebp,
  shortIdHex8,
  STORAGE_BUCKET
} from "../imageProcessing.js";
import {
  acceptAniListId,
  createMediaCache,
  fetchAniListById,
  parseAniListUrl
} from "./aniListClient.js";
import { clearResult, setResult } from "./formUtils.js";
import { buildSightingPayloadFromForm } from "./sightingFormPayload.js";
import {
  handleSubmitAuthButtonClick,
  setFormEnabledFromSession
} from "./submitAuth.js";
import { loadSubmissionsForSelect } from "./submissionSelect.js";
import { notesWithThanks } from "./submissionNotes.js";
import { createLookupUi } from "./submit/lookupUi.js";
import {
  getSauceKey,
  parseSauceEstTime,
  querySauceNao,
  setSauceKey,
  tierFromSimilarity
} from "./submit/sauceNao.js";
import {
  formatEpisode,
  formatTimestamp,
  queryTraceMoe,
  tierFromConfidence
} from "./submit/traceMoe.js";
import { normalizeYmd } from "./sightingSelect.js";

document.addEventListener("DOMContentLoaded", async () => {
  const form = /** @type {HTMLFormElement | null} */ (document.getElementById("reviewForm"));
  const loginBtn = document.getElementById("loginBtn");
  const noticeEl = document.getElementById("submitAdminNotice");
  const resultDiv = document.getElementById("result");
  const submissionSelect = /** @type {HTMLSelectElement | null} */ (
    document.getElementById("submissionSelect")
  );
  const reviewFormBody = document.getElementById("reviewFormBody");
  const approveBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById("approveBtn"));
  const rejectBtn = document.getElementById("rejectBtn");

  loginBtn?.addEventListener("click", () =>
    handleSubmitAuthButtonClick({ form, loginBtn, noticeEl })
  );
  await setFormEnabledFromSession({ form, loginBtn, noticeEl });

  const isReal = /** @type {HTMLInputElement | null} */ (document.getElementById("isReal"));
  const lighthouseSection = document.getElementById("lighthouseSection");
  const lighthouseSelect = /** @type {HTMLSelectElement | null} */ (
    document.getElementById("lighthouseSelect")
  );
  const submitterUsername = document.getElementById("submitterUsername");
  const submitterImageLink = /** @type {HTMLAnchorElement | null} */ (
    document.getElementById("submitterImageLink")
  );
  const submitterImagePreview = /** @type {HTMLImageElement | null} */ (
    document.getElementById("submitterImagePreview")
  );
  const anilistInput = /** @type {HTMLInputElement | null} */ (document.getElementById("anilistInput"));
  const fetchBtn = document.getElementById("anilistFetchBtn");
  const mediaCache = createMediaCache();

  const imageSourceUploadBtn = document.getElementById("imageSourceUploadBtn");
  const imageSourceUrlBtn = document.getElementById("imageSourceUrlBtn");
  const imageUploadRow = document.getElementById("imageUploadRow");
  const imageUrlRow = document.getElementById("imageUrlRow");
  const imageUrlInput = /** @type {HTMLInputElement | null} */ (document.getElementById("imageUrlInput"));
  const imageFileInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById("imageFileInput")
  );
  const imagePreview = /** @type {HTMLImageElement | null} */ (document.getElementById("imagePreview"));

  let rowById = new Map();
  /** @type {any | null} */
  let selectedRow = null;
  let lighthouseOptionsLoaded = false;
  /** @type {File | null} */
  let pendingUploadFile = null;
  /** @type {"upload"|"url"} */
  let imageSourceMode = "upload";
  let previewObjectUrl = null;

  function updateApproveEnabled() {
    if (approveBtn) approveBtn.disabled = !pendingUploadFile;
  }

  function updateTypeUI() {
    if (!isReal || !lighthouseSection || !lighthouseSelect) return;
    lighthouseSection.style.display = isReal.checked ? "block" : "none";
    if (!isReal.checked) lighthouseSelect.value = "";
  }

  async function loadLighthousesOnce() {
    if (!lighthouseSelect || lighthouseOptionsLoaded) return;
    const { data, error } = await supabaseClient.from("lighthouses").select("id, name_en").order("name_en");
    if (error) {
      console.error(error);
      return;
    }
    lighthouseSelect.innerHTML = `<option value="">-- Select lighthouse --</option>`;
    data.forEach(l => {
      const opt = document.createElement("option");
      opt.value = String(l.id);
      opt.textContent = l.name_en;
      lighthouseSelect.appendChild(opt);
    });
    lighthouseOptionsLoaded = true;
  }

  isReal?.addEventListener("change", async () => {
    updateTypeUI();
    if (isReal.checked) await loadLighthousesOnce();
  });

  function revokePreviewObjectUrl() {
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
    }
  }

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

  function setImageSourceMode(mode) {
    imageSourceMode = mode === "url" ? "url" : "upload";
    if (imageUploadRow) imageUploadRow.toggleAttribute("hidden", imageSourceMode !== "upload");
    if (imageUrlRow) imageUrlRow.toggleAttribute("hidden", imageSourceMode !== "url");
    imageSourceUploadBtn?.classList.toggle("is-active", imageSourceMode === "upload");
    imageSourceUrlBtn?.classList.toggle("is-active", imageSourceMode === "url");
    resetTraceUi();
    resetSauceUi();
    if (imageSourceMode === "upload") setPreviewFromFile(imageFileInput?.files?.[0] ?? null);
  }

  imageSourceUploadBtn?.addEventListener("click", () => setImageSourceMode("upload"));
  imageSourceUrlBtn?.addEventListener("click", () => setImageSourceMode("url"));

  function getActiveImageSource() {
    if (imageSourceMode === "url") {
      return { kind: "url", url: String(imageUrlInput?.value ?? "").trim() };
    }
    return { kind: "file", file: imageFileInput?.files?.[0] ?? null };
  }

  imageFileInput?.addEventListener("change", () => {
    const file = imageFileInput.files?.[0] ?? null;
    pendingUploadFile = file;
    updateApproveEnabled();
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
      pendingUploadFile = null;
      updateApproveEnabled();
      setPreviewFromFile(null);
      return;
    }
    setPreviewFromFile(file);
    if (traceBtn) traceBtn.disabled = false;
    updateSauceEnabled();
  });

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

  function applyTraceMoeResult(top) {
    const epEl = form?.querySelector('[name="episode"]');
    const tsEl = form?.querySelector('[name="timestamp"]');
    if (epEl) epEl.value = formatEpisode(top.episode);
    if (tsEl) tsEl.value = formatTimestamp(top.from);
    acceptAniListId({ form, anilistInput, anilistId: top?.anilist?.id ?? null, mediaCache });
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
      const titleLabel = top?.anilist?.title?.english ?? top?.anilist?.title?.romaji ?? "?";
      const tier = tierFromConfidence(conf);
      traceUi.showMatch({
        thumbSrc: top?.image,
        thumbTitle: top?.filename,
        metaText: [titleLabel, formatEpisode(top?.episode), formatTimestamp(top?.from ?? 0)]
          .filter(Boolean)
          .join(" · "),
        tier
      });
      if (tier === "low") {
        traceUi.setStatus(`No reliable match (best: ${titleLabel} @ ${pct}%).`, "fail");
        traceUi.showClearBtn();
        return;
      }
      traceUi.setStatus(
        tier === "high" ? `Strong match: ${titleLabel} (${pct}%).` : `Possible match: ${titleLabel} (${pct}%).`,
        tier === "high" ? "ok" : "warn"
      );
      traceUi.showInsertBtn(() => {
        applyTraceMoeResult(top);
        traceUi.setStatus(`Inserted: ${titleLabel} (${pct}%).`, "ok");
      });
      traceUi.showClearBtn();
    } catch (err) {
      traceUi.setStatus(`Lookup failed: ${err?.message ?? "unknown error"}.`, "fail");
      traceUi.showClearBtn();
    } finally {
      resetTraceUi();
    }
  }

  traceBtn?.addEventListener("click", runTraceMoeLookup);
  traceUrlBtn?.addEventListener("click", runTraceMoeLookup);

  const sauceKeyInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById("sauceNaoApiKeyInput")
  );
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
    if (sauceBtn) sauceBtn.disabled = !(hasSource && getSauceKey());
  }

  function resetSauceUi() {
    sauceUi.reset();
    updateSauceEnabled();
  }

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
    acceptAniListId({ form, anilistInput, anilistId: top?.data?.anilist_id ?? null, mediaCache });
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
      sauceUi.showMatch({
        thumbSrc: top?.header?.thumbnail,
        metaText: [top?.data?.source, formatEpisode(top?.data?.part), parseSauceEstTime(top?.data?.est_time)]
          .filter(Boolean)
          .join(" · "),
        tier
      });
      if (tier === "low") {
        sauceUi.setStatus(`Low confidence: ${sim.toFixed(2)}%.`, "fail");
        sauceUi.showClearBtn();
        return;
      }
      sauceUi.setStatus(
        tier === "high" ? `Strong match: ${sim.toFixed(2)}%.` : `Possible match: ${sim.toFixed(2)}%.`,
        tier === "high" ? "ok" : "warn"
      );
      sauceUi.showInsertBtn(() => {
        applySauceResult(top);
        sauceUi.setStatus(`Inserted: ${sim.toFixed(2)}%.`, "ok");
      });
      sauceUi.showClearBtn();
    } catch (err) {
      sauceUi.setStatus(`Lookup failed: ${err?.message ?? "unknown error"}.`, "fail");
      sauceUi.showClearBtn();
    } finally {
      updateSauceEnabled();
    }
  });

  fetchBtn?.addEventListener("click", async () => {
    const url = (anilistInput?.value ?? "").trim();
    const parsed = parseAniListUrl(url);
    if (!parsed) {
      alert("Invalid AniList URL");
      return;
    }
    mediaCache.id = parsed.id;
    mediaCache.type = parsed.type;
    try {
      const media = await fetchAniListById(parsed.id);
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

  function applyEnrichmentTitles(row) {
    const a = row?.enrichment?.anilist;
    if (!a) return;
    const setIfBlank = (name, val) => {
      const el = form?.querySelector(`[name="${name}"]`);
      if (el && !String(el.value ?? "").trim() && val) el.value = val;
    };
    setIfBlank("title_en", a.title_en);
    setIfBlank("title_r", a.title_r);
    setIfBlank("title_jp", a.title_jp);
    if (a.id && !mediaCache.id) {
      mediaCache.id = String(a.id);
      mediaCache.type = a.type === "manga" ? "manga" : "anime";
    }
  }

  async function prefillFromSubmission(row) {
    if (!form || !row) return;

    const url = String(row.image_url ?? "").trim();
    if (submitterUsername) {
      submitterUsername.textContent = row.username
        ? `Submitted by: ${row.username}`
        : "Submitted anonymously";
    }
    if (submitterImageLink) {
      submitterImageLink.href = url || "#";
      submitterImageLink.textContent = url || "(no URL)";
    }
    if (submitterImagePreview) {
      if (url) {
        submitterImagePreview.src = url;
        submitterImagePreview.removeAttribute("hidden");
      } else {
        submitterImagePreview.setAttribute("hidden", "");
        submitterImagePreview.removeAttribute("src");
      }
    }
    if (imageUrlInput) imageUrlInput.value = url;

    const notesEl = form.querySelector('[name="notes"]');
    if (notesEl) notesEl.value = notesWithThanks(row.username, row.notes);

    if (anilistInput) anilistInput.value = row.anilist_link ?? "";

    const today = new Date().toISOString().slice(0, 10);
    const dateEl = form.querySelector('[name="date_spotted"]');
    if (dateEl) dateEl.value = row.date_spotted ? normalizeYmd(row.date_spotted) : today;

    const setVal = (name, val) => {
      const el = form.querySelector(`[name="${name}"]`);
      if (el) el.value = val ?? "";
    };
    setVal("title_en", row.title_en);
    setVal("title_r", row.title_r);
    setVal("title_jp", row.title_jp);
    setVal("episode", row.episode);
    setVal("timestamp", row.timestamp);

    if (row.media_id) {
      mediaCache.id = String(row.media_id);
      mediaCache.type = row.media_type ?? null;
    } else {
      const parsed = parseAniListUrl(String(row.anilist_link ?? ""));
      if (parsed) {
        mediaCache.id = parsed.id;
        mediaCache.type = parsed.type;
      } else {
        mediaCache.id = null;
        mediaCache.type = null;
      }
    }

    applyEnrichmentTitles(row);

    if (isReal) isReal.checked = row.lighthouse_type === "real";
    updateTypeUI();
    if (row.lighthouse_type === "real") {
      await loadLighthousesOnce();
      if (lighthouseSelect && row.lighthouse_id != null) {
        lighthouseSelect.value = String(row.lighthouse_id);
      }
    }

    pendingUploadFile = null;
    if (imageFileInput) imageFileInput.value = "";
    setPreviewFromFile(null);
    setImageSourceMode(url ? "url" : "upload");
    updateApproveEnabled();
    resetTraceUi();
    resetSauceUi();
  }

  submissionSelect?.addEventListener("change", async () => {
    clearResult(resultDiv);
    const id = String(submissionSelect.value || "");
    selectedRow = rowById.get(id) || null;

    if (!selectedRow) {
      reviewFormBody?.setAttribute("hidden", "");
      return;
    }

    reviewFormBody?.removeAttribute("hidden");
    await prefillFromSubmission(selectedRow);
  });

  rejectBtn?.addEventListener("click", async () => {
    clearResult(resultDiv);
    const id = String(submissionSelect?.value || "");
    if (!id) {
      setResult(resultDiv, { kind: "error", text: "Select a submission first." });
      return;
    }
    if (!confirm("Reject and delete this submission?")) return;
    try {
      const { error } = await supabaseClient.from("sighting_submissions").delete().eq("id", Number(id));
      if (error) throw error;
      setResult(resultDiv, { kind: "success", text: `Submission #${id} rejected.` });
      const { rowById: loaded } = await loadSubmissionsForSelect({ selectEl: submissionSelect });
      rowById = loaded;
      submissionSelect.value = "";
      reviewFormBody?.setAttribute("hidden", "");
      selectedRow = null;
    } catch (err) {
      console.error(err);
      setResult(resultDiv, { kind: "error", text: "Error: " + (err?.message ?? "Unknown error") });
    }
  });

  approveBtn?.addEventListener("click", async () => {
    clearResult(resultDiv);
    const id = String(submissionSelect?.value || "");
    if (!id || !selectedRow) {
      setResult(resultDiv, { kind: "error", text: "Select a submission first." });
      return;
    }
    if (!pendingUploadFile) {
      setResult(resultDiv, { kind: "error", text: "Upload an image before approving." });
      return;
    }

    try {
      if (approveBtn) approveBtn.disabled = true;
      setResult(resultDiv, { kind: "", text: "Uploading image…" });

      const processed = await processImageToWebp(pendingUploadFile);
      const dateVal = form.querySelector('[name="date_spotted"]')?.value;
      const ymd =
        dateVal && String(dateVal).trim()
          ? normalizeYmd(dateVal)
          : new Date().toISOString().slice(0, 10);
      const shortId = shortIdHex8();
      const mediaId = String(mediaCache.id ?? "").trim();
      const objectPath = mediaId
        ? `sightings/${ymd}_${mediaId}_${shortId}.webp`
        : `sightings/${ymd}_${shortId}.webp`;

      const { error: uploadError } = await supabaseClient.storage
        .from(STORAGE_BUCKET)
        .upload(objectPath, processed.blob, { contentType: "image/webp", upsert: false });
      if (uploadError) throw uploadError;

      const { data: publicData } = supabaseClient.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath);
      const publicUrl = publicData?.publicUrl;
      if (!publicUrl) throw new Error("Failed to generate public URL.");

      const payload = buildSightingPayloadFromForm(form, { isReal, mediaCache });
      if (!payload.date_spotted) payload.date_spotted = ymd;
      payload.image_link = [publicUrl];

      setResult(resultDiv, { kind: "", text: "Approving…" });
      const { data: newId, error: rpcError } = await supabaseClient.rpc("approve_sighting_submission", {
        p_submission_id: Number(id),
        p_sighting: payload
      });
      if (rpcError) throw rpcError;

      setResult(resultDiv, {
        kind: "success",
        text: `Approved as sighting #${newId}. Submission removed from queue.`
      });

      const { rowById: loaded } = await loadSubmissionsForSelect({ selectEl: submissionSelect });
      rowById = loaded;
      submissionSelect.value = "";
      reviewFormBody?.setAttribute("hidden", "");
      selectedRow = null;
      pendingUploadFile = null;
    } catch (err) {
      console.error(err);
      setResult(resultDiv, { kind: "error", text: "Error: " + (err?.message ?? "Unknown error") });
    } finally {
      updateApproveEnabled();
    }
  });

  if (submissionSelect) {
    const { rowById: loaded } = await loadSubmissionsForSelect({ selectEl: submissionSelect });
    rowById = loaded;
  }

  updateTypeUI();
  updateApproveEnabled();
});
