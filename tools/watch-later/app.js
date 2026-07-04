const NOEMBED_URL = "https://noembed.com/embed";

// --- Element refs: Card 1 ---
const singleForm = document.getElementById("single-form");
const singleUrl = document.getElementById("single-url");
const singleBtn = document.getElementById("single-btn");
const singleStatus = document.getElementById("single-status");
const singleOutput = document.getElementById("single-output");

// --- Element refs: Card 2 ---
const batchFile = document.getElementById("batch-file");
const batchUrl = document.getElementById("batch-url");
const batchBtn = document.getElementById("batch-btn");
const batchStatus = document.getElementById("batch-status");
const batchCount = document.getElementById("batch-count");
const batchItemOutput = document.getElementById("batch-item-output");
const batchArrayOutput = document.getElementById("batch-array-output");
const downloadBtn = document.getElementById("download-btn");

// --- State ---
let batchArray = [];

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

function extractVideoId(input) {
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return isValidVideoId(id) ? id : null;
  }

  if (host === "youtube.com") {
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v");
      return id && isValidVideoId(id) ? id : null;
    }
    const match = url.pathname.match(/^\/(shorts|live|embed)\/([^/?#]+)/);
    if (match) {
      const id = match[2];
      return isValidVideoId(id) ? id : null;
    }
  }

  return null;
}

function isValidVideoId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{11}$/.test(id);
}

// ---------------------------------------------------------------------------
// Metadata fetch (noembed proxy — avoids YouTube CORS restriction)
// ---------------------------------------------------------------------------

async function fetchMetadata(videoId) {
  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const res = await fetch(`${NOEMBED_URL}?url=${encodeURIComponent(ytUrl)}`);
  if (!res.ok) {
    throw new Error(`Metadata fetch failed (HTTP ${res.status}). Try again or check the video ID.`);
  }
  const data = await res.json();
  if (typeof data.title !== "string" || !data.title || typeof data.author_name !== "string" || !data.author_name) {
    throw new Error("Could not retrieve title or channel name. The video may be private or unavailable.");
  }
  return { title: data.title, channelName: data.author_name };
}

// ---------------------------------------------------------------------------
// Entry building
// ---------------------------------------------------------------------------

function buildEntry(videoId, title, channelName) {
  return {
    addedMs: Date.now(),
    channelName,
    title,
    videoId
  };
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function setStatus(el, message, state) {
  el.textContent = message;
  if (state === "success" || state === "error") {
    el.dataset.state = state;
  } else {
    delete el.dataset.state;
  }
}

// ---------------------------------------------------------------------------
// Copy handler — document-level delegation, same pattern as image-upload
// ---------------------------------------------------------------------------

document.addEventListener("click", async event => {
  const button = event.target instanceof HTMLElement ? event.target.closest("[data-copy-target]") : null;
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  const targetId = button.dataset.copyTarget;
  const target = targetId ? document.getElementById(targetId) : null;
  if (!(target instanceof HTMLTextAreaElement)) {
    return;
  }

  const statusEl = button.closest(".card")?.querySelector(".status-box") ?? null;

  if (!target.value) {
    if (statusEl) setStatus(statusEl, "Nothing to copy yet.", "error");
    return;
  }

  try {
    await navigator.clipboard.writeText(target.value);
    if (statusEl) setStatus(statusEl, "Copied to clipboard.", "success");
  } catch {
    target.focus();
    target.select();
    if (statusEl) setStatus(statusEl, "Clipboard write failed. The field has been selected for manual copy.", "error");
  }
});

// ---------------------------------------------------------------------------
// Card 1 — Single entry
// ---------------------------------------------------------------------------

singleForm.addEventListener("submit", async event => {
  event.preventDefault();

  const raw = singleUrl.value.trim();
  if (!raw) {
    setStatus(singleStatus, "Paste a YouTube URL first.", "error");
    return;
  }

  const videoId = extractVideoId(raw);
  if (!videoId) {
    setStatus(singleStatus, "Could not extract a video ID from that URL. Supported formats: watch?v=, youtu.be/, /shorts/, /live/.", "error");
    return;
  }

  singleBtn.disabled = true;
  setStatus(singleStatus, "Fetching metadata...", null);

  try {
    const { title, channelName } = await fetchMetadata(videoId);
    const entry = buildEntry(videoId, title, channelName);
    singleOutput.value = JSON.stringify(entry, null, 4);
    setStatus(singleStatus, `Converted: "${title}" by ${channelName}.`, "success");
  } catch (error) {
    setStatus(singleStatus, error instanceof Error ? error.message : String(error), "error");
  } finally {
    singleBtn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Card 2 — File upload
// ---------------------------------------------------------------------------

batchFile.addEventListener("change", () => {
  const file = batchFile.files?.[0];
  if (!file) return;

  const reader = new FileReader();

  reader.addEventListener("load", () => {
    try {
      const parsed = JSON.parse(/** @type {string} */ (reader.result));

      if (!Array.isArray(parsed)) {
        throw new Error("File must contain a JSON array at the top level.");
      }

      for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        if (
          typeof item?.videoId !== "string" ||
          typeof item?.title !== "string" ||
          typeof item?.channelName !== "string" ||
          typeof item?.addedMs !== "number"
        ) {
          throw new Error(`Entry at index ${i} is missing required fields (videoId, title, channelName, addedMs).`);
        }
      }

      batchArray = parsed;
      syncBatchOutputs();
      setStatus(
        batchStatus,
        `Loaded ${batchArray.length} ${batchArray.length === 1 ? "entry" : "entries"} from ${file.name}.`,
        "success"
      );
    } catch (error) {
      batchArray = [];
      syncBatchOutputs();
      setStatus(
        batchStatus,
        `Could not load file: ${error instanceof Error ? error.message : String(error)}`,
        "error"
      );
    }
  });

  reader.readAsText(file);
});

// ---------------------------------------------------------------------------
// Card 2 — Add to list
// ---------------------------------------------------------------------------

batchBtn.addEventListener("click", async () => {
  const raw = batchUrl.value.trim();
  if (!raw) {
    setStatus(batchStatus, "Paste a YouTube URL first.", "error");
    return;
  }

  const videoId = extractVideoId(raw);
  if (!videoId) {
    setStatus(batchStatus, "Could not extract a video ID from that URL. Supported formats: watch?v=, youtu.be/, /shorts/, /live/.", "error");
    return;
  }

  if (batchArray.some(e => e.videoId === videoId)) {
    setStatus(batchStatus, `Video ID "${videoId}" is already in the list — skipping to avoid a duplicate.`, "error");
    return;
  }

  batchBtn.disabled = true;
  setStatus(batchStatus, "Fetching metadata...", null);

  try {
    const { title, channelName } = await fetchMetadata(videoId);
    const entry = buildEntry(videoId, title, channelName);
    batchArray.push(entry);

    batchItemOutput.value = JSON.stringify(entry, null, 4);
    syncBatchOutputs();
    batchUrl.value = "";
    batchUrl.focus();

    const n = batchArray.length;
    setStatus(
      batchStatus,
      `Added: "${title}" by ${channelName}. ${n} ${n === 1 ? "entry" : "entries"} total.`,
      "success"
    );
  } catch (error) {
    setStatus(batchStatus, error instanceof Error ? error.message : String(error), "error");
  } finally {
    batchBtn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Card 2 — Download
// ---------------------------------------------------------------------------

downloadBtn.addEventListener("click", () => {
  if (!batchArray.length) {
    setStatus(batchStatus, "Nothing to download yet.", "error");
    return;
  }

  const json = JSON.stringify(batchArray, null, 4);
  const blob = new Blob([json], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: "youtube_watch_later.json"
  });
  a.click();
  URL.revokeObjectURL(a.href);

  setStatus(batchStatus, "Downloaded youtube_watch_later.json.", "success");
});

// ---------------------------------------------------------------------------
// Shared sync helper
// ---------------------------------------------------------------------------

function syncBatchOutputs() {
  const n = batchArray.length;

  batchCount.textContent = `${n} ${n === 1 ? "entry" : "entries"} currently loaded`;
  batchCount.hidden = n === 0;

  batchArrayOutput.value = n > 0 ? JSON.stringify(batchArray, null, 4) : "";
  downloadBtn.disabled = n === 0;
}
