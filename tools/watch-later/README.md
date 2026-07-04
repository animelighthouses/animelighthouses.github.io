# Watch Later Helper

This directory contains the standalone watch-later helper tool hosted at `/tools/watch-later/`.

Its job is to convert YouTube links into correctly formatted entries for `youtube_watch_later.json`, with support for both one-off conversion and batch append with download.

## What lives here

- `index.html` — page structure and form controls
- `app.js` — URL parsing, noembed metadata fetch, JSON building, copy helpers, file upload/validation, and download
- `styles.css` — tool-specific styling (layout, monospace output, status box)
- `youtube_watch_later.json` — the watch-later data file this tool operates on (not served by the page)

## Current behaviour

### Single entry mode (Card 1)

- Accepts any standard YouTube URL (`watch?v=`, `youtu.be/`, `/shorts/`, `/live/`)
- Extracts the video ID client-side (no network required for parsing)
- Fetches title and channel name via the [noembed.com](https://noembed.com/) oEmbed proxy (avoids YouTube's CORS restriction)
- Outputs a single JSON object with `addedMs`, `channelName`, `title`, and `videoId` keys, ready to paste into the file
- Copy to clipboard button

### Batch append mode (Card 2)

- Optionally accepts an uploaded `youtube_watch_later.json` to start from
- Validates the uploaded file (must be a JSON array; all entries must have the four required keys)
- Detects duplicate `videoId` values and skips rather than appending
- After each URL added: updates the "latest item" and "full array" output fields
- After adding entries, clears the URL field and focuses it ready for the next link
- Download button saves the in-memory array as `youtube_watch_later.json`

## Entry shape

```json
{
    "addedMs": 1783161850453,
    "channelName": "Channel Name",
    "title": "Video title",
    "videoId": "xxxxxxxxxxx"
}
```

Keys are always in alphabetical order, matching the existing file format.

## Metadata source

Title and channel name are fetched from `https://noembed.com/embed?url=<ytUrl>`. This is a third-party oEmbed proxy — no API key is required. The service logs requested URLs. Fetch failures show an error; the entry is not generated with partial data.

## Scope

This tool is intentionally standalone. It is hosted by the website repo, but is not a primary site feature and is not linked from the main site navigation. It contains no authentication, no Supabase calls, and no credentials.
