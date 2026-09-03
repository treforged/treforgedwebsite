/**
 * Gate for the routing table in CLAUDE.md.
 *
 * A routing table with a wrong row is worse than no table: it sends the next
 * session confidently to a path that is not there, and it does so silently. So
 * every path the table names is checked against disk, the number checked is
 * STATED, and a run that finds nothing to check FAILS rather than reporting
 * success — an empty pass and a real pass must never look the same.
 *
 *   node scripts/check-routing-table.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC = join(ROOT, "CLAUDE.md");

if (!existsSync(DOC)) {
  console.error("FAIL  CLAUDE.md is missing entirely.");
  process.exit(1);
}

const text = readFileSync(DOC, "utf8");

// Only the routing section is in scope. Prose elsewhere may legitimately mention
// paths in other repos (~/.claude/CLAUDE.md, getforgenta/...) which are not ours
// to assert on.
const start = text.indexOf("## Routing table");
const end = text.indexOf("## What this repo is");
if (start === -1 || end === -1 || end < start) {
  console.error("FAIL  could not find the routing section in CLAUDE.md (headings moved?).");
  process.exit(1);
}
const section = text.slice(start, end);

// Backticked things that look like a repo path: contain a slash or a known
// extension, and are not a URL, a query string, a shell command or a glob.
// A leading slash means a URL route (`/founder-waitlist`, `/`), not a repo path.
// Repo paths in this table are always written relative to the repo root.
const SKIP = /^(https?:|~|\/|utm_|0 13|node |git )/;
const LOOKS_LIKE_PATH = /^[A-Za-z0-9._/<>-]+$/;

const candidates = new Set();
for (const m of section.matchAll(/`([^`]+)`/g)) {
  const raw = m[1].trim();
  if (SKIP.test(raw)) continue;
  if (!LOOKS_LIKE_PATH.test(raw)) continue;
  if (!raw.includes("/") && !/\.(html|css|js|mjs|json|md|ts|sql|yml)$/.test(raw)) continue;
  candidates.add(raw);
}

let checked = 0;
let failed = 0;
const skipped = [];

for (const path of [...candidates].sort()) {
  // `blog/<slug>/index.html` and the like are shapes, not paths. Assert the
  // directory that the shape lives in instead, so the row is still proven real.
  if (path.includes("<")) {
    const base = path.slice(0, path.indexOf("<")).replace(/\/$/, "");
    if (!base) {
      skipped.push(path);
      continue;
    }
    checked++;
    if (existsSync(join(ROOT, base))) {
      console.log(`PASS  ${path}  (shape; checked ${base}/)`);
    } else {
      failed++;
      console.log(`FAIL  ${path}  -> ${base}/ does not exist`);
    }
    continue;
  }

  checked++;
  if (existsSync(join(ROOT, path))) {
    console.log(`PASS  ${path}`);
  } else {
    failed++;
    console.log(`FAIL  ${path}  does not exist`);
  }
}

// The gates the table promises must actually be runnable files.
for (const gate of section.matchAll(/node (scripts\/[A-Za-z0-9._-]+)/g)) {
  checked++;
  if (existsSync(join(ROOT, gate[1]))) {
    console.log(`PASS  gate ${gate[1]}`);
  } else {
    failed++;
    console.log(`FAIL  gate ${gate[1]} does not exist`);
  }
}

if (skipped.length) console.log(`\nnot checked (no fixed prefix): ${skipped.join(", ")}`);

console.log(`\n${checked} paths checked, ${failed} missing.`);

if (checked === 0) {
  console.error("FAIL  nothing was checked, so this run proves nothing.");
  process.exit(1);
}
process.exit(failed === 0 ? 0 : 1);
