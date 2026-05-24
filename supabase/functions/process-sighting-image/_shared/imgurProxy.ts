/** Direct Imgur CDN host only (not api.imgur.com). */
const IMGUR_HOSTS = new Set(["i.imgur.com"]);

export function isImgurImageHost(hostname: string): boolean {
  return IMGUR_HOSTS.has(String(hostname ?? "").toLowerCase());
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

  const proxy = new URL(base);
  proxy.searchParams.set("key", key);
  proxy.searchParams.set("url", original.href);
  return proxy;
}
