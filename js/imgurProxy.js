/**
 * Cloudflare Worker proxy for i.imgur.com (UK geo-block).
 *
 * Browser previews rewrite Imgur URLs to the worker. Server-side ingestion
 * uses the same worker via IMGUR_PROXY_* Edge Function secrets (see
 * docs/cloudflare-imgur-proxy-setup.md).
 */

/** Full https://…workers.dev URL (no trailing slash). */
export const IMGUR_PROXY_BASE =
  "https://anilist-imgur-proxy.animetoudaikou.workers.dev";

/** Must match PROXY_SECRET on the Worker and IMGUR_PROXY_KEY in Supabase. */
export const IMGUR_PROXY_KEY = "pneS106VLlvWtiXgfOC1aO9Xw8wFoq";

const IMGUR_HOSTS = new Set(["i.imgur.com"]);

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
 * Rewrite i.imgur.com URLs for browser display; pass through everything else.
 * @param {string} url
 * @returns {string}
 */
export function toImgurProxyUrl(url) {
  const s = String(url ?? "").trim();
  if (!s || isProxiedUrl(s) || !isImgurImageUrl(s)) return s;
  if (!IMGUR_PROXY_BASE || !IMGUR_PROXY_KEY) return s;

  const absolute = new URL(s, globalThis.location?.href).href;
  const proxy = new URL(IMGUR_PROXY_BASE);
  proxy.searchParams.set("key", IMGUR_PROXY_KEY);
  proxy.searchParams.set("url", absolute);
  return proxy.href;
}
