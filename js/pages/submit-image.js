/**
 * Image editor for existing `sightings` rows in submiti.html:
 * - OAuth-gated form
 * - choose a row (sorted by newest date_spotted)
 * - preview existing images, reorder (up/down), delete
 * - upload additional images (processed + uploaded), append to array
 * - save updates `image_link[]` and deletes removed Storage objects
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

function parsePublicUrlToObjectPath(publicUrl, { bucket }) {
  const u = new URL(publicUrl);
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = u.pathname.indexOf(marker);
  if (idx === -1) throw new Error("URL is not a public Storage URL for bucket: " + bucket);
  const objectPath = u.pathname.slice(idx + marker.length);
  if (!objectPath) throw new Error("Failed to parse object path from URL.");
  return decodeURIComponent(objectPath);
}

function moveItem(arr, fromIdx, toIdx) {
  if (fromIdx === toIdx) return arr;
  const next = arr.slice();
  const [item] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, item);
  return next;
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
  const saveBtn = document.getElementById("saveBtn");

  loginBtn?.addEventListener("click", () =>
    handleSubmitAuthButtonClick({ form, loginBtn, noticeEl })
  );
  await setFormEnabledFromSession({ form, loginBtn, noticeEl });

  /** @type {Array<any>} */
  let allRows = [];
  /** Map id -> row */
  const rowById = new Map();

  let selectedRow = null;
  /** @type {string[]} */
  let originalUrls = [];
  /** @type {string[]} */
  let editedUrls = [];
  /** @type {Set<string>} */
  let urlsToDelete = new Set();

  /** @type {File[]} */
  let pendingFiles = [];
  /** @type {string[]} */
  let pendingPreviewUrls = [];

  function clearPendingPreviews() {
    pendingPreviewUrls.forEach(u => URL.revokeObjectURL(u));
    pendingPreviewUrls = [];
    if (newImages) newImages.innerHTML = "";
  }

  function setPendingFiles(files) {
    pendingFiles = files;
    clearPendingPreviews();
    if (!newImages) return;

    if (!pendingFiles.length) return;

    pendingFiles.forEach((f, idx) => {
      const u = URL.createObjectURL(f);
      pendingPreviewUrls.push(u);
      const tile = createImageTile({
        src: u,
        caption: `${f.name} (${Math.round(f.size / 1024)}KB)`
      });

      const actions = document.createElement("div");
      actions.className = "image-actions";

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "Remove";
      removeBtn.className = "danger";
      removeBtn.addEventListener("click", () => {
        const next = pendingFiles.slice();
        next.splice(idx, 1);
        setPendingFiles(next);
        if (imageFilesInput) imageFilesInput.value = "";
      });
      actions.appendChild(removeBtn);

      tile.appendChild(actions);
      newImages.appendChild(tile);
    });
  }

  function renderCurrentImages() {
    if (!currentImages || !noCurrentImages) return;
    currentImages.innerHTML = "";

    const links = Array.isArray(editedUrls) ? editedUrls : [];
    noCurrentImages.toggleAttribute("hidden", links.length !== 0);

    links.forEach((u, idx) => {
      const tile = createImageTile({ src: u, caption: u, linkHref: u });

      const actions = document.createElement("div");
      actions.className = "image-actions";

      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.textContent = "Up";
      upBtn.disabled = idx === 0;
      upBtn.addEventListener("click", () => {
        editedUrls = moveItem(editedUrls, idx, idx - 1);
        renderCurrentImages();
      });
      actions.appendChild(upBtn);

      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.textContent = "Down";
      downBtn.disabled = idx === links.length - 1;
      downBtn.addEventListener("click", () => {
        editedUrls = moveItem(editedUrls, idx, idx + 1);
        renderCurrentImages();
      });
      actions.appendChild(downBtn);

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.textContent = "Delete";
      delBtn.className = "danger";
      delBtn.addEventListener("click", () => {
        urlsToDelete.add(u);
        editedUrls = editedUrls.filter(x => x !== u);
        renderCurrentImages();
      });
      actions.appendChild(delBtn);

      tile.appendChild(actions);
      currentImages.appendChild(tile);
    });
  }

  imageFilesInput?.addEventListener("change", () => {
    clearResult(resultDiv);
    const files = Array.from(imageFilesInput.files || []);
    if (!files.length) {
      setPendingFiles([]);
      return;
    }

    for (const f of files) {
      try {
        assertImageFile(f);
      } catch (e) {
        alert(e?.message ?? "Invalid image.");
        imageFilesInput.value = "";
        setPendingFiles([]);
        return;
      }
    }

    setPendingFiles(files);
  });

  async function loadAllRows() {
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

    allRows = data ?? [];

    rowById.clear();
    allRows.forEach(r => rowById.set(String(r.id), r));

    sightingSelect.innerHTML = `<option value="">-- Select sighting --</option>`;
    allRows.forEach(r => {
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
    selectedRow = row;
    originalUrls = Array.isArray(row?.image_link) ? row.image_link.slice() : [];
    editedUrls = originalUrls.slice();
    urlsToDelete = new Set();
    if (imageFilesInput) imageFilesInput.value = "";
    setPendingFiles([]);
    renderCurrentImages();
  });

  await loadAllRows();

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

    try {
      if (saveBtn) saveBtn.disabled = true;
      setResult(resultDiv, { kind: "", text: "Saving…" });

      const ymd = normalizeYmd(row.date_spotted);
      const mediaId = String(row.media_id ?? "").trim();

      // 1) Upload any pending files and append their URLs.
      if (pendingFiles.length) {
        setResult(resultDiv, {
          kind: "",
          text: `Processing and uploading ${pendingFiles.length} image(s)…`
        });

        for (const f of pendingFiles) {
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
          editedUrls.push(publicUrl);
        }

        if (imageFilesInput) imageFilesInput.value = "";
        setPendingFiles([]);
        renderCurrentImages();
      }

      // 2) Delete removed Storage objects.
      if (urlsToDelete.size) {
        setResult(resultDiv, { kind: "", text: `Deleting ${urlsToDelete.size} image(s)…` });
        const objectPaths = Array.from(urlsToDelete).map(u =>
          parsePublicUrlToObjectPath(u, { bucket: STORAGE_BUCKET })
        );
        const { error: removeError } = await supabaseClient.storage
          .from(STORAGE_BUCKET)
          .remove(objectPaths);
        if (removeError) throw removeError;
      }

      const { error: updateError } = await supabaseClient
        .from("sightings")
        .update({ image_link: editedUrls })
        .eq("id", row.id);
      if (updateError) throw updateError;

      setResult(resultDiv, {
        kind: "success",
        text: `Saved sighting #${row.id} (${editedUrls.length} image(s)).`
      });

      // Update local row cache and reset deletion set.
      row.image_link = editedUrls.slice();
      rowById.set(String(row.id), row);
      originalUrls = editedUrls.slice();
      urlsToDelete = new Set();
    } catch (err) {
      console.error(err);
      setResult(resultDiv, { kind: "error", text: "Error: " + (err?.message ?? "Unknown error") });
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });
});

