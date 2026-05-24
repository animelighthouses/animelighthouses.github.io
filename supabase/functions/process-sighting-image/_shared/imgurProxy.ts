/** Direct Imgur CDN host only (not api.imgur.com). */
const IMGUR_HOSTS = new Set(["i.imgur.com"]);

const IMGUR_PATH_RE =
  /^\/(?:2F|%2F)?([A-Za-z0-9]{5,12})(\.(?:png|jpe?g|gif|webp|webm|mp4|gifv))?(\?.*)?$/i;

export function isImgurImageHost(hostname: string): boolean {
  return IMGUR_HOSTS.has(String(hostname ?? "").toLowerCase());
}

/** Fix over-encoded or mangled i.imgur.com paths (e.g. /2FKTYSVxc.png → /KTYSVxc.png). */
export function normalizeImgurImageUrl(raw: string): string {
  const s = String(raw ?? "").trim();
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

/**
 * When source is i.imgur.com, fetch via Cloudflare Worker (US egress) instead
 * of direct Imgur — avoids UK geo-block placeholders from Supabase Edge.
 */
export function resolveImgurFetchUrl(original: URL): URL {
  if (!isImgurImageHost(original.hostname)) return original;

  const base = Deno.env.get("IMGUR_PROXY_BASE")?.trim();
  const key = Deno.env.get("IMGUR_PROXY_KEY")?.trim();
  if (!base || !key) {
    console.warn(
      "IMGUR_PROXY_BASE / IMGUR_PROXY_KEY not set; fetching Imgur directly.",
    );
    return original;
  }

  const normalized = new URL(normalizeImgurImageUrl(original.href));
  const proxy = new URL(base);
  proxy.searchParams.set("key", key);
  proxy.searchParams.set("url", normalized.href);
  return proxy;
}
