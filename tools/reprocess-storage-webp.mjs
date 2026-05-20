#!/usr/bin/env node
/**
 * Re-encode mislabeled PNG bytes stored under .webp paths in sightings-images.
 *
 * Requires:
 *   SUPABASE_SERVICE_ROLE_KEY
 *   REPROCESS_SECRET  (same value as Edge Function secret)
 *   SUPABASE_URL      (optional; defaults to project URL)
 *
 * Usage:
 *   node tools/reprocess-storage-webp.mjs --dry-run
 *   node tools/reprocess-storage-webp.mjs
 *
 * Run `npm run backup:images` before the first live reprocess.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { STORAGE_BUCKET, parsePublicUrlToObjectPath } from "../js/imageProcessing.js";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "https://ogningqqgxhwkmozikmu.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const REPROCESS_SECRET = process.env.REPROCESS_SECRET ?? "";

const PAGE_SIZE = 1000;
const STORAGE_BACKUP_DIR = path.join(ROOT, "storage-backup");
const FUNCTION_NAME = "process-sighting-image";

function backupDateStamp(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function restHeaders(rangeFrom, rangeTo) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    Accept: "application/json",
    Range: `${rangeFrom}-${rangeTo}`,
  };
}

async function fetchSightingsImageUrls() {
  const base = new URL("/rest/v1/sightings", SUPABASE_URL);
  base.searchParams.set("select", "id,image_link");
  base.searchParams.set("order", "id.desc");

  const urls = new Set();
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const res = await fetch(base, { headers: restHeaders(from, to) });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`PostgREST ${res.status}: ${body.slice(0, 500)}`);
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const row of rows) {
      const links = row?.image_link;
      if (!Array.isArray(links)) continue;
      for (const u of links) {
        if (typeof u === "string" && u.trim()) urls.add(u.trim());
      }
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return urls;
}

function isPngSniff(bytes) {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

async function sniffUrl(url) {
  const res = await fetch(url, {
    headers: { Range: "bytes=0-15" },
  });
  if (!res.ok) throw new Error(`GET ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { isPng: isPngSniff(buf), isWebp: isWebpSniff(buf) };
}

function isWebpSniff(buf) {
  if (buf.length < 12) return false;
  const riff = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46;
  const webp = buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  return riff && webp;
}

async function invokeReprocess(objectPath) {
  const url = `${SUPABASE_URL}/functions/v1/${FUNCTION_NAME}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      "Content-Type": "application/json",
      "x-reprocess-secret": REPROCESS_SECRET,
    },
    body: JSON.stringify({ reprocess: true, objectPath }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error ?? `HTTP ${res.status}`);
  }
  if (data?.error) throw new Error(String(data.error));
  return data;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  if (!SERVICE_KEY || !REPROCESS_SECRET) {
    console.error("Set SUPABASE_SERVICE_ROLE_KEY and REPROCESS_SECRET.");
    process.exitCode = 1;
    return;
  }

  console.log(dryRun ? "Dry run — no reprocess invocations." : "Live reprocess run.");
  const urls = await fetchSightingsImageUrls();
  console.log(`${urls.size} distinct image URL(s) in sightings.`);

  const candidates = [];
  const skipped = [];

  for (const u of urls) {
    let objectPath;
    try {
      objectPath = parsePublicUrlToObjectPath(u, { bucket: STORAGE_BUCKET });
    } catch {
      skipped.push({ url: u, reason: "not bucket url" });
      continue;
    }
    if (!objectPath.endsWith(".webp")) {
      skipped.push({ url: u, reason: "not .webp path" });
      continue;
    }
    try {
      const { isPng, isWebp } = await sniffUrl(u);
      if (isWebp) {
        skipped.push({ url: u, reason: "already webp" });
        continue;
      }
      if (isPng) {
        candidates.push({ url: u, objectPath });
        console.log(`PNG candidate: ${objectPath}`);
      } else {
        skipped.push({ url: u, reason: "unknown format" });
      }
    } catch (e) {
      skipped.push({ url: u, reason: e.message });
    }
  }

  console.log(`\n${candidates.length} to reprocess, ${skipped.length} skipped.`);

  const results = { ok: [], fail: [] };

  if (!dryRun) {
    for (const { objectPath, url } of candidates) {
      try {
        await invokeReprocess(objectPath);
        results.ok.push(objectPath);
        console.log(`OK ${objectPath}`);
      } catch (e) {
        results.fail.push({ objectPath, url, error: e.message });
        console.error(`FAIL ${objectPath}: ${e.message}`);
      }
    }
  }

  const stamp = backupDateStamp();
  await mkdir(STORAGE_BACKUP_DIR, { recursive: true });
  const reportPath = path.join(
    STORAGE_BACKUP_DIR,
    `reprocess-report-${stamp}.json`
  );
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        dryRun,
        stamp,
        candidateCount: candidates.length,
        candidates,
        skipped,
        results,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  console.log(`\nWrote ${reportPath}`);

  if (results.fail.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
