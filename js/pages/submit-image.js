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
import {
  STORAGE_BUCKET,
  assertImageFile,
  parsePublicUrlToObjectPath,
  resizeImageForUpload,
  uploadSightingsImageViaEdge
} from "../imageProcessing.js";
import { clearResult, setResult } from "./formUtils.js";
import { loadSightingsForSelect, normalizeYmd } from "./sightingSelect.js";

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

  /** Map id -> row */
  let rowById = new Map();

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
    const { rowById: loaded } = await loadSightingsForSelect({
      selectEl: sightingSelect,
      columns: "id, date_spotted, title_en, title_r, title_jp, media_id, image_link"
    });
    rowById = loaded;
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
          const resized = await resizeImageForUpload(f);
          const { publicUrl } = await uploadSightingsImageViaEdge({
            blob: resized.blob,
            ymd,
            mediaId: mediaId || null
          });
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
