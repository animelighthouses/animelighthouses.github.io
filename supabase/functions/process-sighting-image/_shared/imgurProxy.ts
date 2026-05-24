/** Direct Imgur CDN host only (not api.imgur.com). */
const IMGUR_HOSTS = new Set(["i.imgur.com"]);

const IMGUR_PATH_RE =
  /^\/(?:2F|%2F)?([A-Za-z0-9]{5,12})(\.(?:png|jpe?g|gif|webp|webm|mp4|gifv))?(\?.*)?$/i;

/** Fallback when Edge secrets are unset (same values as js/imgurProxy.js). */
const DEFAULT_IMGUR_PROXY_BASE =
  "https://anilist-imgur-proxy.animetoudaikikou.workers.dev";
const DEFAULT_IMGUR_PROXY_KEY = "pneS106VLlvWtiXgfOC1aO9Xw8wFoq";

export function isImgurImageHost(hostname: string): boolean {
  return IMGUR_HOSTS.has(String(hostname ?? "").toLowerCase());
}

function unwrapImgurProxyUrl(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return s;
  try {
    const u = new URL(s);
    if (u.hostname.endsWith(".workers.dev") && u.searchParams.has("url")) {
      const inner = u.searchParams.get("url");
      if (inner) return inner;
    }
  } catch {
    // ignore
  }
  return s;
}

/** Fix over-encoded or mangled i.imgur.com paths (e.g. /2FKTYSVxc.png → /KTYSVxc.png). */
export function normalizeImgurImageUrl(raw: string): string {
  const s = unwrapImgurProxyUrl(String(raw ?? "").trim());
  if (!s) return s;
  try {
    const u = new URL(s);
    if (!isImgurImageHost(u.hostname)) return s;

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

function imgurProxyConfig(): { base: string; key: string } {
  return {
    base: Deno.env.get("IMGUR_PROXY_BASE")?.trim() || DEFAULT_IMGUR_PROXY_BASE,
    key: Deno.env.get("IMGUR_PROXY_KEY")?.trim() || DEFAULT_IMGUR_PROXY_KEY,
  };
}

/**
 * When source is i.imgur.com, fetch via Cloudflare Worker (US egress) instead
 * of direct Imgur — avoids UK geo-block placeholders from Supabase Edge.
 */
export function resolveImgurFetchUrl(original: URL): URL {
  if (!isImgurImageHost(original.hostname)) return original;

  const { base, key } = imgurProxyConfig();
  const normalized = new URL(normalizeImgurImageUrl(original.href));
  const proxy = new URL(base);
  proxy.searchParams.set("key", key);
  proxy.searchParams.set("url", normalized.href);
  return proxy;
}
