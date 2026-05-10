# Local backup (manual)

This folder can hold **dated snapshots** (one per run, using your **local calendar date** `yyyy-mm-dd`):

- **`sightings-yyyy-mm-dd.json`** — full JSON array from the same PostgREST query the site uses for the index (`sightings` rows with embedded `lighthouses`, `id` descending). Same shape as `fetchSightings()` in `js/dataservice.js`.
- **`sightings-images-yyyy-mm-dd/`** — files mirroring public Storage paths for every distinct `image_link` referenced in that snapshot.

Older runs are kept beside newer ones for simple version history. Those outputs are ignored by git; only this file stays tracked.

## Run the backup

From the **repository root** (same directory as `package.json`):

```bash
npm run backup:images
```

Equivalent:

```bash
node tools/backup-images-from-db.mjs
```

Running twice on the **same day** overwrites the JSON file and image folder for that date (same paths).

### PowerShell on Windows

If `&&` is not accepted by your shell version:

```powershell
Set-Location C:\path\to\animelighthouses.github.io
npm run backup:images
```

(Use your actual clone path.)

## What the script does

1. Fetches all sighting rows (plus nested lighthouse row) in one paginated PostgREST pass — same `select` / `order` as `fetchSightings()` in `js/dataservice.js` — and writes **`storage-backup/sightings-yyyy-mm-dd.json`**.
2. Derives every distinct `image_link` from that snapshot, then downloads each **public** image with `fetch` into **`sightings-images-yyyy-mm-dd/<object-path>/...`** (same run as the JSON).

It uses the same project URL and publishable anon key as `js/supabaseClient.js` by default. Override if needed:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

The JSON export runs first so the snapshot aligns with image downloads as closely as practical without a DB transaction across HTTP.

Failures during image downloads are logged; the command exits with a non-zero code if any image URL fails.

## Scope

Only rows and images exposed to the **anonymous** Supabase role (matching the live site).

Only images referenced in **`sightings.image_link`** are downloaded.

Objects in Storage that never appear there are skipped.
