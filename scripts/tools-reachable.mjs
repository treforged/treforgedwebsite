#!/usr/bin/env node
/**
 * The calculators were built, shipped, listed in the sitemap - and reachable
 * from nowhere. No nav entry, no hub page, and /tools/ itself was a 404. Three
 * working tools that a visitor could not find is the same defect as three tools
 * that do not exist, and nothing in the repo went red about it.
 *
 * So this asserts REACHABILITY, not existence:
 *   - /tools/ exists and links to every calculator directory on disk
 *   - every page that carries the site nav carries a link to /tools/
 *   - the blog template emits one too, so tomorrow's post is not an exception
 *
 * It exits non-zero when nothing was checked, so an empty run cannot read as a
 * pass.
 *
 * Usage: node scripts/tools-reachable.mjs
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
let checks = 0;
let failed = 0;

function check(ok, label, detail) {
  checks += 1;
  if (ok) {
    console.log('ok   ' + label);
  } else {
    failed += 1;
    console.log('FAIL ' + label + (detail ? '  ->  ' + detail : ''));
  }
}

// ---- the hub page itself -------------------------------------------------
const hubPath = join(root, 'tools', 'index.html');
check(existsSync(hubPath), '/tools/ has an index.html', hubPath);
const hub = existsSync(hubPath) ? readFileSync(hubPath, 'utf8') : '';

// ---- every calculator on disk is linked from the hub ---------------------
const toolDirs = readdirSync(join(root, 'tools'))
  .filter((name) => statSync(join(root, 'tools', name)).isDirectory())
  .filter((name) => existsSync(join(root, 'tools', name, 'index.html')));

check(toolDirs.length > 0, 'there is at least one calculator to link to',
  'found ' + toolDirs.length);

for (const slug of toolDirs) {
  check(hub.includes('href="/tools/' + slug + '/"'),
    'the hub links to /tools/' + slug + '/');
}

// ---- the hub is in the sitemap -------------------------------------------
const sitemap = readFileSync(join(root, 'sitemap.xml'), 'utf8');
check(sitemap.includes('<loc>https://treforged.com/tools/</loc>'),
  '/tools/ is in sitemap.xml');

// ---- every navigated page points at /tools/ ------------------------------
function htmlFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) htmlFiles(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

const navPages = htmlFiles(root).filter((f) =>
  readFileSync(f, 'utf8').includes('<nav class="primary"'));

check(navPages.length > 0, 'found pages carrying the site nav',
  navPages.length + ' pages');

const missing = navPages.filter((f) =>
  !readFileSync(f, 'utf8').includes('href="/tools/"'));

check(missing.length === 0,
  'every page with the site nav links to /tools/',
  missing.length + ' missing: ' + missing.slice(0, 5).map((f) => f.replace(root, '')).join(', '));

// ---- and the generator will keep emitting it ----------------------------
const publisher = readFileSync(join(root, 'scripts', 'publish-next.mjs'), 'utf8');
check(/link\(\s*'\/tools\/'/.test(publisher),
  'the blog template emits a /tools/ nav link, so new posts are not an exception');

// ---- verdict -------------------------------------------------------------
console.log('');
if (checks === 0) {
  console.log('FAIL - nothing was checked, which is not a pass.');
  process.exit(1);
}
console.log(checks + ' checks run, ' + failed + ' failed.');
process.exit(failed === 0 ? 0 : 1);
