#!/usr/bin/env node
/**
 * build-pages.mjs - the Cloudflare Pages build for treforged.com.
 *
 * Cloudflare Pages settings (docs/cloudflare-cutover.md):
 *   Build command:           npm run build
 *   Build output directory:  dist
 *   Node:                    .nvmrc (24), plus NODE_VERSION=24 as a belt
 *
 * WHY THERE IS A BUILD AT ALL. GitHub Pages served the repository root, so
 * every tracked file was public: scripts/, supabase/, content-queue/, docs/,
 * CLAUDE.md. Tre wants the code private (2026-10-08). Making the GitHub repo
 * private is not enough if the host still serves the whole checkout - the
 * prompt, the pipeline and the migrations would be one URL away. So this copies
 * ONLY the served site into dist/, and Cloudflare serves dist/.
 *
 * The site itself is still hand-written: nothing is transpiled or bundled. A
 * file in dist/ is byte-identical to the committed file.
 *
 * FAIL-CLOSED CLASSIFICATION. Every tracked file must be classified PUBLIC or
 * PRIVATE below. A tracked file that is neither stops the build (exit 1) and is
 * named. Guessing would go wrong in one of two silent ways: a new page dir that
 * is dropped (a 404 nobody notices) or a new private dir that is published (a
 * leak nobody notices). Add it to one list, on purpose.
 *
 * GATES FIRST. Before assembling, it runs the gates that were already
 * BLOCKING somewhere on GitHub - the daily publish's SEO gate and the jobs in
 * lint.yml - because Cloudflare builds cost no Actions minutes and those do.
 * A red gate fails the build and Cloudflare keeps serving the previous
 * deployment, which is strictly safer than GitHub Pages, which served whatever
 * was committed. SKIP_GATES=1 is the loud way past them in an emergency.
 *
 * Not ported, and why (see docs/cloudflare-cutover.md):
 *   - the Deno test of the result-email function: no Deno in the build image;
 *   - secret-scan-ci --range: the build sees one commit, not the pushed range,
 *     so a key added and deleted inside one push is not caught here;
 *   - anything that needs the network (live-cta-listener, cache-check).
 *
 * Usage:
 *   node scripts/build-pages.mjs              gates, then assemble dist/
 *   node scripts/build-pages.mjs --no-gates   assemble only (local iteration)
 *   node scripts/build-pages.mjs --limits     print what this cannot see
 *
 * Exit codes: 0 built   1 a gate failed, or the output is wrong   2 could not
 * build (no git, nothing examined)
 */
import { spawnSync, execFileSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync,
} from "node:fs";
import { dirname, extname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist");
const SITE = "https://treforged.com";
const args = process.argv.slice(2);

if (args.includes("--limits")) {
  console.log(`build-pages.mjs cannot see:
  - what Cloudflare actually serves. It checks dist/ on disk; the edge can
    rewrite markup, and _headers/_redirects are applied by Cloudflare, not here.
    After cutover, check the live site (docs/cloudflare-cutover.md, section 5).
  - links inside main.js or inline scripts. Only href/src attributes are read.
  - a key added and deleted inside one push (no --range in the build).
  - the Deno result-email test, which needs Deno.
  - untracked files: the inventory is git ls-files, so an uncommitted page is
    absent from dist/ even if it is on your disk.`);
  process.exit(0);
}

// ── Classification ────────────────────────────────────────────────────────
// Top-level files served as-is.
const PUBLIC_FILES = new Set([
  "index.html", "main.js", "styles.css", "favicon.ico",
  "feed.xml", "sitemap.xml", "robots.txt", "llms.txt",
]);
// Directories that are part of the site. Everything inside is served, except
// the PRIVATE_IN_PUBLIC patterns, and only with a SERVED_EXT extension.
const PUBLIC_DIRS = new Set([
  "about", "assets", "blog", "cars", "contact", "founders",
  "partnerships", "services", "tools",
]);
const SERVED_EXT = new Set([
  ".html", ".js", ".css", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg",
  ".ico", ".xml", ".txt", ".webmanifest", ".woff", ".woff2",
]);
// Tracked but never served. The value is the reason, printed in the summary.
const PRIVATE_TOP = new Map([
  [".gitattributes", "git config"], [".gitignore", "git config"],
  [".githooks", "git hooks"], [".github", "workflows"],
  [".npmrc", "tooling"], [".nvmrc", "tooling"], [".semgrep", "tooling"],
  ["eslint.config.mjs", "tooling"], ["package.json", "tooling"],
  ["package-lock.json", "tooling"], ["deno.lock", "tooling"],
  ["reachability.config.json", "tooling"], ["reach-destinations.json", "tooling"],
  ["CLAUDE.md", "desk notes"], ["docs", "desk notes"],
  ["scripts", "pipeline and gates"], ["content-queue", "pipeline and gates"],
  ["supabase", "backend source"],
  ["cloudflare", "build input (copied as _headers, _redirects, 404.html)"],
  ["CNAME", "GitHub Pages only - Cloudflare takes the domain in its dashboard"],
  // Meta-refresh stubs on GitHub Pages; real 301s in cloudflare/_redirects.
  ["cars.html", "replaced by a 301 in _redirects"],
  ["contact.html", "replaced by a 301 in _redirects"],
  ["founder.html", "replaced by a 301 in _redirects"],
]);
const PRIVATE_IN_PUBLIC = [
  [/\.test\.mjs$/, "test suite"],
  [/(^|\/)\.keep$/, "placeholder"],
];
// Files from cloudflare/ that land at the root of dist/.
const CLOUDFLARE_FILES = ["_headers", "_redirects", "404.html"];

function classify(path) {
  const top = path.split("/")[0];
  if (PRIVATE_TOP.has(top)) return { kind: "private", why: PRIVATE_TOP.get(top) };
  if (!path.includes("/")) {
    return PUBLIC_FILES.has(path) ? { kind: "public" } : { kind: "unclassified" };
  }
  if (!PUBLIC_DIRS.has(top)) return { kind: "unclassified" };
  for (const [re, why] of PRIVATE_IN_PUBLIC) if (re.test(path)) return { kind: "private", why };
  if (!SERVED_EXT.has(extname(path).toLowerCase())) return { kind: "unclassified" };
  return { kind: "public" };
}

// ── Gates ─────────────────────────────────────────────────────────────────
// The union of daily-article.yml's SEO gate and lint.yml's node jobs.
const GATES = [
  ["scripts/generator-prompt.test.mjs"],
  ["scripts/test-cta-clicks.mjs"],
  ["scripts/body-sync.mjs"],
  ["scripts/test-version-assets.mjs"],
  ["scripts/version-assets.mjs", "--check"],
  ["scripts/test-source-attribution.mjs"],
  ["scripts/seo-check.mjs"],
  ["scripts/form-control-theming.mjs"],
  ["scripts/test-tool-views.mjs"],
  ["scripts/test-page-views.mjs"],
  ["scripts/reach-destinations.mjs"],
  ["scripts/secret-scan-ci.mjs"],
  ["scripts/secret-scan.test.mjs"],
  ["scripts/lint-baseline.mjs", "--max-warnings=0"],
  ["tools/safe-to-spend-calculator/result-email.test.mjs"],
];

function runGates() {
  // Tool suites are DISCOVERED, as in daily-article.yml, so a new calculator is
  // gated the day it lands - and discovering none is a failure, not a pass.
  const suites = [];
  for (const d of readdirSync(join(ROOT, "tools"), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const f of ["calc.test.mjs", "costs.test.mjs", "page.test.mjs"]) {
      if (existsSync(join(ROOT, "tools", d.name, f))) suites.push([`tools/${d.name}/${f}`]);
    }
  }
  if (suites.length === 0) {
    console.error("FAIL  no tool test suites found under tools/*/ - the gate would have passed on nothing");
    process.exit(1);
  }
  const all = [...GATES, ...suites];
  for (const [script, ...rest] of all) {
    console.log(`\n--- gate: node ${script} ${rest.join(" ")}`);
    const r = spawnSync(process.execPath, [script, ...rest], { cwd: ROOT, stdio: "inherit" });
    if (r.status !== 0) {
      console.error(`\nFAIL  gate ${script} exited ${r.status}. Nothing was deployed; the previous deployment stays live.`);
      process.exit(1);
    }
  }
  console.log(`\ngates: ${all.length} passed (${suites.length} tool suites discovered)`);
}

// ── Assemble ──────────────────────────────────────────────────────────────
function trackedFiles() {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" });
    return out.split("\0").filter(Boolean);
  } catch (e) {
    console.error("could not run git ls-files - the inventory is the tracked tree, so nothing can be built: " + e.message);
    process.exit(2);
  }
}

function copyInto(rel, from) {
  const dest = join(OUT, rel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(from, dest);
}

function walk(dir, base = "") {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

// ── Verify dist/ ──────────────────────────────────────────────────────────
function verify() {
  const problems = [];
  const files = walk(OUT);
  const set = new Set(files);
  const MAX_FILES = 20000; // Pages Free plan
  const MAX_BYTES = 25 * 1024 * 1024; // per file

  if (files.length > MAX_FILES) problems.push(`${files.length} files exceeds the Pages free limit of ${MAX_FILES}`);
  for (const f of files) {
    if (statSync(join(OUT, f)).size > MAX_BYTES) problems.push(`${f} exceeds 25 MiB`);
    if (f === "_headers" || f === "_redirects") continue;
    if (!SERVED_EXT.has(extname(f).toLowerCase())) problems.push(`${f} has an extension that is never served - private file leaked into dist/?`);
  }
  for (const must of ["index.html", "404.html", "_headers", "_redirects", "sitemap.xml", "robots.txt"]) {
    if (!set.has(must)) problems.push(`dist/${must} is missing`);
  }

  // A URL path resolves the way Pages resolves it: a file, or dir/index.html.
  const redirectSources = new Set();
  const resolves = (p) => {
    const clean = decodeURIComponent(p.split(/[?#]/)[0]).replace(/^\/+/, "");
    if (clean === "" ) return set.has("index.html");
    if (set.has(clean)) return true;
    if (set.has(posix.join(clean, "index.html"))) return true;
    return redirectSources.has("/" + clean);
  };

  // _redirects: every destination must exist, and no source may be shadowed by
  // a real file (Pages would serve the file and the redirect would never fire).
  let redirects = 0;
  for (const line of readFileSync(join(OUT, "_redirects"), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const [from, to] = t.split(/\s+/);
    redirects++;
    redirectSources.add(from);
    if (set.has(from.replace(/^\//, ""))) problems.push(`_redirects source ${from} is shadowed by a real file in dist/`);
    if (to.startsWith("/") && !resolves(to)) problems.push(`_redirects destination ${to} does not exist in dist/`);
  }

  // Every sitemap URL must be served.
  const locs = [...readFileSync(join(OUT, "sitemap.xml"), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  for (const loc of locs) {
    if (!loc.startsWith(SITE)) { problems.push(`sitemap URL ${loc} is not on ${SITE}`); continue; }
    if (!resolves(loc.slice(SITE.length) || "/")) problems.push(`sitemap URL ${loc} has no file in dist/`);
  }

  // Every root-relative href/src in a served page must resolve in dist/. This is
  // the check the repo-level reachability gate cannot make: a link into a dir
  // that is PRIVATE here is fine on GitHub Pages and a 404 on Cloudflare.
  let links = 0;
  for (const f of files.filter((x) => x.endsWith(".html"))) {
    const html = readFileSync(join(OUT, f), "utf8");
    for (const m of html.matchAll(/\b(?:href|src)="([^"]*)"/g)) {
      const v = m[1];
      if (!v.startsWith("/") || v.startsWith("//")) continue;
      links++;
      if (!resolves(v)) problems.push(`${f} links to ${v}, which is not in dist/`);
    }
  }

  return { files: files.length, locs: locs.length, links, redirects, problems };
}

// ── Main ──────────────────────────────────────────────────────────────────
const tracked = trackedFiles();
if (tracked.length === 0) {
  console.error("git ls-files returned nothing - examined zero files, refusing to build");
  process.exit(2);
}

const unclassified = [];
const publicFiles = [];
const privateCounts = new Map();
for (const f of tracked) {
  const c = classify(f);
  if (c.kind === "public") publicFiles.push(f);
  else if (c.kind === "private") privateCounts.set(c.why, (privateCounts.get(c.why) || 0) + 1);
  else unclassified.push(f);
}
if (unclassified.length) {
  console.error("FAIL  tracked files that are neither PUBLIC nor PRIVATE in scripts/build-pages.mjs:");
  for (const f of unclassified) console.error("  " + f);
  console.error("Add each to PUBLIC_FILES/PUBLIC_DIRS (served) or PRIVATE_TOP (never served). Guessing is how a page goes missing or a script goes public.");
  process.exit(1);
}

if (args.includes("--no-gates")) {
  console.log("gates: SKIPPED (--no-gates). Do not use this for a deploy.");
} else if (process.env.SKIP_GATES === "1" || process.env.SKIP_GATES === "true") {
  console.log("!!! gates: SKIPPED because SKIP_GATES is set. This deploy was NOT checked. Remove the variable after the emergency. !!!");
} else {
  runGates();
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const f of publicFiles) copyInto(f, join(ROOT, f));
for (const f of CLOUDFLARE_FILES) {
  const src = join(ROOT, "cloudflare", f);
  if (!existsSync(src)) { console.error(`FAIL  cloudflare/${f} is missing`); process.exit(1); }
  copyInto(f, src);
}

const v = verify();
console.log(`\ntracked: ${tracked.length}  served: ${publicFiles.length} + ${CLOUDFLARE_FILES.length} from cloudflare/`);
for (const [why, n] of [...privateCounts].sort((a, b) => b[1] - a[1])) console.log(`  not served  ${String(n).padStart(4)}  ${why}`);
console.log(`dist/: ${v.files} files, ${v.locs} sitemap URLs, ${v.links} root-relative links, ${v.redirects} redirects checked`);
if (v.problems.length) {
  console.error(`\nFAIL  ${v.problems.length} problem(s) in dist/:`);
  for (const p of v.problems) console.error("  " + p);
  process.exit(1);
}
console.log("PASS - dist/ holds only the served site, and every sitemap URL, link and redirect resolves in it.");
