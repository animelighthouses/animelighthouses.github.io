/**
 * Shared image-upload pipeline for submit pages.
 *
 * Client: validate + resize (pica, 1920 cap) → JPEG for Edge upload.
 * Server: process-sighting-image Edge Function encodes WebP and uploads to Storage.
 *
 * Pica is loaded via a <script> tag on the host HTML page (CDN).
 */

import supabaseClient from "./supabaseClient.js";

/** Public-read Supabase Storage bucket holding sighting WebP images. */
export const STORAGE_BUCKET = "sightings-images";

const SUPABASE_PROJECT_HOST = "ogningqqgxhwkmozikmu.supabase.co";

/** Pica resize cap (post-EXIF rotate). */
export const MAX_IMAGE_WIDTH = 1920;
/** Pica resize cap (post-EXIF rotate). */
export const MAX_IMAGE_HEIGHT = 1920;

/** Pre-processing input cap. Browsers can choke on much larger source files. */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** Post-resize blob size guard before Edge upload (bytes). */
export const MAX_EDGE_UPLOAD_BYTES = 8 * 1024 * 1024;

const EDGE_FUNCTION = "process-sighting-image";

/**
 * Resolve the global `pica` factory provided by the CDN script tag.
 * @returns {object} A pica instance.
 * @throws {Error} If the CDN script never loaded.
 */
export function getPica() {
  const factory = globalThis?.pica;
  if (typeof factory !== "function") {
    throw new Error("Image resizer (pica) failed to load. Check network/CDN.");
  }
  return factory();
}

/** Clamp `n` into `[min, max]`. */
export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** Cryptographically-random 8 hex char id used to disambiguate uploaded paths. */
export function shortIdHex8() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

/** Map an image MIME type to its conventional file extension; "" if unsupported. */
export function extFromMime(mime) {
  const m = String(mime ?? "").toLowerCase();
  if (m === "image/jpeg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  return "";
}

/**
 * @param {{ ymd: string, mediaId?: string | null, shortId: string }} params
 */
export function buildSightingsObjectPath({ ymd, mediaId, shortId }) {
  const mid = String(mediaId ?? "").trim();
  return mid
    ? `sightings/${ymd}_${mid}_${shortId}.webp`
    : `sightings/${ymd}_${shortId}.webp`;
}

/**
 * True when `url` is a public object URL in sightings-images.
 * @param {string} url
 */
export function isSightingsStoragePublicUrl(url) {
  const s = String(url ?? "").trim();
  if (!s) return false;
  try {
    const u = new URL(s);
    if (u.hostname !== SUPABASE_PROJECT_HOST) return false;
    return u.pathname.includes(`/storage/v1/object/public/${STORAGE_BUCKET}/sightings/`);
  } catch {
    return false;
  }
}

/**
 * Validate a candidate image File: presence, type, size cap.
 * @throws {Error} On any failure with a user-facing message.
 */
export function assertImageFile(file) {
  if (!file) throw new Error("Please select an image file.");
  if (!(file instanceof File)) throw new Error("Invalid file.");
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`Image is too large (max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB).`);
  }
  const ext = extFromMime(file.type);
  if (!ext) throw new Error("Unsupported image type. Use JPEG, PNG, or WebP.");
}

/** Promisified canvas.toBlob; rejects on encoder failure. */
export function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error("Failed to encode image."))),
      type,
      quality
    );
  });
}

/**
 * Validate, resize (pica when needed), encode as JPEG for Edge WebP conversion.
 *
 * @param {File} file
 * @param {{maxWidth?: number, maxHeight?: number}} [options]
 * @returns {Promise<{ blob: Blob, width: number, height: number }>}
 */
export async function resizeImageForUpload(
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

  const jpegBlob = await toBlob(dstCanvas, "image/jpeg", 0.85);
  if (jpegBlob.size > MAX_EDGE_UPLOAD_BYTES) {
    throw new Error(
      "Processed image is still too large for upload. Try a smaller source file."
    );
  }

  return { blob: jpegBlob, width: dstW, height: dstH };
}

/** @param {unknown} data @param {{ message?: string } | null} error */
function assertEdgeImageResponse(data, error) {
  if (error) throw error;
  if (data?.error) throw new Error(String(data.error));
  if (!data?.publicUrl) throw new Error("Image processing failed.");
}

/**
 * Upload a client-resized image via Edge Function (WebP + Storage).
 *
 * @param {{ blob: Blob, ymd: string, mediaId?: string | null }} params
 * @returns {Promise<{ publicUrl: string, objectPath: string, width?: number, height?: number }>}
 */
export async function uploadSightingsImageViaEdge({ blob, ymd, mediaId }) {
  const form = new FormData();
  form.append("file", blob, "upload.jpg");
  form.append("ymd", String(ymd ?? "").trim());
  if (mediaId) form.append("mediaId", String(mediaId).trim());

  const { data, error } = await supabaseClient.functions.invoke(EDGE_FUNCTION, {
    body: form
  });
  assertEdgeImageResponse(data, error);
  return {
    publicUrl: data.publicUrl,
    objectPath: data.objectPath,
    width: data.width,
    height: data.height
  };
}

/**
 * Fetch an external image URL server-side, resize, WebP, upload.
 *
 * @param {{ sourceUrl: string, ymd: string, mediaId?: string | null }} params
 */
export async function processSightingsImageFromUrl({ sourceUrl, ymd, mediaId }) {
  const { data, error } = await supabaseClient.functions.invoke(EDGE_FUNCTION, {
    body: {
      sourceUrl: String(sourceUrl ?? "").trim(),
      ymd: String(ymd ?? "").trim(),
      mediaId: mediaId ? String(mediaId).trim() : undefined
    }
  });
  assertEdgeImageResponse(data, error);
  return {
    publicUrl: data.publicUrl,
    objectPath: data.objectPath,
    width: data.width,
    height: data.height
  };
}

/**
 * Convert a Supabase public-storage URL back to the object path inside `bucket`.
 * Used by submiti.html when removing deleted images from Storage.
 *
 * @param {string} publicUrl
 * @param {{bucket: string}} options
 */
export function parsePublicUrlToObjectPath(publicUrl, { bucket }) {
  const u = new URL(publicUrl);
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = u.pathname.indexOf(marker);
  if (idx === -1) throw new Error("URL is not a public Storage URL for bucket: " + bucket);
  const objectPath = u.pathname.slice(idx + marker.length);
  if (!objectPath) throw new Error("Failed to parse object path from URL.");
  return decodeURIComponent(objectPath);
}
