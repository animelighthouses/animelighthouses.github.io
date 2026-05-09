/**
 * Shared image-upload pipeline for submit pages.
 *
 * Consumers: js/pages/submit/sighting.js, js/pages/submit-image.js.
 *
 * Exports the storage bucket constant, image size limits, the file-validation
 * + WebP encode pipeline (resize via pica with a 1920x1920 cap), and a helper
 * to convert a public Storage URL back to its object path (used when deleting
 * objects on submiti.html).
 *
 * Pica is loaded via a <script> tag on the host HTML page (CDN); we look it up
 * at call time via globalThis.pica and throw a clear error if it is missing.
 */

/** Public-read Supabase Storage bucket holding sighting WebP images. */
export const STORAGE_BUCKET = "sightings-images";

/** Pica resize cap (post-EXIF rotate). */
export const MAX_IMAGE_WIDTH = 1920;
/** Pica resize cap (post-EXIF rotate). */
export const MAX_IMAGE_HEIGHT = 1920;

/** Pre-processing input cap. Browsers can choke on much larger source files. */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

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
 * Validate, resize (pica, quality 3), and re-encode an image File as WebP.
 *
 * Returns `{ blob, width, height }`. Honors EXIF orientation. Skips the pica
 * pass when the source is already within the dimension cap.
 *
 * @param {File} file
 * @param {{maxWidth?: number, maxHeight?: number}} [options]
 */
export async function processImageToWebp(
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
