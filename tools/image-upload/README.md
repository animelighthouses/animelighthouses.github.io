# Image Upload Tool

This directory contains the standalone image uploader hosted at `/tools/image-upload/`.

Its job is to provide a lightweight browser UI for uploading images to the separate personal image-host backend used for AniList-compatible hotlinked images.

## What lives here

- `index.html` - page structure and form controls
- `app.js` - client-side validation, preview, resize/re-encode flow, upload request, and copy helpers
- `styles.css` - uploader-specific styling
- `IMAGE_HOST_HANDOVER.txt` - scope/boundary notes for this repo vs. the backend repo and Cloudflare config

## Current behavior

- accepts local GIF, JPEG, PNG, and WebP files
- previews the selected file in-browser
- allows optional resize and output-format conversion for still images
- keeps GIF uploads original in the current MVP
- sends `POST https://upload.toudai.moe/upload`
- uses `Authorization: Bearer <token>`
- treats the returned `url` as the canonical public image URL
- expects the returned public URL to remain on `https://img.toudai.moe/i/...`
- provides copy helpers for AniList use

## Scope

This repo owns the upload page UX and browser-side file preparation.

The separate `personal-image-host` repo owns backend concerns such as Worker auth rules, storage behavior, response shape, public URL serving, and abuse controls.

This tool is intentionally standalone. It is hosted by the website repo, but it is not a primary site feature and does not need to be linked from the main site navigation.

## Related backend docs

For the canonical backend contract and operations/runbook, see the `personal-image-host` repo:

- `docs/README.md` (documentation index)
- `docs/setup.md` (end-to-end setup, domains/DNS, Workers, R2)
- `docs/status.md` (what’s implemented vs remaining)
- `docs/operations.md` (alerts, monitoring, emergency controls)
- `docs/integrations.md` (single source of truth for cross-repo contracts)
