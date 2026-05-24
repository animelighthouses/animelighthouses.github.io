/**
 * Cloudflare Worker proxy for i.imgur.com (UK geo-block).
 *
 * Browser previews rewrite Imgur URLs to the worker. Server-side ingestion
 * uses the same worker via IMGUR_PROXY_* Edge Function secrets (see
 * docs/cloudflare-imgur-proxy-setup.md).
 */

/** Full https://…workers.dev URL (no trailing slash). */
export const IMGUR_PROXY_BASE =
  "https://anilist-imgur-proxy.animetoudaikikou.workers.dev";

/** Must match PROXY_SECRET on the Worker and IMGUR_PROXY_KEY in Supabase. */
export const IMGUR_PROXY_KEY = "pneS106VLlvWtiXgfOC1aO9Xw8wFoq";

const IMGUR_HOSTS = new Set(["i.imgur.com"]);

/** Imgur direct-image path: /{id} or /{id}.{ext} */
const IMGUR_PATH_RE =
  /^\/(?:2F|%2F)?([A-Za-z0-9]{5,12})(\.(?:png|jpe?g|gif|webp|webm|mp4|gifv))?(\?.*)?$/i;

let proxyOrigin = "";
try {
  proxyOrigin = new URL(IMGUR_PROXY_BASE).origin;
} catch {
  proxyOrigin = "";
}

function isProxiedUrl(url) {
  if (!url || !proxyOrigin) return false;
  try {
    return new URL(url, globalThis.location?.href).origin === proxyOrigin;
  } catch {
    return false;
  }
}

function unwrapImgurProxyUrl(url) {
  const s = String(url ?? "").trim();
  if (!s) return s;
  try {
    const u = new URL(s, globalThis.location?.href);
    if (u.hostname.endsWith(".workers.dev") && u.searchParams.has("url")) {
      const inner = u.searchParams.get("url");
      if (inner) return inner;
    }
  } catch {
    // ignore
  }
  return s;
}

/** True for direct i.imgur.com image URLs (not api.imgur.com). */
export function isImgurImageUrl(url) {
  try {
    const u = new URL(url, globalThis.location?.href);
    return IMGUR_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Fix over-encoded or mangled i.imgur.com paths (e.g. /2FKTYSVxc.png → /KTYSVxc.png).
 * @param {string} url
 * @returns {string}
 */
export function normalizeImgurImageUrl(url) {
  const s = unwrapImgurProxyUrl(String(url ?? "").trim());
  if (!s || isProxiedUrl(s)) return s;
  try {
    const u = new URL(s, globalThis.location?.href);
    if (!IMGUR_HOSTS.has(u.hostname.toLowerCase())) return s;

    let path = u.pathname;
    for (let i = 0; i < 3; i++) {
      try {
        const decoded = decodeURIComponent(path);
        if (decoded === path) break;
        path = decoded;
      } catch {
        break;
      }
    }

    path = path.replace(/\/+/g, "/");
    const m = path.match(IMGUR_PATH_RE);
    if (m) {
      path = `/${m[1]}${m[2] ?? ""}${m[3] ?? ""}`;
    }

    u.pathname = path;
    return u.href;
  } catch {
    return s;
  }
}

/**
 * Rewrite i.imgur.com URLs for browser display; pass through everything else.
 * @param {string} url
 * @returns {string}
 */
export function toImgurProxyUrl(url) {
  const s = normalizeImgurImageUrl(url);
  if (!s || isProxiedUrl(s) || !isImgurImageUrl(s)) return String(url ?? "").trim();
  if (!IMGUR_PROXY_BASE || !IMGUR_PROXY_KEY) return s;

  const proxy = new URL(IMGUR_PROXY_BASE);
  proxy.searchParams.set("key", IMGUR_PROXY_KEY);
  proxy.searchParams.set("url", s);
  return proxy.href;
}

/**
 * URL to pass to trace.moe / SauceNAO in URL mode — Imgur hosts use the
 * Cloudflare worker so upstream fetchers are not geo-blocked.
 * @param {string} url
 * @returns {string}
 */
export function resolveLookupImageUrl(url) {
  const normalized = normalizeImgurImageUrl(url);
  if (!normalized) return "";
  if (isImgurImageUrl(normalized)) return toImgurProxyUrl(normalized);
  return normalized;
}
