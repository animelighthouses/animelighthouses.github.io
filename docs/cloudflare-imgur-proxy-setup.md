# Cloudflare Imgur proxy

In some regions (notably the UK), `i.imgur.com` is geo-blocked in browsers and from
some server egress IPs. Supabase Edge Functions can run on UK nodes; a direct fetch of
an Imgur URL may return a placeholder JPEG that gets stored in `sightings-images`.

This project routes **only** `i.imgur.com` image URLs through a personal Cloudflare
Worker with **US placement**. The same worker is used in two places:

| Layer | File / config | Purpose |
|-------|----------------|---------|
| Browser | `js/imgurProxy.js` | Preview Imgur URLs on review, submit-admin, edit |
| Edge | `IMGUR_PROXY_*` secrets on `process-sighting-image` | Fetch + WebP ingest at approve/submit URL mode |

Original Imgur URLs are still stored in the submission queue and passed to trace.moe /
SauceNAO unchanged; only display and Storage ingestion use the proxy.

## 1. Create the Worker

Cloudflare dashboard → **Workers & Pages** → **Create** → Worker.

Example handler (matches `?key=…&url=…` used by `js/imgurProxy.js`):

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.searchParams.get("key") !== env.PROXY_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    let target;
    try {
      target = new URL(url.searchParams.get("url") || "");
    } catch {
      return new Response("Bad url", { status: 400 });
    }

    if (target.hostname.toLowerCase() !== "i.imgur.com") {
      return new Response("Host not allowed", { status: 403 });
    }
    if (target.protocol !== "https:") {
      return new Response("HTTPS only", { status: 403 });
    }

    const upstream = await fetch(target.href, {
      headers: { Accept: "image/*,*/*;q=0.8" },
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/octet-stream",
        "Cache-Control": "public, max-age=86400",
      },
    });
  },
};
```

**Settings → Variables:** add `PROXY_SECRET` (encrypted) — a long random string.

**Settings → General → Placement:** set a **US region** (e.g. US West / `aws:us-west-2`).
Without this, the Worker may still fetch Imgur from a UK IP when you are in the UK.

Deploy and note the `*.workers.dev` URL.

## 2. Configure this repo

### Browser (`js/imgurProxy.js`)

Set `IMGUR_PROXY_BASE` to your Worker URL (e.g.
`https://anilist-imgur-proxy.animetoudaikikou.workers.dev`) and `IMGUR_PROXY_KEY`
to the same value as `PROXY_SECRET`.

### Supabase Edge secrets

Dashboard → **Project Settings** → **Edge Functions** → **Secrets**:

```
IMGUR_PROXY_BASE   https://your-worker.workers.dev
IMGUR_PROXY_KEY    (same value as PROXY_SECRET on the Worker)
```

Redeploy after adding secrets:

```bash
supabase functions deploy process-sighting-image
```

## 3. Verify

1. Open a Worker URL in the browser (while in the UK, VPN off):

   `https://your-worker.workers.dev?key=SECRET&url=https%3A%2F%2Fi.imgur.com%2F<known-id>.jpg`

   Response must be image bytes (check Content-Type and that the image is not the
   “image unavailable in your region” placeholder).

2. On `/review`, select a submission with an Imgur URL — preview should load without VPN.

3. Approve that submission — `image_link` in Storage should be the real screenshot WebP,
   not the placeholder.

## Security notes

- Worker only proxies `https://i.imgur.com/*` (SSRF guard).
- `process-sighting-image` still validates the **original** URL with `assertSafeImageUrl`
  before rewriting to the Worker for fetch.
- Rotate `PROXY_SECRET` / `IMGUR_PROXY_KEY` together if the key is abused.

See also `docs/SUPABASE_OPS.txt` for the secrets list.
