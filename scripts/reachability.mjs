#!/usr/bin/env node
/**
 * reachability.mjs - "is this thing actually reachable?", as a portable gate.
 *
 * WHY THIS EXISTS. Four times in one week, across three repos, something was
 * built, tested, described in a handoff - and reachable from nowhere. Three
 * calculators with no nav entry and a 404 hub. A Conversation tab whose two
 * handlers both opened the desk view. Modules exported and never imported.
 * Every one was found by a person stumbling over it, because every gate in
 * every repo was asking "does it exist?" and the defect was "can anyone get
 * to it?".
 *
 * Those are two DIFFERENT failures and this reports them separately:
 *
 *   ORPHAN  - the target exists on disk and NOTHING links to it.
 *             The thing that keeps happening. Silent by construction: the
 *             feature works perfectly for anyone who already knows the URL.
 *
 *   BROKEN  - something links to a target that does not exist.
 *             The opposite direction. Loud for a visitor, invisible in CI.
 *
 * Collapsing them into one "link problem" count is what lets an orphan hide:
 * a repo with zero broken links reads as healthy while a whole feature is
 * unreachable.
 *
 * IT REFUSES TO BE VACUOUSLY GREEN. It prints what it examined - files, links,
 * targets, rules - and exits 2 (not 0, and not 1) when it examined nothing, or
 * when its own config is missing or names a directory that is not there. A
 * check whose glob silently matched no files is the "confident blank" shape:
 * it cannot fail, so it is not a check. Exit 2 means "I could not look";
 * exit 1 means "I looked and it is broken". Never let those share a code.
 *
 * PORTABLE ON PURPOSE. No dependencies, no framework knowledge, one file plus
 * a JSON config. See the "Adapting this to another repo" section in
 * docs/reachability.md.
 *
 * Usage:
 *   node scripts/reachability.mjs [--config=reachability.config.json] [--verbose]
 *
 * Exit codes:  0 reachable   1 defects found   2 could not examine anything
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, posix } from 'node:path';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const VERBOSE = argv.includes('--verbose');
const CONFIG_PATH = join(ROOT, arg('config', 'reachability.config.json'));

/** Exit 2, reserved for "I could not look" - never for "I looked and it failed". */
const cannotExamine = (why) => {
  console.log(`CANNOT EXAMINE - ${why}`);
  console.log('This is exit 2, not a pass and not a failure: nothing was actually checked.');
  process.exit(2);
};

if (!existsSync(CONFIG_PATH)) {
  cannotExamine(`no config at ${relative(ROOT, CONFIG_PATH)}`);
}

let config;
try {
  config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
} catch (err) {
  cannotExamine(`config is not valid JSON: ${err.message}`);
}

const IGNORE = new Set(config.ignore || ['.git', 'node_modules', 'dist', 'build', '.next']);
const SCAN_EXT = config.scan || ['.html'];
const LINK_PATTERNS = (config.linkPatterns || ['href="([^"]+)"', 'src="([^"]+)"'])
  .map((p) => new RegExp(p, 'g'));

// ---------------------------------------------------------------------------
// Walk the tree once. Everything below reads from this, so the file count in
// the summary is the real denominator rather than a second, hopeful walk.
// ---------------------------------------------------------------------------
const walk = (dir, out = []) => {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (IGNORE.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

const allFiles = walk(ROOT);
const scanned = allFiles.filter((f) => SCAN_EXT.some((ext) => f.endsWith(ext)));

if (scanned.length === 0) {
  cannotExamine(`no files matched scan extensions ${JSON.stringify(SCAN_EXT)}`);
}

// ---------------------------------------------------------------------------
// Extract every internal link, remembering which file each came from - a
// broken link is only actionable if you are told where it lives.
// ---------------------------------------------------------------------------
const isInternal = (href) =>
  href.startsWith('/') && !href.startsWith('//') && !href.includes('://');

/** Strip the query and fragment. Asset URLs here carry a ?v=<hash> cache-buster. */
const bare = (href) => href.split('#')[0].split('?')[0];

const links = []; // { href, from }
const contents = new Map(); // path -> text, read once
for (const file of scanned) {
  const text = readFileSync(file, 'utf8');
  contents.set(file, text);
  for (const pattern of LINK_PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const href = bare(m[1]);
      if (href && isInternal(href)) links.push({ href, from: relative(ROOT, file) });
    }
  }
}

if (links.length === 0) {
  cannotExamine(`scanned ${scanned.length} file(s) but found no internal links - the link patterns match nothing`);
}

const inboundCount = (href) => links.filter((l) => l.href === href).length;

// ---------------------------------------------------------------------------
// Resolve a site-absolute href to a file on disk, so "linked but broken" is a
// fact rather than a guess. "/x/" -> x/index.html, "/x.html" -> x.html.
// ---------------------------------------------------------------------------
const resolveOnDisk = (href) => {
  const rel = href.replace(/^\//, '');
  const candidates = href.endsWith('/') || rel === ''
    ? [join(ROOT, rel, 'index.html')]
    : [join(ROOT, rel), join(ROOT, rel, 'index.html'), join(ROOT, `${rel}.html`)];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) || null;
};

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
let orphans = 0;
let brokenLinks = 0;
let ruleFailures = 0;
let targetsExamined = 0;
let rulesExamined = 0;

const say = (ok, label, detail) =>
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail ? `  ->  ${detail}` : ''}`);

// ---- ORPHANS: a target exists and nothing points at it --------------------
console.log('== targets: does anything link to them? ==');
for (const target of config.targets || []) {
  const dir = join(ROOT, target.fromDir);
  if (!existsSync(dir)) {
    cannotExamine(`target group "${target.name}" names fromDir "${target.fromDir}", which does not exist`);
  }
  const found = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !target.requireFile || existsSync(join(dir, name, target.requireFile)));

  if (found.length === 0) {
    cannotExamine(`target group "${target.name}" discovered nothing under ${target.fromDir}/ - a group that matches nothing cannot fail`);
  }

  for (const name of found) {
    targetsExamined += 1;
    const href = target.href.replace('{dir}', name);
    const inbound = inboundCount(href);
    const min = target.minInbound ?? 1;
    const ok = inbound >= min;
    if (!ok) orphans += 1;
    say(ok, `${href} has ${inbound} inbound link(s)`,
      `ORPHAN - it exists on disk and ${inbound === 0 ? 'nothing links to it' : `only ${inbound} link(s), below ${min}`}. Built and unreachable.`);
  }
}

// ---- BROKEN: something points at a target that is not there ---------------
console.log('\n== links: do they resolve to something real? ==');
const seenHrefs = new Map(); // href -> first source, deduped so one bad nav is one line
for (const link of links) {
  if (!seenHrefs.has(link.href)) seenHrefs.set(link.href, link.from);
}
const dead = [];
for (const [href, from] of seenHrefs) {
  if (config.allowUnresolved && config.allowUnresolved.some((p) => href.startsWith(p))) continue;
  if (!resolveOnDisk(href)) dead.push({ href, from, count: inboundCount(href) });
}
brokenLinks = dead.length;
say(brokenLinks === 0,
  `${seenHrefs.size} distinct internal link target(s) resolve to a file on disk`,
  `BROKEN: ${dead.slice(0, 8).map((d) => `${d.href} (${d.count}x, e.g. ${d.from})`).join('; ')}`);
if (VERBOSE) for (const d of dead) console.log(`     broken: ${d.href}  <- ${d.from}`);

// ---- RULES: "every page that looks like X must link to Y" -----------------
// The nav case. An orphan check alone passes as soon as ONE page links the
// target, so without this a hub linked only from its own children looks fine.
console.log('\n== rules: must-link ==');
for (const rule of config.mustLink || []) {
  rulesExamined += 1;
  const matching = scanned.filter((f) => contents.get(f).includes(rule.filesContaining));
  if (matching.length === 0) {
    cannotExamine(`rule "${rule.name}" matched no files containing ${JSON.stringify(rule.filesContaining)} - a rule with no subjects cannot fail`);
  }
  const missing = matching.filter((f) => !contents.get(f).includes(rule.mustContain));
  const ok = missing.length === 0;
  if (!ok) ruleFailures += 1;
  say(ok, `${rule.name} (${matching.length} page(s) examined)`,
    `${missing.length} missing ${rule.mustContain}: ${missing.slice(0, 5).map((f) => relative(ROOT, f)).join(', ')}`);
}

// ---- verdict --------------------------------------------------------------
console.log('\n== examined ==');
console.log(`files scanned:      ${scanned.length}`);
console.log(`internal links:     ${links.length} (${seenHrefs.size} distinct)`);
console.log(`targets examined:   ${targetsExamined}`);
console.log(`must-link rules:    ${rulesExamined}`);

const total = orphans + brokenLinks + ruleFailures;
console.log('');
if (targetsExamined === 0 && rulesExamined === 0) {
  cannotExamine('the config declares no targets and no rules');
}
if (total === 0) {
  console.log('PASS - everything examined is reachable.');
  process.exit(0);
}
console.log(`FAIL - ${orphans} orphaned target(s), ${brokenLinks} broken link target(s), ${ruleFailures} must-link rule(s) failed.`);
process.exit(1);
