# Featured Sighting

Plan for a maintainer-controlled "featured sighting": a single pointer to one
sighting, a stable vanity URL that redirects to it, and a stable hotlinkable
image card for AniList embeds. Three stages, each independently shippable and
useful on its own.

```text
Stage 1 ──► Stage 2 ──► Stage 3
 pointer      vanity      card.webp
 + admin UI   CF Worker   Magick upsert
```

End state for AniList:

```html
<a href="https://www.toudai.moe/featured_sighting">
  <img src="https://<project-ref>.supabase.co/storage/v1/object/public/sightings-images/featured/card.webp" />
</a>
```

---

## Stage 1 — Featured setting (DB + admin UI)

**Goal:** At most one featured sighting at a time, settable from the existing
maintainer flows. No vanity URL and no card render yet.

### Data model

- Singleton settings row (e.g. `site_settings` with a single fixed id) holding
  `featured_sighting_id` → `sightings.id` (nullable FK).
- Do **not** encode featured state only as a flag on `sightings` rows — a
  single pointer avoids multi-row consistency bugs (more than one "featured"
  row at once).
- RLS: world/`anon` **SELECT** (needed by the stage 2 redirect worker);
  maintainer-only **UPDATE**, using the same `auth.uid()` single-writer
  pattern as the `sightings` and `lighthouses` tables.
- Optional helper: a `set_featured_sighting(id)` RPC (maintainer only) that
  upserts the singleton, so client code stays thin.

### Admin UI

Add a shared control — **"Set as featured sighting"** — wired into all three
places a sighting can be created or edited:

1. **Edit** (`edit.html` / `js/pages/edit-sighting.js`): checkbox reflects
   whether this sighting is currently featured. On successful save: if
   checked, set the pointer to this id; if unchecked and this id was the
   featured one, clear the pointer. Unchecking a sighting that is *not*
   currently featured is a no-op.
2. **Admin submit** (`submit-admin.html` / `js/pages/submit/sighting.js`):
   after a successful insert, if checked, set the pointer to the new id.
3. **Accept submission** (`review.html` / `js/pages/review-submission.js`):
   after `approve_sighting_submission` returns the new id, if checked, set
   the pointer to that id.

Also add a short status line on `admin.html`: current featured sighting id,
with a link to its `/sighting?id=…` page and to its edit page.

**Non-goals for this stage:** Edge Function render, Storage upsert,
Cloudflare Worker, any public-facing "featured" browse UI.

**Done when:** a maintainer can feature or unfeature a sighting from edit,
from admin insert, and from review/accept; anon reads of the pointer work;
at most one sighting is ever featured at a time.

---

## Stage 2 — Vanity URL

**Goal:** A stable `https://www.toudai.moe/featured_sighting` URL that always
redirects to the current featured sighting's share page.

### Approach

- A **Cloudflare Worker** on the `toudai.moe` zone, routed only on the path
  `/featured_sighting`. This lives outside the GitHub Pages repo, alongside
  the other Cloudflare-managed hosts on this domain (e.g. the image upload
  and image serving hosts).
- Worker logic: read `featured_sighting_id` from Supabase (anon REST call or
  RPC) → respond with an HTTP **302** to `/sighting?id=<id>`. If the pointer
  is null, **302** to `/` instead.
- Worker secrets: Supabase project URL + **anon** key only — never the
  service role key.
- Redirect response caching: `Cache-Control: no-store` or a short `max-age`
  (≤60s), so a newly-featured sighting takes effect quickly.

Explicitly not used: a Supabase Edge Function to serve the redirect itself
(wrong host without a Worker/route in front of it anyway); static Cloudflare
Redirect Rules pointing at a fixed target (the target changes every time the
featured sighting changes); a client-side JS redirect page as the primary
mechanism (weaker for bots/prefetch, and unnecessary since Cloudflare already
fronts this domain).

**Done when:** opening `https://www.toudai.moe/featured_sighting` lands on
the current featured sighting's page (or the homepage if none is set), and
changing the featured pointer (stage 1) changes the redirect target without
touching any external embed markup.

---

## Stage 3 — Featured card image

**Goal:** One permanent public Storage URL that always shows a pre-rendered
image card for whichever sighting is currently featured, suitable for
AniList `img` embeds.

### Approach

```text
Admin sets featured sighting (stage 1)
        │
        ▼
Edge Function render-featured-card (JWT required)
  load sighting + lighthouse from Postgres
  fetch the first image_link image
  composite a card with Magick WASM
  upsert Storage object
        │
        ▼
sightings-images/featured/card.webp   (stable public URL)
```

- Fixed object path, never rotated: `sightings-images/featured/card.webp`.
  Public URL shape:
  `https://<project-ref>.supabase.co/storage/v1/object/public/sightings-images/featured/card.webp`.
  Ordinary sighting uploads keep their existing unique paths under
  `sightings/…`, unaffected.
- On upsert of this one object only, set a short `cacheControl` (target:
  `"300"`, five minutes). On the Supabase Free plan (no Smart CDN) treat this
  as approximate — an edge PoP may hold a stale copy a bit longer, which is
  acceptable; staleness of roughly 5–60 minutes after a feature change is
  fine, faster invalidation is not required. Leave default caching for
  ordinary sighting images unchanged.
- New Edge Function, e.g. `render-featured-card`, with `verify_jwt = true`.
  Responsibilities:
  1. Resolve the featured sighting (from the settings row and/or request
     body).
  2. Load the sighting (+ lighthouse, when linked) from Postgres.
  3. Fetch the first `image_link` image.
  4. Composite a card with `@imagemagick/magick-wasm` (same family already
     used by `process-sighting-image`).
  5. Upsert `featured/card.webp` with `contentType: image/webp`,
     `upsert: true`, and the short `cacheControl` above.
  Reuse patterns from
  `supabase/functions/process-sighting-image/_shared/imagePipeline.ts` where
  practical, but keep the featured card's layout/encoding separate so
  ordinary sighting upload limits and paths stay untouched.
- Trigger: after each pointer write in stage 1 (all three UI paths), also
  invoke `render-featured-card`. Surface render failures in the existing
  admin notice UI rather than failing the underlying save.
- When the featured pointer is cleared (unfeatured with nothing new set),
  leave the last rendered card object in place rather than deleting it —
  it will simply be replaced whenever a sighting is featured again.

### Card content (v1)

Enough for a readable hotlink thumbnail:

- Primary sighting image
- Title (EN)
- Date spotted
- Optional lighthouse name (when real / linked)
- Light site branding (name or mark)

Exact layout, typography, and size are decided at implementation time; this
is not a full recreation of the browse-page CSS card.

**Non-goals for this stage:** an R2 / `img.toudai.moe`-style public-read
worker with immutable unique keys (that is a separate system); Smart CDN or
Cache Purge APIs; rendering on every image request instead of once per
feature change.

**Done when:** the Storage URL above is unchanging and suitable for AniList's
`img(…)` embed helper; changing the featured sighting regenerates and
upserts the card in place without ever editing AniList markup; the featured
object uses a short cache TTL while other Storage objects are unaffected;
combined with stage 2, the AniList embed's `href` (vanity URL) and `src`
(card image) are both permanently stable.

---

## Cross-cutting summary

| Concern | Decision |
|---|---|
| Source of truth | Supabase `featured_sighting_id` singleton |
| Redirect host | Cloudflare Worker on `toudai.moe` |
| Card bytes | Supabase Storage upsert |
| Owned in this repo | schema/RLS, admin UI, invoking the render function, docs |
| Owned outside this repo | Cloudflare Worker route + secrets |

### Suggested ship order / smoke tests

1. **Stage 1:** feature a sighting via edit → settings row updates; confirm
   an anon client can `SELECT` the pointer.
2. **Stage 2:** deploy the Worker → `/featured_sighting` 302s to that id;
   feature a different sighting → redirect target follows within the short
   cache window.
3. **Stage 3:** deploy the render function → feature a sighting → open the
   Storage URL directly and confirm a WebP with the right headers; feature
   another sighting → confirm the bytes change after the cache window, with
   no change needed to the AniList markup.

### Docs to update as each stage ships

- `docs/SCHEMA.txt` — new settings table/RPC, RLS policies.
- `docs/FEATURES.txt` — featured-sighting admin controls, vanity URL, card
  behavior.
- `docs/SUPABASE_OPS.txt` — deployment of `render-featured-card` alongside
  the existing Edge Function ops notes.
- A short contract note (in the style of
  `tools/image-upload/IMAGE_HOST_HANDOVER.txt`) covering the stage 2
  boundary: the Worker and its route/secrets live in Cloudflare, while this
  repo owns the pointer it reads.
