/**
 * Image migration for existing `sightings` rows in submiti.html:
 * - OAuth-gated form
 * - pick a row still using repo-hosted `images/...`
 * - upload 1+ replacement images, process in-browser, upload to Storage, replace `image_link[]`
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
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

function getPica() {
  const factory = globalThis?.pica;
  if (typeof factory !== "function") {
    throw new Error("Image resizer (pica) failed to load. Check network/CDN.");
  }
  return factory();
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function shortIdHex8() {
  const bytes = new Uint8Array(4); // 8 hex chars
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
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
    await pica.resize(srcCanvas, dstCanvas, { quality: 3, alpha: false });
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

function setResult(resultDiv, { kind, text }) {
  if (!resultDiv) return;
  resultDiv.textContent = text;
  resultDiv.className = "result";
  if (kind) resultDiv.classList.add(kind);
  resultDiv.style.display = "block";
}

function clearResult(resultDiv) {
  if (!resultDiv) return;
  resultDiv.style.display = "none";
  resultDiv.className = "result";
  resultDiv.textContent = "";
}

function titleForRow(row) {
  return row?.title_en || row?.title_r || row?.title_jp || "";
}

function normalizeYmd(dateSpotted) {
  // Supabase returns date as `YYYY-MM-DD` string for `date` columns in JS clients.
  const raw = String(dateSpotted ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return raw.slice(0, 10);
}

function createImageTile({ src, caption, linkHref }) {
  const tile = document.createElement("div");
  tile.className = "image-tile";

  const img = document.createElement("img");
  img.loading = "lazy";
  img.src = src;
  tile.appendChild(img);

  const cap = document.createElement("div");
  cap.className = "image-caption";
  if (linkHref) {
    const a = document.createElement("a");
    a.href = linkHref;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = caption;
    cap.appendChild(a);
  } else {
    cap.textContent = caption;
  }
  tile.appendChild(cap);

  return tile;
}

document.addEventListener("DOMContentLoaded", async () => {
  initSubmitNav();

  const form = document.getElementById("imageForm");
  const loginBtn = document.getElementById("loginBtn");
  const noticeEl = document.getElementById("submitAdminNotice");
  const resultDiv = document.getElementById("result");

  const sightingSelect = document.getElementById("sightingSelect");
  const currentImages = document.getElementById("currentImages");
  const noCurrentImages = document.getElementById("noCurrentImages");
  const imageFilesInput = document.getElementById("imageFilesInput");
  const newImages = document.getElementById("newImages");
  const submitBtn = document.getElementById("submitBtn");

  loginBtn?.addEventListener("click", () =>
    handleSubmitAuthButtonClick({ form, loginBtn, noticeEl })
  );
  await setFormEnabledFromSession({ form, loginBtn, noticeEl });

  /** @type {Array<any>} */
  let candidateRows = [];
  /** Map id -> row */
  const rowById = new Map();

  function renderCurrentRow(row) {
    if (!currentImages || !noCurrentImages) return;
    currentImages.innerHTML = "";

    const links = Array.isArray(row?.image_link) ? row.image_link : [];
    const repoLinks = links.filter(u => typeof u === "string" && u.startsWith("images/"));

    noCurrentImages.toggleAttribute("hidden", repoLinks.length !== 0);

    repoLinks.forEach(u => {
      const abs = new URL(u, window.location.origin).toString();
      currentImages.appendChild(
        createImageTile({ src: abs, caption: u, linkHref: abs })
      );
    });
  }

  /** @type {string[]} */
  let newPreviewObjectUrls = [];
  function clearNewPreviews() {
    newPreviewObjectUrls.forEach(u => URL.revokeObjectURL(u));
    newPreviewObjectUrls = [];
    if (newImages) newImages.innerHTML = "";
  }

  imageFilesInput?.addEventListener("change", () => {
    clearResult(resultDiv);
    clearNewPreviews();

    const files = Array.from(imageFilesInput.files || []);
    if (!files.length || !newImages) return;

    for (const f of files) {
      try {
        assertImageFile(f);
      } catch (e) {
        alert(e?.message ?? "Invalid image.");
        imageFilesInput.value = "";
        clearNewPreviews();
        return;
      }
    }

    files.forEach(f => {
      const u = URL.createObjectURL(f);
      newPreviewObjectUrls.push(u);
      newImages.appendChild(
        createImageTile({ src: u, caption: `${f.name} (${Math.round(f.size / 1024)}KB)` })
      );
    });
  });

  async function loadCandidates() {
    if (!sightingSelect) return;
    sightingSelect.innerHTML = `<option value="">Loading…</option>`;

    const { data, error } = await supabaseClient
      .from("sightings")
      .select("id, date_spotted, title_en, title_r, title_jp, media_id, image_link")
      .order("date_spotted", { ascending: false })
      .order("id", { ascending: false });

    if (error) {
      console.error(error);
      sightingSelect.innerHTML = `<option value="">Failed to load</option>`;
      return;
    }

    const rows = data ?? [];
    candidateRows = rows.filter(r =>
      Array.isArray(r.image_link) &&
      r.image_link.some(u => typeof u === "string" && u.startsWith("images/"))
    );

    rowById.clear();
    candidateRows.forEach(r => rowById.set(String(r.id), r));

    if (!candidateRows.length) {
      sightingSelect.innerHTML = `<option value="">No rows need migration</option>`;
      renderCurrentRow(null);
      return;
    }

    sightingSelect.innerHTML = `<option value="">-- Select sighting --</option>`;
    candidateRows.forEach(r => {
      const opt = document.createElement("option");
      opt.value = String(r.id);
      const ymd = normalizeYmd(r.date_spotted);
      const title = titleForRow(r);
      opt.textContent = `${ymd} — #${r.id}${title ? ` — ${title}` : ""}`;
      sightingSelect.appendChild(opt);
    });
  }

  sightingSelect?.addEventListener("change", () => {
    clearResult(resultDiv);
    const id = String(sightingSelect.value || "");
    const row = rowById.get(id) || null;
    renderCurrentRow(row);
  });

  await loadCandidates();

  form?.addEventListener("submit", async e => {
    e.preventDefault();
    clearResult(resultDiv);

    const id = String(sightingSelect?.value || "");
    if (!id) {
      setResult(resultDiv, { kind: "error", text: "Please select a sighting row." });
      return;
    }

    const row = rowById.get(id);
    if (!row) {
      setResult(resultDiv, { kind: "error", text: "Selected row not found." });
      return;
    }

    const files = Array.from(imageFilesInput?.files || []);
    if (!files.length) {
      setResult(resultDiv, { kind: "error", text: "Please select at least one image." });
      return;
    }

    for (const f of files) {
      try {
        assertImageFile(f);
      } catch (err) {
        setResult(resultDiv, { kind: "error", text: err?.message ?? "Invalid image." });
        return;
      }
    }

    try {
      if (submitBtn) submitBtn.disabled = true;
      setResult(resultDiv, { kind: "", text: "Processing and uploading…" });

      const ymd = normalizeYmd(row.date_spotted);
      const mediaId = String(row.media_id ?? "").trim();

      const urls = [];
      for (const f of files) {
        const processed = await processImageToWebp(f);
        const shortId = shortIdHex8();
        const objectPath = mediaId
          ? `sightings/${ymd}_${mediaId}_${shortId}.webp`
          : `sightings/${ymd}_${shortId}.webp`;

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
        urls.push(publicUrl);
      }

      const { error: updateError } = await supabaseClient
        .from("sightings")
        .update({ image_link: urls })
        .eq("id", row.id);
      if (updateError) throw updateError;

      setResult(resultDiv, {
        kind: "success",
        text: `Updated sighting #${row.id} with ${urls.length} image(s).`
      });

      // Refresh list (row no longer qualifies if it had only repo images).
      imageFilesInput.value = "";
      clearNewPreviews();
      await loadCandidates();
      if (sightingSelect) sightingSelect.value = "";
      renderCurrentRow(null);
    } catch (err) {
      console.error(err);
      setResult(resultDiv, { kind: "error", text: "Error: " + (err?.message ?? "Unknown error") });
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
});

