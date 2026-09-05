/**
 * Puts a content hash on /main.js and /styles.css in every HTML file.
 *
 * WHY: this site has no build step, so those two filenames never change when
 * their contents do. On 2026-09-05 a Cloudflare cache rule with a 1-day edge TTL
 * was added, and a main.js deploy went live at the origin while the edge kept
 * serving the old file - measured, not theorised: origin had the new code and
 * cf-cache-status stayed HIT with a climbing age. main.js carries ALL of this
 * site's behaviour (both forms, both view counters, the mobile menu), so a fix
 * to any of it would have been invisible to real visitors for up to a day.
 *
 * The HTML itself is NOT cached at the edge (every page measured DYNAMIC), so a
 * versioned reference propagates immediately. That is what makes this the durable
 * fix rather than a purge: the URL now changes whenever the file does, so the
 * edge can cache those two files hard and still never serve a stale one.
 *
 * Idempotent by design - it writes only when a file actually changes, so running
 * it on every publish produces no diff on a quiet day.
 *
 *   node scripts/version-assets.mjs           rewrite
 *   node scripts/version-assets.mjs --check   verify only, non-zero if stale
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const EXCLUDED_DIRS = new Set([".git", "node_modules", ".github", ".claude"]);

// Hash the BYTES, not a decoded string - otherwise a line-ending difference
// would silently change the version and rewrite all 79 files for nothing.
function versionOf(fileName) {
  return createHash("sha256").update(readFileSync(path.join(REPO_ROOT, fileName))).digest("hex").slice(0, 8);
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

// Matches both the plain reference and an already-versioned one, so re-running
// replaces the old version rather than appending a second query string.
function rewrite(html, mainVer, cssVer) {
  return html
    .replace(/(src="\/main\.js)(?:\?v=[^"]*)?"/g, `$1?v=${mainVer}"`)
    .replace(/(href="\/styles\.css)(?:\?v=[^"]*)?"/g, `$1?v=${cssVer}"`);
}

const checkOnly = process.argv.slice(2).includes("--check");
const mainVer = versionOf("main.js");
const cssVer = versionOf("styles.css");
const files = walk(REPO_ROOT, []);

// A run that examined nothing must fail rather than report success - the exact
// trap the SEO gate in this repo fell into once already.
if (files.length === 0) {
  console.error("no HTML files found - the check would have passed on nothing");
  process.exit(1);
}

const stale = [];
let changed = 0;

for (const file of files) {
  const before = readFileSync(file, "utf8");
  const after = rewrite(before, mainVer, cssVer);
  if (before === after) continue;
  const rel = path.relative(REPO_ROOT, file).split(path.sep).join("/");
  if (checkOnly) {
    stale.push(rel);
  } else {
    writeFileSync(file, after, "utf8");
    console.log("versioned  " + rel);
    changed++;
  }
}

console.log(`\n${files.length} HTML files checked. main.js=${mainVer} styles.css=${cssVer}`);

if (checkOnly) {
  if (stale.length) {
    console.error(`\n${stale.length} file(s) carry a stale or missing asset version:`);
    stale.forEach((f) => console.error("  " + f));
    console.error("run: node scripts/version-assets.mjs");
    process.exit(1);
  }
  console.log("PASS  every HTML file carries the current asset versions.");
  process.exit(0);
}

console.log(`${changed} file(s) rewritten.`);
