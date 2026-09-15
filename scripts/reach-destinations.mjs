#!/usr/bin/env node
/**
 * Prevents a renamed or deleted blog slug from silently 404ing a live forge-reach
 * campaign. The first symptom would otherwise be a real visitor hitting a dead
 * link, which is noisy only after the fact.
 *
 * The list of slugs is DERIVED from forge-reach's own committed campaign data
 * (scripts/data/pilot-campaigns.json) and never hand-named here; a hand-named
 * dependency list would allow the file to stay unchanged while a new campaign
 * points at an unseen slug.
 *
 * This script performs a SOURCE check against the repository on disk. The
 * deployed site may be rewritten by Cloudflare at the edge, so committed HTML
 * is not necessarily the HTML that visitors receive.
 *
 * USAGE:
 *   node scripts/reach-destinations.mjs --limits    # what this gate does NOT catch
 *   node scripts/reach-destinations.mjs --refresh   # rewrite the snapshot from forge-reach
 *   node scripts/reach-destinations.mjs            # verify (default)
 *
 * EXIT CODES:
 *   0 - all destinations present (or no drift in snapshot)
 *   1 - a destination is missing or snapshot drift detected
 *   2 - could not check (missing/invalid snapshot, unreadable source, or control failure)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SNAPSHOT_PATH = join(ROOT, 'reach-destinations.json');
const SOURCE_REL = join('scripts', 'data', 'pilot-campaigns.json');
const SOURCE_DIR = process.env.FORGE_REACH_DIR || join(ROOT, '..', 'forge-reach');
const SOURCE_PATH = join(SOURCE_DIR, SOURCE_REL);
const CONTROL_PRESENT = 'index.html';
const CONTROL_ABSENT = join('blog', 'this-slug-does-not-exist-negative-control', 'index.html');

function hasFile(relPath) {
  return existsSync(join(ROOT, relPath));
}
function postPath(slug) {
  return `blog/${slug}/index.html`;
}

/**
 * Derive slugs from forge-reach's campaign JSON.
 * Returns { slugs: string[], skipped: number, rows: number }
 * Exits process with code 2 on any read/parse error or unexpected format.
 */
function deriveSlugs() {
  let raw;
  try {
    raw = readFileSync(SOURCE_PATH, 'utf8');
  } catch (e) {
    console.error(`CANNOT CHECK: ${SOURCE_PATH} could not be read - ${e.message}`);
    process.exit(2);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error(`CANNOT CHECK: ${SOURCE_PATH} could not be read - ${e.message}`);
    process.exit(2);
  }

  if (!Array.isArray(data)) {
    console.error(`CANNOT CHECK: ${SOURCE_PATH} is not an array (got ${typeof data})`);
    process.exit(2);
  }

  const slugsSet = new Set();
  let skipped = 0;
  const rows = data.length;

  for (const row of data) {
    const dest = row?.destination_url;
    if (typeof dest !== 'string') {
      skipped++;
      continue;
    }
    let urlObj;
    try {
      urlObj = new URL(dest);
    } catch {
      skipped++;
      continue;
    }
    const host = urlObj.hostname;
    if (host !== 'treforged.com' && host !== 'www.treforged.com') {
      skipped++;
      continue;
    }
    // Strip leading & trailing slash, then split
    const cleanPath = urlObj.pathname.replace(/^\/|\/$/g, '');
    const parts = cleanPath.split('/');
    if (parts.length !== 2 || parts[0] !== 'blog') {
      skipped++;
      continue;
    }
    const slug = parts[1];
    if (slug) {
      slugsSet.add(slug);
    } else {
      skipped++;
    }
  }

  const slugs = Array.from(slugsSet).sort();
  return { slugs, skipped, rows };
}

/**
 * Read the snapshot file if present.
 * Returns parsed object or null if absent.
 * Exits process with code 2 if present but invalid JSON.
 */
function readSnapshot() {
  if (!existsSync(SNAPSHOT_PATH)) {
    return null;
  }
  let raw;
  try {
    raw = readFileSync(SNAPSHOT_PATH, 'utf8');
  } catch (e) {
    console.error(`CANNOT CHECK: ${SNAPSHOT_PATH} could not be read - ${e.message}`);
    process.exit(2);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`CANNOT CHECK: ${SNAPSHOT_PATH} is not valid JSON - ${e.message}`);
    process.exit(2);
  }
}

/**
 * Compute diff between two slug arrays.
 * Returns { added: string[], removed: string[] }
 */
function diff(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  const added = [...setB].filter(x => !setA.has(x)).sort();
  const removed = [...setA].filter(x => !setB.has(x)).sort();
  return { added, removed };
}

/* -------------------- MODE: --limits -------------------- */
if (process.argv.includes('--limits')) {
  console.log(`WHAT THIS GATE DOES NOT CATCH
- It reads forge-reach's COMMITTED campaign file, not the live reach.campaign
  database. A campaign created straight in the database and never written back
  to that file is invisible here.
- It reads this repo on disk, not the deployed site. Cloudflare rewrites this
  site's markup at the edge, so the committed HTML is not the shipped HTML: a
  post present here can still fail to deploy.
- It asserts blog/<slug>/index.html EXISTS. Not that it is correct, non-empty,
  or linked from anywhere - that is scripts/reachability.mjs.
- Without forge-reach present it verifies the committed snapshot alone, so it
  cannot notice that the campaign list itself has changed.
- It does not check non-blog destinations, only /blog/<slug>/.
`);
  process.exit(0);
}

/* -------------------- MODE: --refresh -------------------- */
if (process.argv.includes('--refresh')) {
  if (!existsSync(SOURCE_PATH)) {
    console.error(`CANNOT REFRESH: forge-reach campaign data not found at ${SOURCE_PATH}. Set FORGE_REACH_DIR.`);
    process.exit(2);
  }

  const { slugs: newSlugs, skipped, rows } = deriveSlugs();
  const prevSnapshot = readSnapshot();

  const snapshotObj = {
    // Recorded relative to this repo, with forward slashes: an absolute path
    // would be one machine's layout committed into a shared file.
    generatedFrom: relative(ROOT, SOURCE_PATH).split(sep).join('/'),
    generatedAt: new Date().toISOString(),
    slugs: newSlugs,
  };
  try {
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshotObj, null, 2) + '\n', 'utf8');
  } catch (e) {
    console.error(`CANNOT CHECK: failed to write ${SNAPSHOT_PATH} - ${e.message}`);
    process.exit(2);
  }

  if (prevSnapshot) {
    const { added, removed } = diff(prevSnapshot.slugs, newSlugs);
    if (added.length === 0 && removed.length === 0) {
      console.log('no change');
    } else {
      for (const s of added) console.log(`+ ${s}`);
      for (const s of removed) console.log(`- ${s}`);
    }
  }

  console.log(`wrote ${newSlugs.length} slugs to reach-destinations.json from ${rows} campaign rows (${skipped} non-blog or unusable rows skipped)`);
  process.exit(0);
}

/* -------------------- DEFAULT MODE (verify) -------------------- */
const snapshot = readSnapshot();
if (!snapshot || !Array.isArray(snapshot.slugs) || snapshot.slugs.length === 0) {
  console.error(`CANNOT CHECK: no usable snapshot at ${SNAPSHOT_PATH}. Run: node scripts/reach-destinations.mjs --refresh`);
  process.exit(2);
}

// Determine effective list
let effectiveSlugs;
let sourceRows = null;
let sourceSkipped = null;

if (existsSync(SOURCE_PATH)) {
  const derived = deriveSlugs();
  console.log(`DERIVED from ${SOURCE_PATH} - ${derived.rows} campaign rows, ${derived.skipped} skipped`);
  const { added, removed } = diff(snapshot.slugs, derived.slugs);
  if (added.length || removed.length) {
    console.log('SNAPSHOT DRIFT - forge-reach\'s campaign list has changed:');
    for (const s of added) console.log(`+ ${s}`);
    for (const s of removed) console.log(`- ${s}`);
    console.log('Run: node scripts/reach-destinations.mjs --refresh  (and make sure every new destination exists here)');
    process.exit(1);
  }
  effectiveSlugs = derived.slugs;
  sourceRows = derived.rows;
  sourceSkipped = derived.skipped;
} else {
  console.log(`SNAPSHOT ONLY - forge-reach was not found at ${SOURCE_PATH}, so the live campaign list was NOT consulted. Set FORGE_REACH_DIR to check it.`);
  effectiveSlugs = snapshot.slugs;
  sourceRows = null;
  sourceSkipped = null;
}

/* -------------------- CONTROLS -------------------- */
// These controls verify that the instrument (hasFile) works as expected.
// If they fail, the gate cannot reliably tell present from absent.
if (!hasFile(CONTROL_PRESENT) || hasFile(CONTROL_ABSENT)) {
  const which = !hasFile(CONTROL_PRESENT) ? 'CONTROL_PRESENT' : 'CONTROL_ABSENT';
  console.error(`CONTROL FAILED: ${which} - this gate cannot tell present from absent, so its result means nothing`);
  process.exit(2);
}

/* -------------------- CHECK EACH SLUG -------------------- */
let missingCount = 0;
for (const slug of effectiveSlugs) {
  const rel = postPath(slug);
  if (hasFile(rel)) {
    console.log(`OK       ${slug}`);
  } else {
    console.log(`MISSING  ${rel}`);
    missingCount++;
  }
}

/* -------------------- SUMMARY -------------------- */
const totalChecked = effectiveSlugs.length;
const skippedDisplay = sourceRows === null ? 'n/a' : String(sourceSkipped);
console.log('');
console.log(`${totalChecked} destinations checked, ${missingCount} missing, ${skippedDisplay} source rows skipped`);

if (missingCount > 0) {
  console.log(
    'A campaign points at a post that is not in this repo. If you renamed it, ' +
      'restore the old path or leave a redirect, and tell the forge-reach desk.'
  );
  process.exit(1);
}

process.exit(0);
