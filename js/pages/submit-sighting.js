/**
 * Sighting submission for submit.html: GitHub OAuth gate, optional real lighthouse link,
 * AniList URL fetch (GraphQL) to prefill titles and media id/type, insert into Supabase.
 *
 * Flow: nav + session → real/fictional UI + lighthouse list when needed → AniList → submit.
 */

import supabaseClient from "../supabaseClient.js";
import { initSubmitNav } from "../nav.js";
import {
  handleSubmitAuthButtonClick,
  setFormEnabledFromSession
} from "./submitAuth.js";

const STORAGE_BUCKET = "sightings-images";
const MAX_IMAGE_WIDTH = 1920;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // pre-processing limit (input file)

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

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
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

async function processImageToWebp(file, { maxWidth = MAX_IMAGE_WIDTH } = {}) {
  assertImageFile(file);

  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  if (!srcW || !srcH) throw new Error("Invalid image.");

  const scale = Math.min(1, maxWidth / srcW);
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

  // --- Date spotted + image defaults -----------------------------------------
  const dateSpottedInput = form?.querySelector('[name="date_spotted"]');
  const imageFileInput = form?.querySelector('[name="image_file"]');
  const imagePreview = document.getElementById("imagePreview");

  function initDateAndImageDefaults() {
    if (dateSpottedInput) dateSpottedInput.value = todayYmd();
    if (imageFileInput) imageFileInput.value = "";
    if (imagePreview) {
      imagePreview.setAttribute("hidden", "");
      imagePreview.removeAttribute("src");
    }
  }

  initDateAndImageDefaults();

  let previewObjectUrl = null;
  imageFileInput?.addEventListener("change", () => {
    const file = imageFileInput?.files?.[0] ?? null;
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
    }

    if (!file || !imagePreview) return;
    try {
      assertImageFile(file);
    } catch (e) {
      alert(e?.message ?? "Invalid image.");
      imageFileInput.value = "";
      imagePreview.setAttribute("hidden", "");
      imagePreview.removeAttribute("src");
      return;
    }

    previewObjectUrl = URL.createObjectURL(file);
    imagePreview.src = previewObjectUrl;
    imagePreview.removeAttribute("hidden");
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
      if (file) {
        const ymd = dateSpottedInput?.value ?? todayYmd();
        const titleish = slugify(formData.title_en || formData.title_r || formData.title_jp);
        const mediaish = cachedMediaId ? `al${cachedMediaId}` : "";
        const base = [ymd, mediaish, titleish].filter(Boolean).join("_");
        const suffix = crypto.randomUUID();
        const objectPath = `sightings/${slugify(base) || ymd}_${suffix}.webp`;

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
      } else {
        formData.image_link = null;
      }

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
