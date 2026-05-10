#!/usr/bin/env node
/**
 * Local backup under ./storage-backup/ (dated per run, local calendar date):
 *
 * 1. sightings-yyyy-mm-dd.json: every `sightings` row with embedded
 *    `lighthouses`, same shape as fetchSightings() in js/dataservice.js
 *    (`order=id.desc`).
 * 2. Image files: every distinct `image_link` URL under
 *    sightings-images-yyyy-mm-dd/.
 *
 * Uses the same anon key + project URL as js/supabaseClient.js (override via env).
 *
 * Usage: node tools/backup-images-from-db.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  STORAGE_BUCKET,
  parsePublicUrlToObjectPath,
} from "../js/imageProcessing.js";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");

/** Defaults match js/supabaseClient.js */
const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "https://ogningqqgxhwkmozikmu.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? "sb_publishable_Q9SEFHhKlsG05lL4dmrSqw_hwbvmEAB";

const PAGE_SIZE = 1000;
const STORAGE_BACKUP_DIR = path.join(ROOT, "storage-backup");

/** Local yyyy-mm-dd for backup folder / filename suffixes. */
function backupDateStamp(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function restHeaders(rangeFrom, rangeTo) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    Accept: "application/json",
    Range: `${rangeFrom}-${rangeTo}`,
  };
}

async function fetchSightingsPaged(select, order) {
  const base = new URL("/rest/v1/sightings", SUPABASE_URL);
  base.searchParams.set("select", select);
  base.searchParams.set("order", order);

  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const res = await fetch(base, { headers: restHeaders(from, to) });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `PostgREST ${res.status} ${res.statusText} (${select.slice(0, 40)}…): ${body.slice(0, 500)}`
      );
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

function distinctImageUrlsFromRows(rows) {
  const urls = new Set();
  for (const row of rows) {
    const links = row?.image_link;
    if (!Array.isArray(links)) continue;
    for (const u of links) {
      if (typeof u === "string" && u.trim()) urls.add(u.trim());
    }
  }
  return urls;
}

/**
 * Mirrors js/dataservice.js fetchSightings(): `*, lighthouses (*)` ordered by id desc.
 */
async function fetchSightingsDataset() {
  return fetchSightingsPaged("*,lighthouses(*)", "id.desc");
}

async function downloadOne(publicUrl, imageBackupRoot) {
  let objectPath;
  try {
    objectPath = parsePublicUrlToObjectPath(publicUrl, {
      bucket: STORAGE_BUCKET,
    });
  } catch (e) {
    throw new Error(`Bad image URL (${publicUrl}): ${e.message}`);
  }

  const dest = path.join(imageBackupRoot, ...objectPath.split("/"));
  await mkdir(path.dirname(dest), { recursive: true });

  const res = await fetch(publicUrl);
  if (!res.ok) {
    throw new Error(`GET ${res.status} for ${publicUrl}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

async function main() {
  const stamp = backupDateStamp();
  const sightingsJsonPath = path.join(
    STORAGE_BACKUP_DIR,
    `sightings-${stamp}.json`
  );
  const imageBackupRoot = path.join(
    STORAGE_BACKUP_DIR,
    `${STORAGE_BUCKET}-${stamp}`
  );

  console.log(
    `Backup stamp ${stamp}: JSON → ${path.basename(sightingsJsonPath)}, images → ${path.basename(imageBackupRoot)}/`
  );
  console.log(
    "Fetching sightings + lighthouses (same query as fetchSightings)…"
  );
  const dataset = await fetchSightingsDataset();
  await mkdir(STORAGE_BACKUP_DIR, { recursive: true });
  await writeFile(
    sightingsJsonPath,
    `${JSON.stringify(dataset, null, 2)}\n`,
    "utf8"
  );
  console.log(`Wrote ${sightingsJsonPath} (${dataset.length} row(s)).`);

  const urls = distinctImageUrlsFromRows(dataset);
  console.log(`${urls.size} distinct image URL(s) in dataset to download.`);

  let ok = 0;
  const errors = [];
  for (const u of urls) {
    try {
      await downloadOne(u, imageBackupRoot);
      ok += 1;
      console.log(`OK (${ok}/${urls.size}) ${u}`);
    } catch (e) {
      console.error(`FAIL: ${e.message}`);
      errors.push(e);
    }
  }

  if (errors.length) {
    console.error(`\n${errors.length} error(s); exiting with code 1.`);
    process.exitCode = 1;
  } else {
    console.log(`\nWrote ${ok} file(s) under ${imageBackupRoot}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
