#!/usr/bin/env node
/**
 * The tool pages are counted silently, so nothing on screen would ever show
 * this counter breaking - it would just stop recording and the number would sit
 * still, which looks exactly like nobody visiting. That is the failure mode a
 * committed check has to cover.
 *
 * It does NOT re-implement the logic. It cuts the real block out of main.js and
 * runs it, so a change to main.js that this file does not know about still gets
 * exercised. A stub would only ever prove the stub.
 *
 * Usage: node scripts/test-tool-views.mjs
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../main.js', import.meta.url), 'utf8');

// Cut out the real block, between its own comment and the next one.
const start = src.indexOf('// ── Tool pages: count the view, silently');
const end = src.indexOf('// ── Preview cards:', start);
if (start === -1 || end === -1) {
  console.log('FAIL - could not find the tool-view block in main.js.');
  console.log('       If it was renamed, update this test; do not delete it.');
  process.exit(1);
}
const block = src.slice(start, end);

// The server's own rule, copied from increment_page_view. A slug this rejects
// raises 'invalid slug' and the view is lost.
const SERVER_SLUG = /^[a-z0-9]([a-z0-9-]{0,98}[a-z0-9])?$/;

let checks = 0;
let failed = 0;
function check(ok, label, detail) {
  checks += 1;
  if (ok) console.log('ok   ' + label);
  else { failed += 1; console.log('FAIL ' + label + (detail ? '  ->  ' + detail : '')); }
}

/**
 * Runs the extracted block against one path and reports what it did.
 * storage: 'ok' | 'throws' | 'seen'
 */
function run(pathname, storage = 'ok') {
  const calls = [];
  const store = new Map();
  if (storage === 'seen') store.set('tf_viewed_tool-emergency-fund-calculator', '1');

  const sessionStorage = {
    getItem(k) { if (storage === 'throws') throw new Error('private mode'); return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { if (storage === 'throws') throw new Error('private mode'); store.set(k, v); },
  };
  const location = { pathname };
  const viewsRpc = (fn, body) => { calls.push({ fn, body }); return Promise.resolve(1); };

  // The block also records the arrival source (ARRIVAL_SEND, 2026-09-16), which
  // calls main.js's wlSource(). Stubbed here; test-source-attribution.mjs owns it.
  const wlSource = () => 'direct';
  // eslint-disable-next-line no-new-func
  const fn = new Function('location', 'sessionStorage', 'viewsRpc', 'wlSource', block);
  fn(location, sessionStorage, viewsRpc, wlSource);
  // Only the page-view call is this gate's subject; the arrival call is a
  // second, separate RPC on every page and is test-source-attribution's.
  return { calls: calls.filter((c) => c.fn === 'increment_page_view'), arrivals: calls.filter((c) => c.fn === 'record_arrival'), store };
}

// ---- the paths that must be counted, and the slug each must produce -------
const counted = [
  ['/tools/', 'tools-hub'],
  ['/tools', 'tools-hub'],
  ['/tools/emergency-fund-calculator/', 'tool-emergency-fund-calculator'],
  ['/tools/emergency-fund-calculator', 'tool-emergency-fund-calculator'],
  ['/tools/debt-payoff-calculator/', 'tool-debt-payoff-calculator'],
  ['/tools/credit-card-interest-calculator/', 'tool-credit-card-interest-calculator'],
  ['/tools/safe-to-spend-calculator/', 'tool-safe-to-spend-calculator'],
];

for (const [path, slug] of counted) {
  const { calls } = run(path);
  check(calls.length === 1 && calls[0].body.p_slug === slug,
    path + ' counts as "' + slug + '"',
    calls.length ? calls[0].body.p_slug : 'no call made');
  check(calls.length === 1 && calls[0].fn === 'increment_page_view',
    path + ' calls increment_page_view');
  check(SERVER_SLUG.test(slug),
    'the server would accept "' + slug + '"');
}

// ---- the paths that must NOT be counted ----------------------------------
// The static pages ARE counted since 2026-09-22 (PAGEVIEW_BLOCK, page-<name>).
for (const [path, slug] of [['/', 'page-home'], ['/founders/', 'page-founders'], ['/about/', 'page-about']]) {
  const { calls } = run(path);
  check(calls.length === 1 && calls[0].body.p_slug === slug, path + ' counts once as "' + slug + '"',
    calls.map((c) => c.body.p_slug).join(', ') || 'no call made');
}

// KNOWN DEFECT, left RED on purpose (ask eed894b3): /tools/ is counted by BOTH
// the tool block ("tools-hub") and the static list ("page-tools", added
// 2026-09-22), so the hub's views are split across two slugs. The /tools/ rows
// above fail until main.js counts the hub once.

for (const path of ['/tools/a/b/', '/blog/car-loans-explained/', '/toolsy/',
                    '/tools/Some-Name/']) {
  const { calls } = run(path);
  check(calls.length === 0, path + ' is not counted', calls.length + ' call(s) made');
}

// ---- one view per session ------------------------------------------------
{
  const { calls } = run('/tools/emergency-fund-calculator/', 'seen');
  check(calls.length === 0, 'a slug already marked seen this session is not counted again');
}

// ---- private mode must NOT silence the counter ---------------------------
{
  const { calls } = run('/tools/emergency-fund-calculator/', 'throws');
  check(calls.length === 1,
    'a browser whose sessionStorage throws still has its view counted',
    calls.length + ' call(s) made');
}

// ---- no blog post can collide with a tool slug ---------------------------
{
  const { readdirSync } = await import('node:fs');
  const slugs = readdirSync(new URL('../blog', import.meta.url));
  const collide = slugs.filter((s) => s === 'tools-hub' || s.startsWith('tool-'));
  check(collide.length === 0,
    'no blog post slug collides with the tool counter namespace',
    collide.join(', '));
}

// ---- verdict -------------------------------------------------------------
console.log('');
if (checks === 0) {
  console.log('FAIL - nothing was checked, which is not a pass.');
  process.exit(1);
}
console.log(checks + ' checks run, ' + failed + ' failed.');
process.exit(failed === 0 ? 0 : 1);
