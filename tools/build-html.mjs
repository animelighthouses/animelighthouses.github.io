#!/usr/bin/env node
/**
 * Compose top-level *.html files from partials/.
 *
 * Each host HTML file uses HTML-comment markers to indicate where a partial
 * lives. The script reads the partial, indents every line by the marker's
 * leading whitespace, and writes back in place — leaving the markers around
 * the rendered content so the source file is always discoverable from the
 * generated output.
 *
 * Two marker forms are accepted (both produce the same rendered output):
 *
 *     <!-- include: partials/foo.html -->
 *     ...rendered content...
 *     <!-- /include -->
 *
 * or simply:
 *
 *     <!-- include: partials/foo.html -->
 *
 * (Bare markers on first run get filled in and a `<!-- /include -->` closer
 * appended.)
 *
 * Re-running the script is idempotent.
 *
 * Usage: node tools/build-html.mjs
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");

/**
 * Match either form:
 *   1. <!-- include: PATH -->\n<body>\n<!-- /include -->   (paired)
 *   2. <!-- include: PATH -->                              (bare)
 *
 * Capture groups:
 *   [1] leading whitespace on the marker line
 *   [2] partial path relative to repo root
 *   [3] (optional) existing rendered body, including the closing marker line
 */
// After `-->`, tolerate optional ASCII whitespace before the line ending (handles
// CRLF and stray spaces). Without this, on Windows CRLF builds the paired block
// does not match (`\n` is not immediately after `-->` → only the opener is
// replaced each run → duplicated partial markup + orphaned `<!-- /include -->`).
const INCLUDE_RE =
  /([ \t]*)<!--[ \t]*include:[ \t]*([^\s>]+)[ \t]*-->(?:[ \t]*\r?\n[\s\S]*?<!--[ \t]*\/include[ \t]*-->)?/g;

async function readPartial(relPath) {
  const abs = path.join(ROOT, relPath);
  const raw = await fs.readFile(abs, "utf8");
  return raw.replace(/\r\n/g, "\n").replace(/[\s]+$/g, "");
}

function indentBlock(text, indent) {
  if (!indent) return text;
  return text
    .split("\n")
    .map(line => (line.length ? indent + line : line))
    .join("\n");
}

async function buildFile(htmlPath) {
  const orig = (await fs.readFile(htmlPath, "utf8")).replace(/\r\n/g, "\n");

  // Resolve every include in order. A simple repeated `replace` on a fresh
  // regex copy keeps things straightforward and avoids state on the regex.
  const replacements = [];
  for (const m of orig.matchAll(INCLUDE_RE)) {
    const [whole, indent, partialRel] = m;
    let body;
    try {
      body = await readPartial(partialRel);
    } catch (err) {
      throw new Error(`Failed to read partial ${partialRel}: ${err.message}`);
    }
    const indented = indentBlock(body, indent);
    const replacement = `${indent}<!-- include: ${partialRel} -->\n${indented}\n${indent}<!-- /include -->`;
    replacements.push({ whole, replacement });
  }

  let updated = orig;
  for (const { whole, replacement } of replacements) {
    // Replace first occurrence at a time to keep matched indices aligned.
    updated = updated.replace(whole, replacement);
  }

  if (updated !== orig) {
    await fs.writeFile(htmlPath, updated);
    return "updated";
  }
  return "unchanged";
}

async function listHtmlFiles() {
  const entries = await fs.readdir(ROOT, { withFileTypes: true });
  return entries
    .filter(d => d.isFile() && d.name.endsWith(".html"))
    .map(d => path.join(ROOT, d.name))
    .sort();
}

async function main() {
  const files = await listHtmlFiles();
  if (!files.length) {
    console.log("No top-level *.html files found.");
    return;
  }

  let changed = 0;
  for (const file of files) {
    const status = await buildFile(file);
    const rel = path.relative(ROOT, file);
    console.log(`  ${status === "updated" ? "[u]" : "[ ]"} ${rel}`);
    if (status === "updated") changed++;
  }

  console.log(`\nDone. ${changed}/${files.length} file(s) changed.`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
