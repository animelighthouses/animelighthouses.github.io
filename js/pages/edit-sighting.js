/**
 * Edit existing sighting metadata (edit.html): OAuth gate, row picker,
 * prefilled form, AniList refetch, trace.moe / SauceNAO on first stored image.
 * Images are edited on submiti.html only.
 */

import supabaseClient from "../supabaseClient.js";
import {
  acceptAniListId,
  createMediaCache,
  fetchAniListById,
  parseAniListUrl
} from "./aniListClient.js";
import { clearResult, nullifyEmptyStrings, setResult } from "./formUtils.js";
import {
  handleSubmitAuthButtonClick,
  setFormEnabledFromSession
} from "./submitAuth.js";
import { loadSightingsForSelect, normalizeYmd } from "./sightingSelect.js";
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

const EDIT_COLUMNS =
  "id, date_spotted, title_en, title_r, title_jp, media_id, media_type, anilist_link, episode, timestamp, lighthouse_id, lighthouse_type, image_link, notes";

document.addEventListener("DOMContentLoaded", async () => {
  const form = /** @type {HTMLFormElement | null} */ (document.getElementById("editForm"));
  const loginBtn = document.getElementById("loginBtn");
  const noticeEl = document.getElementById("submitAdminNotice");
  const resultDiv = document.getElementById("result");
  const sightingSelect = /** @type {HTMLSelectElement | null} */ (
    document.getElementById("sightingSelect")
  );

  loginBtn?.addEventListener("click", () =>
    handleSubmitAuthButtonClick({ form, loginBtn, noticeEl })
  );
  await setFormEnabledFromSession({ form, loginBtn, noticeEl });

  const isReal = /** @type {HTMLInputElement | null} */ (document.getElementById("isReal"));
  const lighthouseSection = document.getElementById("lighthouseSection");
  const lighthouseSelect = /** @type {HTMLSelectElement | null} */ (
    document.getElementById("lighthouseSelect")
  );
  const storedImagePreview = /** @type {HTMLImageElement | null} */ (
    document.getElementById("storedImagePreview")
  );
  const anilistInput = /** @type {HTMLInputElement | null} */ (document.getElementById("anilistInput"));
  const fetchBtn = document.getElementById("anilistFetchBtn");
  const mediaCache = createMediaCache();

  let rowById = new Map();
  /** @type {any | null} */
  let selectedRow = null;
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

  function getStoredImageUrl() {
    const urls = Array.isArray(selectedRow?.image_link) ? selectedRow.image_link : [];
    return String(urls[0] ?? "").trim();
  }

  function getStoredImageSource() {
    return { kind: "url", url: getStoredImageUrl() };
  }

  function updateStoredImagePreview() {
    const url = getStoredImageUrl();
    if (!storedImagePreview) return;
    if (url) {
      storedImagePreview.src = url;
      storedImagePreview.removeAttribute("hidden");
    } else {
      storedImagePreview.setAttribute("hidden", "");
      storedImagePreview.removeAttribute("src");
    }
  }

  const traceBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById("traceMoeFetchBtn"));
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
    const hasImage = Boolean(getStoredImageUrl());
    if (traceBtn) traceBtn.disabled = !hasImage;
    if (selectedRow && !hasImage) {
      traceUi.setStatus("No stored image — use Edit images to add one.", "warn");
    }
  }

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

  traceBtn?.addEventListener("click", async () => {
    const src = getStoredImageSource();
    if (!src.url) return;

    if (traceBtn) traceBtn.disabled = true;
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
  });

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
    const hasImage = Boolean(getStoredImageUrl());
    const hasKey = Boolean(getSauceKey());
    if (sauceBtn) sauceBtn.disabled = !(hasImage && hasKey);
  }

  function resetSauceUi() {
    sauceUi.reset();
    updateSauceEnabled();
    if (selectedRow && !getStoredImageUrl()) {
      sauceUi.setStatus("No stored image — use Edit images to add one.", "warn");
    }
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

    acceptAniListId({
      form,
      anilistInput,
      anilistId: top?.data?.anilist_id ?? null,
      mediaCache
    });
  }

  sauceBtn?.addEventListener("click", async () => {
    const src = getStoredImageSource();
    if (!src.url) return;

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

  async function prefillForm(row) {
    if (!form || !row) return;

    const dateEl = form.querySelector('[name="date_spotted"]');
    if (dateEl) dateEl.value = normalizeYmd(row.date_spotted);

    const setVal = (name, val) => {
      const el = form.querySelector(`[name="${name}"]`);
      if (el) el.value = val ?? "";
    };

    setVal("title_en", row.title_en);
    setVal("title_r", row.title_r);
    setVal("title_jp", row.title_jp);
    setVal("episode", row.episode);
    setVal("timestamp", row.timestamp);
    setVal("anilist_link", row.anilist_link);
    setVal("notes", row.notes);

    mediaCache.id = row.media_id ? String(row.media_id) : null;
    mediaCache.type = row.media_type || null;

    const isRealRow = row.lighthouse_type === "real";
    if (isReal) isReal.checked = isRealRow;
    updateTypeUI();

    if (isRealRow) {
      await loadLighthousesOnce();
      if (lighthouseSelect && row.lighthouse_id != null) {
        lighthouseSelect.value = String(row.lighthouse_id);
      }
    }

    updateStoredImagePreview();
    resetTraceUi();
    resetSauceUi();
  }

  function selectRowById(id) {
    if (!sightingSelect) return;
    const key = String(id || "");
    if (!rowById.has(key)) return;
    sightingSelect.value = key;
    sightingSelect.dispatchEvent(new Event("change"));
  }

  sightingSelect?.addEventListener("change", async () => {
    clearResult(resultDiv);
    traceUi.reset();
    sauceUi.reset();

    const id = String(sightingSelect.value || "");
    selectedRow = rowById.get(id) || null;

    if (!selectedRow) {
      form?.reset();
      updateTypeUI();
      updateStoredImagePreview();
      resetTraceUi();
      resetSauceUi();
      if (sauceKeyInput) sauceKeyInput.value = getSauceKey();
      return;
    }

    await prefillForm(selectedRow);
  });

  if (sightingSelect) {
    const { rowById: loaded } = await loadSightingsForSelect({
      selectEl: sightingSelect,
      columns: EDIT_COLUMNS
    });
    rowById = loaded;

    const params = new URLSearchParams(window.location.search);
    const idParam = params.get("id");
    if (idParam) selectRowById(idParam);
  }

  form?.addEventListener("submit", async e => {
    e.preventDefault();
    clearResult(resultDiv);

    const id = String(sightingSelect?.value || "");
    if (!id) {
      setResult(resultDiv, { kind: "error", text: "Please select a sighting row." });
      return;
    }

    const fd = new FormData(form);
    const formData = Object.fromEntries(fd);
    nullifyEmptyStrings(formData);

    delete formData.sighting_id;

    if (isReal?.checked) {
      formData.lighthouse_type = "real";
    } else {
      formData.lighthouse_type = "fictional";
      formData.lighthouse_id = null;
    }

    if (mediaCache.id) formData.media_id = mediaCache.id;
    if (mediaCache.type) formData.media_type = mediaCache.type;

    try {
      setResult(resultDiv, { kind: "", text: "Saving…" });

      const { data, error } = await supabaseClient
        .from("sightings")
        .update(formData)
        .eq("id", Number(id))
        .select("id")
        .single();

      if (error) throw error;

      setResult(resultDiv, {
        kind: "success",
        text: `Sighting #${data.id} updated successfully.`
      });

      const merged = { ...selectedRow, ...formData, id: Number(id) };
      rowById.set(id, merged);
      selectedRow = merged;
    } catch (err) {
      console.error(err);
      setResult(resultDiv, {
        kind: "error",
        text: "Error: " + (err?.message ? String(err.message) : "Unknown error")
      });
    }
  });

  updateTypeUI();
  resetTraceUi();
  resetSauceUi();
});
