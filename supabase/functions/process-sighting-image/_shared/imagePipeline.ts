/**
 * Server-side decode, resize (≤1920), WebP encode, and Storage upload.
 * Uses @imagemagick/magick-wasm (Supabase Edge–compatible).
 */

import {
  FilterType,
  ImageMagick,
  initializeImageMagick,
  MagickFormat,
} from "npm:@imagemagick/magick-wasm@0.0.34";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  FETCH_TIMEOUT_MS,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_HEIGHT,
  MAX_IMAGE_WIDTH,
  STORAGE_BUCKET,
  WEBP_QUALITY_JPEG,
  WEBP_QUALITY_PNG,
} from "./constants.ts";

const wasmBytes = await Deno.readFile(
  new URL(
    "magick.wasm",
    import.meta.resolve("npm:@imagemagick/magick-wasm@0.0.34"),
  ),
);
await initializeImageMagick(wasmBytes);

export function shortIdHex8(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** @param {{ ymd: string, mediaId?: string, shortId: string }} */
export function buildSightingsObjectPath({
  ymd,
  mediaId,
  shortId,
}: {
  ymd: string;
  mediaId?: string;
  shortId: string;
}): string {
  const mid = String(mediaId ?? "").trim();
  return mid
    ? `sightings/${ymd}_${mid}_${shortId}.webp`
    : `sightings/${ymd}_${shortId}.webp`;
}

export function assertYmd(ymd: string): string {
  const s = String(ymd ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error("Invalid date (expected YYYY-MM-DD).");
  }
  return s;
}

/** magick-wasm write() returns native memory freed after the callback — copy it. */
function copyMagickBytes(data: Uint8Array): Uint8Array {
  return new Uint8Array(data);
}

export function isWebpBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const riff =
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46;
  const webp =
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;
  return riff && webp;
}

function isPrivateIpv4(a: number, b: number, c: number, _d: number): boolean {
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}

/** Block SSRF targets (localhost, private IPs, non-http(s)). */
export async function assertSafeImageUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(String(raw ?? "").trim());
  } catch {
    throw new Error("Invalid image URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Image URL must use http or https.");
  }
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "[::1]"
  ) {
    throw new Error("Image URL host is not allowed.");
  }

  const ipv4 = parseIpv4(host);
  if (ipv4 && isPrivateIpv4(ipv4[0], ipv4[1], ipv4[2], ipv4[3])) {
    throw new Error("Image URL host is not allowed.");
  }

  if (!ipv4 && host !== "") {
    try {
      const records = await Deno.resolveDns(host, "A");
      for (const ip of records) {
        const p = parseIpv4(ip);
        if (p && isPrivateIpv4(p[0], p[1], p[2], p[3])) {
          throw new Error("Image URL host is not allowed.");
        }
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("not allowed")) throw e;
    }
  }

  return u;
}

export async function fetchImageBytes(url: URL): Promise<Uint8Array> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { Accept: "image/*,*/*;q=0.8" },
    });
    if (!res.ok) throw new Error(`Failed to fetch image (${res.status}).`);

    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (ct && !ct.startsWith("image/") && ct !== "application/octet-stream") {
      throw new Error("URL did not return an image.");
    }

    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) {
      throw new Error(
        `Image is too large (max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB).`,
      );
    }
    if (buf.length < 16) throw new Error("Image data too small.");
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

function sourceLooksPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

/**
 * Decode, fit within max dimensions (Lanczos), encode WebP.
 */
export async function bytesToWebp(
  input: Uint8Array,
  { preferPngQuality = false }: { preferPngQuality?: boolean } = {},
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const quality = preferPngQuality || sourceLooksPng(input)
    ? WEBP_QUALITY_PNG
    : WEBP_QUALITY_JPEG;

  let outW = 0;
  let outH = 0;

  const outBytes = ImageMagick.read(input, (img): Uint8Array => {
    const w = img.width;
    const h = img.height;
    if (!w || !h) throw new Error("Invalid image.");

    const scale = Math.min(1, MAX_IMAGE_WIDTH / w, MAX_IMAGE_HEIGHT / h);
    const dstW = Math.max(1, Math.round(w * scale));
    const dstH = Math.max(1, Math.round(h * scale));

    if (dstW !== w || dstH !== h) {
      img.resize(dstW, dstH, FilterType.Lanczos);
    }

    img.quality = quality;
    img.format = MagickFormat.WebP;
    outW = img.width;
    outH = img.height;
    return img.write(MagickFormat.WebP, (data) => copyMagickBytes(data));
  });

  if (!outBytes?.length || !isWebpBytes(outBytes)) {
    throw new Error("WebP encoding failed.");
  }

  return { bytes: outBytes, width: outW, height: outH };
}

export async function uploadWebp(
  client: SupabaseClient,
  objectPath: string,
  webpBytes: Uint8Array,
  { upsert = false }: { upsert?: boolean } = {},
): Promise<{ publicUrl: string; objectPath: string }> {
  const path = objectPath.replace(/^\/+/, "");
  if (!path.startsWith("sightings/") || !path.endsWith(".webp")) {
    throw new Error("Invalid object path.");
  }

  const { error } = await client.storage.from(STORAGE_BUCKET).upload(
    path,
    webpBytes,
    { contentType: "image/webp", upsert },
  );
  if (error) throw new Error(error.message);

  const { data } = client.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  const publicUrl = data?.publicUrl;
  if (!publicUrl) throw new Error("Failed to generate public URL.");

  return { publicUrl, objectPath: path };
}
