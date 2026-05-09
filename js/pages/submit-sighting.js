/**
 * Sighting submission for submit.html: GitHub OAuth gate, optional real lighthouse link,
 * AniList URL fetch (GraphQL) to prefill titles and media id/type,
 * trace.moe screenshot lookup (three-tier confidence) to prefill episode/timestamp
 * (and AniList side when those fields are still empty), insert into Supabase.
 *
 * Flow: nav + session → real/fictional UI + lighthouse list when needed → AniList / trace.moe → submit.
 */

import supabaseClient from "../supabaseClient.js";
import { initSubmitNav } from "../nav.js";
import {
  handleSubmitAuthButtonClick,
  setFormEnabledFromSession
} from "./submitAuth.js";

const STORAGE_BUCKET = "sightings-images";
const MAX_IMAGE_WIDTH = 1920;
const MAX_IMAGE_HEIGHT = 1920;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // pre-processing limit (input file)

// trace.moe (https://soruly.github.io/trace.moe-api/#/docs).
// Anonymous tier; raw image bytes posted as request body. anilistInfo=1 expands
// the result's `anilist` field to include titles. cutBorders trims letterbox.
const TRACE_MOE_ENDPOINT = "https://api.trace.moe/search?anilistInfo=1&cutBorders";
// Three-tier confidence thresholds. Tweak here if matches feel too permissive
// or too strict — TRACE_HIGH auto-accepts, TRACE_LOW is the failure floor.
const TRACE_HIGH = 0.9;
const TRACE_LOW = 0.75;

// SauceNAO (https://saucenao.com/user.php?page=search-api).
const SAUCENAO_ENDPOINT = "https://saucenao.com/search.php";
const SAUCENAO_STORAGE_KEY = "animelighthouse.saucenaoKey";
// Anime* index (db=21) yields part (episode) + est_time (timestamp/duration) when available.
const SAUCENAO_DB_ANIME = 21;
// SauceNAO similarity is a percent string; these thresholds are tuned separately
// from trace.moe similarity (0..1).
const SAUCE_HIGH = 80;
const SAUCE_LOW = 60;

function getPica() {
  // Provided by <script src="https://cdn.jsdelivr.net/npm/pica@9.0.1/dist/pica.min.js"></script>
  const factory = globalThis?.pica;
  if (typeof factory !== "function") {
    throw new Error("Image resizer (pica) failed to load. Check network/CDN.");
  }
  return factory();
}

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

/** Turn empty string fields into null before database insert. */
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

/**
 * Fetch romaji/english/native titles + media type from AniList by numeric id.
 * Returns the `Media` object or null. Shared by the AniList Fetch button and
 * the trace.moe high-confidence auto-chain.
 */
async function fetchAniListById(id) {
  const query = `
    query ($id: Int) {
      Media(id: $id) {
        title { romaji english native }
        type
      }
    }
  `;
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { id: Number(id) } })
  });
  const json = await res.json();
  return json?.data?.Media ?? null;
}

/** Episode formatter: numeric -> `E<nn>` (0–9 padded to two digits), else pass-through (e.g. "OVA"). */
function formatEpisode(ep) {
  if (ep == null || ep === "") return "";
  const s = String(ep);
  if (!/^\d+$/.test(s)) return s;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n)) return s;
  if (n >= 0 && n <= 9) return `E${String(n).padStart(2, "0")}`;
  return `E${s}`;
}

/** Seconds-from-start (float) -> `hh:mm:ss`. */
function formatTimestamp(secondsFromStart) {
  if (typeof secondsFromStart !== "number" || !Number.isFinite(secondsFromStart)) return "";
  const total = Math.max(0, Math.floor(secondsFromStart));
  const hh = String(Math.floor(total / 3600)).padStart(2, "0");
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * POST raw image bytes to trace.moe and return the top-similarity result.
 * Body is the File itself (NOT multipart). Throws on non-2xx or empty result.
 */
async function queryTraceMoe(file) {
  const res = await fetch(TRACE_MOE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`trace.moe ${res.status}: ${txt || res.statusText}`);
  }
  const json = await res.json();
  const top = Array.isArray(json?.result) ? json.result[0] : null;
  if (!top) throw new Error("No match returned.");
  return top;
}

async function queryTraceMoeUrl(url) {
  const u = String(url ?? "").trim();
  if (!u) throw new Error("Please enter an image URL.");
  const endpoint = `${TRACE_MOE_ENDPOINT}&url=${encodeURIComponent(u)}`;
  const res = await fetch(endpoint);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`trace.moe ${res.status}: ${txt || res.statusText}`);
  }
  const json = await res.json();
  const top = Array.isArray(json?.result) ? json.result[0] : null;
  if (!top) throw new Error("No match returned.");
  return top;
}

function parseSauceEstTime(estTime) {
  // SauceNAO Anime* format: "<timestamp> / <episode length>"
  const raw = String(estTime ?? "");
  const left = raw.split("/")[0]?.trim() ?? "";
  return left;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function shortIdHex8() {
  const bytes = new Uint8Array(4); // 8 hex chars
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

function slugify(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  return raw
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function extFromMime(mime) {
  const m = String(mime ?? "").toLowerCase();
  if (m === "image/jpeg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  return "";
}

function assertImageFile(file) {
  if (!file) throw new Error("Please select an image file.");
  if (!(file instanceof File)) throw new Error("Invalid file.");
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`Image is too large (max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB).`);
  }
  const ext = extFromMime(file.type);
  if (!ext) throw new Error("Unsupported image type. Use JPEG, PNG, or WebP.");
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error("Failed to encode image."))),
      type,
      quality
    );
  });
}

async function processImageToWebp(
  file,
  { maxWidth = MAX_IMAGE_WIDTH, maxHeight = MAX_IMAGE_HEIGHT } = {}
) {
  assertImageFile(file);

  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  if (!srcW || !srcH) throw new Error("Invalid image.");

  const scale = Math.min(1, maxWidth / srcW, maxHeight / srcH);
  const dstW = Math.max(1, Math.round(srcW * scale));
  const dstH = Math.max(1, Math.round(srcH * scale));

  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const srcCtx = srcCanvas.getContext("2d", { alpha: false });
  if (!srcCtx) throw new Error("Canvas unavailable.");
  srcCtx.drawImage(bitmap, 0, 0);

  const dstCanvas = document.createElement("canvas");
  dstCanvas.width = dstW;
  dstCanvas.height = dstH;

  if (dstW !== srcW || dstH !== srcH) {
    const pica = getPica();
    await pica.resize(srcCanvas, dstCanvas, {
      quality: 3,
      alpha: false
    });
  } else {
    const dstCtx = dstCanvas.getContext("2d", { alpha: false });
    if (!dstCtx) throw new Error("Canvas unavailable.");
    dstCtx.drawImage(srcCanvas, 0, 0);
  }

  const isPng = file.type === "image/png";
  const quality = clamp(isPng ? 0.9 : 0.8, 0.6, 0.95);
  const webpBlob = await toBlob(dstCanvas, "image/webp", quality);

  return { blob: webpBlob, width: dstW, height: dstH };
}

document.addEventListener("DOMContentLoaded", async () => {
  // --- Nav + auth (GitHub session gates the form) -----------------------------
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

  // --- Image source: Upload vs URL (lookup-only for URL mode) -----------------
  const imageSourceUploadBtn = document.getElementById("imageSourceUploadBtn");
  const imageSourceUrlBtn = document.getElementById("imageSourceUrlBtn");
  const imageUploadRow = document.getElementById("imageUploadRow");
  const imageUrlRow = document.getElementById("imageUrlRow");
  const imageUrlInput = document.getElementById("imageUrlInput");
  const imageFileInput = document.getElementById("imageFileInput") || form?.querySelector('[name="image_file"]');
  const imagePreview = document.getElementById("imagePreview");

  /** @type {"upload"|"url"} */
  let imageSourceMode = "upload";
  let previewObjectUrl = null;

  function setImageSourceMode(mode) {
    imageSourceMode = mode === "url" ? "url" : "upload";

    if (imageUploadRow) imageUploadRow.toggleAttribute("hidden", imageSourceMode !== "upload");
    if (imageUrlRow) imageUrlRow.toggleAttribute("hidden", imageSourceMode !== "url");

    if (imageSourceUploadBtn) imageSourceUploadBtn.classList.toggle("is-active", imageSourceMode === "upload");
    if (imageSourceUrlBtn) imageSourceUrlBtn.classList.toggle("is-active", imageSourceMode === "url");

    // Switching modes invalidates any prior lookup state, but keeps the user's inputs.
    resetTraceUi();
    resetSauceUi();

    // Update preview based on active mode.
    if (imageSourceMode === "upload") {
      const file = imageFileInput?.files?.[0] ?? null;
      if (!file || !imagePreview) return;
      // The change handler will update preview; don't duplicate work.
    } else {
      if (!imagePreview) return;
      const url = String(imageUrlInput?.value ?? "").trim();
      if (!url) {
        imagePreview.setAttribute("hidden", "");
        imagePreview.removeAttribute("src");
        return;
      }
      imagePreview.src = url;
      imagePreview.removeAttribute("hidden");
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
    if (imagePreview) {
      if (!hasUrl) {
        imagePreview.setAttribute("hidden", "");
        imagePreview.removeAttribute("src");
      } else {
        imagePreview.src = url;
        imagePreview.removeAttribute("hidden");
      }
    }
    // Sauce button enablement depends on key + source; computed below.
    updateSauceEnabled();
  });

  imagePreview?.addEventListener("error", () => {
    if (imageSourceMode === "url") {
      // Keep the user in URL mode, but make failure visible without blocking.
      setTraceStatus("Image preview failed to load. URL may be invalid or blocked by CORS.", "warn");
    }
  });

  // --- AniList: cache media_id / media_type for submit payload ---------------
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
  // Other fields (anilist_link / cachedMediaId / cachedMediaType / titles)
  // are only ever set if currently empty/null — never overwritten.
  const traceBtn = document.getElementById("traceMoeFetchBtn");
  const traceUrlBtn = document.getElementById("traceMoeFetchBtnUrl");
  const traceInsertBtn = document.getElementById("traceMoeInsertBtn");
  const traceClearBtn = document.getElementById("traceMoeClearBtn");
  const traceStatus = document.getElementById("traceMoeStatus");
  const traceMatch = document.getElementById("traceMoeMatch");
  const traceThumb = document.getElementById("traceMoeThumb");
  const traceMeta = document.getElementById("traceMoeMeta");

  function setTraceStatus(text, state = "") {
    if (!traceStatus) return;
    traceStatus.textContent = text ?? "";
    if (state) traceStatus.dataset.state = state;
    else delete traceStatus.dataset.state;
  }

  function clearTraceMatch() {
    if (traceMatch) {
      traceMatch.setAttribute("hidden", "");
      delete traceMatch.dataset.tier;
    }
    if (traceThumb) traceThumb.removeAttribute("src");
    if (traceMeta) traceMeta.textContent = "";
  }

  function showTraceMatch(top, tier) {
    if (!traceMatch || !traceThumb || !traceMeta) return;
    if (top?.image) traceThumb.src = top.image;
    if (top?.filename) traceThumb.title = top.filename;
    const titleLabel =
      top?.anilist?.title?.english ?? top?.anilist?.title?.romaji ?? "?";
    const epLabel = formatEpisode(top?.episode); // "" when null/missing — omitted below
    const parts = [titleLabel];
    if (epLabel) parts.push(epLabel);
    parts.push(formatTimestamp(top?.from ?? 0));
    traceMeta.textContent = parts.join(" · ");
    traceMatch.dataset.tier = tier;
    traceMatch.removeAttribute("hidden");
  }

  function hideTraceInsertBtn() {
    if (!traceInsertBtn) return;
    traceInsertBtn.setAttribute("hidden", "");
    traceInsertBtn.onclick = null;
  }

  function showTraceInsertBtn(onClick) {
    if (!traceInsertBtn) return;
    traceInsertBtn.removeAttribute("hidden");
    traceInsertBtn.onclick = () => {
      hideTraceInsertBtn();
      onClick();
    };
  }

  function showTraceClearBtn() {
    if (traceClearBtn) traceClearBtn.removeAttribute("hidden");
  }

  function hideTraceClearBtn() {
    if (traceClearBtn) traceClearBtn.setAttribute("hidden", "");
  }

  function resetTraceUi() {
    setTraceStatus("");
    clearTraceMatch();
    hideTraceInsertBtn();
    hideTraceClearBtn();
    const src = getActiveImageSource();
    const hasSource = src.kind === "file" ? Boolean(src.file) : Boolean(src.url);
    if (traceBtn) traceBtn.disabled = !(imageSourceMode === "upload" && hasSource);
    if (traceUrlBtn) traceUrlBtn.disabled = !(imageSourceMode === "url" && hasSource);
  }

  // Clear dismisses the trace.moe interface (status / match panel / Insert)
  // without touching the selected image, so the user can re-query if needed.
  traceClearBtn?.addEventListener("click", resetTraceUi);

  /**
   * Apply an accepted trace.moe result to the form.
   * Episode + timestamp always overwrite; AniList side only fills when empty.
   * autoAniList=true chains a GraphQL lookup to fill blank title fields.
   */
  function applyTraceMoeResult(top, { autoAniList }) {
    const epEl = form?.querySelector('[name="episode"]');
    const tsEl = form?.querySelector('[name="timestamp"]');
    if (epEl) epEl.value = formatEpisode(top.episode);
    if (tsEl) tsEl.value = formatTimestamp(top.from);

    const anilistId = top?.anilist?.id ?? null;
    if (anilistId) {
      if (cachedMediaId == null) cachedMediaId = String(anilistId);
      if (cachedMediaType == null) cachedMediaType = "anime";
      if (anilistInput && !anilistInput.value.trim()) {
        anilistInput.value = `https://anilist.co/anime/${anilistId}`;
      }
    }

    if (autoAniList && anilistId) {
      fetchAniListById(anilistId)
        .then(media => {
          if (!media) return;
          const titleEnEl = form?.querySelector('[name="title_en"]');
          const titleREl = form?.querySelector('[name="title_r"]');
          const titleJpEl = form?.querySelector('[name="title_jp"]');
          const isEmpty = el => !el || !el.value.trim();
          if (isEmpty(titleEnEl)) {
            titleEnEl.value = media.title.english || media.title.romaji || "";
          }
          if (isEmpty(titleREl)) titleREl.value = media.title.romaji || "";
          if (isEmpty(titleJpEl)) titleJpEl.value = media.title.native || "";
          // Refine cachedMediaType to AniList's authoritative value (anime|manga).
          if (media.type) cachedMediaType = String(media.type).toLowerCase();
        })
        .catch(e => console.warn("AniList auto-fetch failed:", e));
    }
  }

  async function runTraceMoeLookup() {
    const src = getActiveImageSource();
    if (src.kind === "file" && !src.file) return;
    if (src.kind === "url" && !src.url) return;

    if (traceBtn) traceBtn.disabled = true;
    if (traceUrlBtn) traceUrlBtn.disabled = true;
    hideTraceInsertBtn();
    clearTraceMatch();
    setTraceStatus("Identifying…");

    try {
      const top = src.kind === "file" ? await queryTraceMoe(src.file) : await queryTraceMoeUrl(src.url);
      const conf = Number(top.similarity ?? 0);
      const pct = (conf * 100).toFixed(1);
      const titleLabel =
        top?.anilist?.title?.english ?? top?.anilist?.title?.romaji ?? "?";

      if (conf < TRACE_LOW) {
        showTraceMatch(top, "low");
        setTraceStatus(
          `No reliable match (best: ${titleLabel} @ ${pct}%). Verify manually.`,
          "fail"
        );
        showTraceClearBtn();
        return;
      }

      // High and mid tiers both require explicit confirmation via the Insert
      // button. Only the styling and label wording differ; on click both run
      // applyTraceMoeResult with autoAniList=true so the AniList GraphQL
      // chain runs after the user accepts.
      const isHigh = conf >= TRACE_HIGH;
      showTraceMatch(top, isHigh ? "high" : "mid");
      setTraceStatus(
        isHigh
          ? `Strong match: ${titleLabel} (${pct}%).`
          : `Possible match: ${titleLabel} (${pct}%).`,
        isHigh ? "ok" : "warn"
      );
      showTraceInsertBtn(() => {
        applyTraceMoeResult(top, { autoAniList: true });
        setTraceStatus(`Inserted: ${titleLabel} (${pct}%).`, "ok");
      });
      showTraceClearBtn();
    } catch (err) {
      console.error(err);
      setTraceStatus(`Lookup failed: ${err?.message ?? "unknown error"}.`, "fail");
      showTraceClearBtn();
    } finally {
      resetTraceUi();
    }
  }

  traceBtn?.addEventListener("click", runTraceMoeLookup);
  traceUrlBtn?.addEventListener("click", runTraceMoeLookup);

  // --- SauceNAO: backup identification (Anime* index only) --------------------
  const sauceKeyInput = document.getElementById("sauceNaoApiKeyInput");
  const sauceBtn = document.getElementById("sauceNaoFetchBtn");
  const sauceInsertBtn = document.getElementById("sauceNaoInsertBtn");
  const sauceClearBtn = document.getElementById("sauceNaoClearBtn");
  const sauceStatus = document.getElementById("sauceNaoStatus");
  const sauceMatch = document.getElementById("sauceNaoMatch");
  const sauceThumb = document.getElementById("sauceNaoThumb");
  const sauceMeta = document.getElementById("sauceNaoMeta");

  function setSauceStatus(text, state = "") {
    if (!sauceStatus) return;
    sauceStatus.textContent = text ?? "";
    if (state) sauceStatus.dataset.state = state;
    else delete sauceStatus.dataset.state;
  }

  function clearSauceMatch() {
    if (sauceMatch) {
      sauceMatch.setAttribute("hidden", "");
      delete sauceMatch.dataset.tier;
    }
    if (sauceThumb) sauceThumb.removeAttribute("src");
    if (sauceMeta) sauceMeta.textContent = "";
  }

  function showSauceMatch(top, tier) {
    if (!sauceMatch || !sauceThumb || !sauceMeta) return;
    if (top?.header?.thumbnail) sauceThumb.src = top.header.thumbnail;
    const source = top?.data?.source ?? "?";
    const epLabel = formatEpisode(top?.data?.part);
    const ts = parseSauceEstTime(top?.data?.est_time);
    const sim = String(top?.header?.similarity ?? "").trim();
    const parts = [source];
    if (epLabel) parts.push(epLabel);
    if (ts) parts.push(ts);
    if (sim) parts.push(`${sim}%`);
    sauceMeta.textContent = parts.join(" · ");
    sauceMatch.dataset.tier = tier;
    sauceMatch.removeAttribute("hidden");
  }

  function hideSauceInsertBtn() {
    if (!sauceInsertBtn) return;
    sauceInsertBtn.setAttribute("hidden", "");
    sauceInsertBtn.onclick = null;
  }

  function showSauceInsertBtn(onClick) {
    if (!sauceInsertBtn) return;
    sauceInsertBtn.removeAttribute("hidden");
    sauceInsertBtn.onclick = () => {
      hideSauceInsertBtn();
      onClick();
    };
  }

  function showSauceClearBtn() {
    if (sauceClearBtn) sauceClearBtn.removeAttribute("hidden");
  }

  function hideSauceClearBtn() {
    if (sauceClearBtn) sauceClearBtn.setAttribute("hidden", "");
  }

  function getSauceKey() {
    try {
      return localStorage.getItem(SAUCENAO_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  }

  function setSauceKey(value) {
    const v = String(value ?? "").trim();
    try {
      if (v) localStorage.setItem(SAUCENAO_STORAGE_KEY, v);
      else localStorage.removeItem(SAUCENAO_STORAGE_KEY);
    } catch (_) {}
  }

  function updateSauceEnabled() {
    const src = getActiveImageSource();
    const hasSource = src.kind === "file" ? Boolean(src.file) : Boolean(src.url);
    const hasKey = Boolean(getSauceKey());
    if (sauceBtn) sauceBtn.disabled = !(hasSource && hasKey);
  }

  function resetSauceUi() {
    setSauceStatus("");
    clearSauceMatch();
    hideSauceInsertBtn();
    hideSauceClearBtn();
    updateSauceEnabled();
  }

  sauceClearBtn?.addEventListener("click", resetSauceUi);

  // Initialize key input from localStorage.
  if (sauceKeyInput) sauceKeyInput.value = getSauceKey();
  sauceKeyInput?.addEventListener("input", () => {
    setSauceKey(sauceKeyInput.value);
    resetSauceUi();
  });

  async function querySauceNao(source) {
    const key = getSauceKey();
    if (!key) throw new Error("Missing SauceNAO API key.");

    const payload = {
      apiKey: key,
      db: SAUCENAO_DB_ANIME,
      numres: 3,
      dedupe: 2
    };

    if (source.kind === "url") {
      const { data, error } = await supabaseClient.functions.invoke("saucenao-proxy", {
        body: { ...payload, url: source.url }
      });
      if (error) throw error;
      return data;
    }

    // Upload mode: send image bytes as a base64 data URL to the edge function.
    const imageBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read image file."));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(source.file);
    });

    const { data, error } = await supabaseClient.functions.invoke("saucenao-proxy", {
      body: { ...payload, imageBase64 }
    });
    if (error) throw error;
    return data;
  }

  function applySauceResult(top) {
    const epEl = form?.querySelector('[name="episode"]');
    const tsEl = form?.querySelector('[name="timestamp"]');

    const epRaw = top?.data?.part ?? null;
    const ep = formatEpisode(epRaw);
    const ts = parseSauceEstTime(top?.data?.est_time);

    if (epEl) epEl.value = ep;
    if (tsEl) tsEl.value = ts;

    const anilistId = top?.data?.anilist_id ?? null;
    if (anilistId) {
      if (cachedMediaId == null) cachedMediaId = String(anilistId);
      if (cachedMediaType == null) cachedMediaType = "anime";
      if (anilistInput && !anilistInput.value.trim()) {
        anilistInput.value = `https://anilist.co/anime/${anilistId}`;
      }
      // After accept, auto-run AniList fetch to fill blank titles and refine media_type.
      fetchAniListById(anilistId)
        .then(media => {
          if (!media) return;
          const titleEnEl = form?.querySelector('[name="title_en"]');
          const titleREl = form?.querySelector('[name="title_r"]');
          const titleJpEl = form?.querySelector('[name="title_jp"]');
          const isEmpty = el => !el || !el.value.trim();
          if (isEmpty(titleEnEl)) {
            titleEnEl.value = media.title.english || media.title.romaji || "";
          }
          if (isEmpty(titleREl)) titleREl.value = media.title.romaji || "";
          if (isEmpty(titleJpEl)) titleJpEl.value = media.title.native || "";
          if (media.type) cachedMediaType = String(media.type).toLowerCase();
        })
        .catch(e => console.warn("AniList auto-fetch failed:", e));
    }
  }

  sauceBtn?.addEventListener("click", async () => {
    const src = getActiveImageSource();
    if (src.kind === "file" && !src.file) return;
    if (src.kind === "url" && !src.url) return;

    if (sauceBtn) sauceBtn.disabled = true;
    hideSauceInsertBtn();
    clearSauceMatch();
    setSauceStatus("Searching…");

    try {
      const json = await querySauceNao(src);
      const top = Array.isArray(json?.results) ? json.results[0] : null;
      if (!top) throw new Error("No results returned.");

      const sim = Number.parseFloat(top?.header?.similarity ?? "0");
      const isHigh = sim >= SAUCE_HIGH;
      const isOk = sim >= SAUCE_LOW;

      if (!isOk) {
        showSauceMatch(top, "low");
        setSauceStatus(`Low confidence: ${sim.toFixed(2)}%.`, "fail");
        showSauceClearBtn();
        return;
      }

      showSauceMatch(top, isHigh ? "high" : "mid");
      setSauceStatus(
        isHigh ? `Strong match: ${sim.toFixed(2)}%.` : `Possible match: ${sim.toFixed(2)}%.`,
        isHigh ? "ok" : "warn"
      );
      showSauceInsertBtn(() => {
        applySauceResult(top);
        setSauceStatus(`Inserted: ${sim.toFixed(2)}%.`, "ok");
      });
      showSauceClearBtn();
    } catch (err) {
      console.error(err);
      setSauceStatus(`Lookup failed: ${err?.message ?? "unknown error"}.`, "fail");
      showSauceClearBtn();
    } finally {
      updateSauceEnabled();
    }
  });

  // --- Date spotted + image defaults -----------------------------------------
  const dateSpottedInput = form?.querySelector('[name="date_spotted"]');

  function initDateAndImageDefaults() {
    if (dateSpottedInput) dateSpottedInput.value = todayYmd();
    if (imageFileInput) imageFileInput.value = "";
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
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
    }

    // New / cleared file invalidates any previous trace.moe lookup.
    resetTraceUi();
    resetSauceUi();

    if (!file || !imagePreview) return;
    try {
      assertImageFile(file);
    } catch (e) {
      alert(e?.message ?? "Invalid image.");
      imageFileInput.value = "";
      imagePreview.setAttribute("hidden", "");
      imagePreview.removeAttribute("src");
      resetTraceUi();
      resetSauceUi();
      return;
    }

    previewObjectUrl = URL.createObjectURL(file);
    imagePreview.src = previewObjectUrl;
    imagePreview.removeAttribute("hidden");
    if (imageSourceMode === "upload" && traceBtn) traceBtn.disabled = false;
    updateSauceEnabled();
  });

  // --- Submit to Supabase -----------------------------------------------------
  form?.addEventListener("submit", async e => {
    e.preventDefault();

    if (resultDiv) {
      resultDiv.style.display = "none";
      resultDiv.className = "result";
    }

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

    if (cachedMediaId) formData.media_id = cachedMediaId;
    if (cachedMediaType) formData.media_type = cachedMediaType;

    try {
      const file = imageFileInput?.files?.[0] ?? null;
      if (!file) {
        throw new Error("Please upload an image before submitting.");
      }

      const ymd = dateSpottedInput?.value ?? todayYmd();
      const shortId = shortIdHex8();
      const objectPath = cachedMediaId
        ? `sightings/${ymd}_${cachedMediaId}_${shortId}.webp`
        : `sightings/${ymd}_${shortId}.webp`;

      const processed = await processImageToWebp(file);

      const { error: uploadError } = await supabaseClient.storage
        .from(STORAGE_BUCKET)
        .upload(objectPath, processed.blob, {
          contentType: "image/webp",
          upsert: false
        });
      if (uploadError) throw uploadError;

      const { data: publicData } = supabaseClient.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(objectPath);

      const publicUrl = publicData?.publicUrl;
      if (!publicUrl) throw new Error("Failed to generate public URL.");

      formData.image_link = [publicUrl];

      const { data, error } = await supabaseClient
        .from("sightings")
        .insert([formData])
        .select("id")
        .single();

      if (error) throw error;

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
    } catch (err) {
      console.error(err);
      const msg = err?.message ? String(err.message) : "Unknown error";
      if (resultDiv) {
        resultDiv.textContent = "Error: " + msg;
        resultDiv.classList.add("error");
        resultDiv.style.display = "block";
      }
    }
  });
});
