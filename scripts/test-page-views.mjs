/**
 * Gate for static-page view counting.
 *
 * Until 2026-09-15 ONLY /blog/<slug>/ and the tool pages incremented
 * page_views. Every other page therefore read as 0 views - and a 0 that comes
 * from an uninstrumented page is an ABSENCE, not a measurement. It is
 * indistinguishable from nobody arriving, which is exactly the reading the
 * founders waitlist experiment was supposed to be judged on.
 *
 * So this asserts the MAPPING, path by path: which paths produce which slug,
 * which paths produce none at all, and that a second visit in the same session
 * sends nothing. It EXTRACTS the shipped block out of main.js rather than
 * restating it, so if the block moves or is deleted this FAILS instead of
 * passing over a stale copy of the logic.
 *
 * What it does NOT catch: whether the RPC reaches Supabase, whether the server
 * accepts the slug, or whether the page actually loads main.js. Those need the
 * live endpoint, not a sandbox.
 *
 *   node scripts/test-page-views.mjs
 */

import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../main.js", import.meta.url), "utf8");

const start = SRC.indexOf("// PAGEVIEW_BLOCK_START");
if (start === -1) throw new Error("page-view block not found in main.js (marker moved?)");
const end = SRC.indexOf("// PAGEVIEW_BLOCK_END", start);
if (end === -1) throw new Error("could not find the end of the page-view block in main.js");
const BLOCK = SRC.slice(start, end);

if (!BLOCK.includes("increment_page_view")) {
  throw new Error("extracted block does not call increment_page_view - wrong block");
}

// Runs the shipped block against a fake location/sessionStorage/viewsRpc and
// reports what it tried to send.
function run(pathname, { storageThrows = false, store = new Map() } = {}) {
  const sent = [];
  const sessionStorage = {
    getItem(k) {
      if (storageThrows) throw new Error("private mode");
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      if (storageThrows) throw new Error("private mode");
      store.set(k, v);
    },
  };
  const viewsRpc = (fn, args) => {
    sent.push({ fn, slug: args.p_slug });
    return Promise.resolve(1);
  };
  // Same technique as scripts/test-cta-clicks.mjs: run the SHIPPED source, so
  // a moved or deleted block fails here rather than passing over a restatement.
  // eslint-disable-next-line no-new-func
  const fn = new Function("location", "sessionStorage", "viewsRpc", BLOCK);
  fn({ pathname }, sessionStorage, viewsRpc);
  return { sent, store };
}

// The server's own slug rule. A slug this gate accepts but the server rejects
// would be counted nowhere, silently - so assert it here rather than trusting it.
const SERVER_SLUG = /^[a-z0-9]([a-z0-9-]{0,98}[a-z0-9])?$/;

const COUNTED = [
  ["/", "page-home"],
  ["/index.html", "page-home"],
  ["/founders/", "page-founders"],
  ["/founders", "page-founders"],
  ["/about/", "page-about"],
  ["/cars/", "page-cars"],
  ["/contact/", "page-contact"],
  ["/partnerships/", "page-partnerships"],
  ["/services/", "page-services"],
];

const NOT_COUNTED = [
  "/blog/how-to-change-a-flat-tire/",  // articles have their own counter
  "/tools/",                            // tools have their own counter
  "/tools/auto-loan-calculator/",
  "/founders/extra/",                   // deeper path is not the page
  "/nope/",                             // unknown path must go uncounted
  "/../etc/passwd",
  "/Founders/",                         // case matters: the server slug is lower-case only
];

let checked = 0;
const failures = [];

for (const [path, expected] of COUNTED) {
  checked++;
  const { sent } = run(path);
  if (sent.length !== 1) {
    failures.push(`${path}: expected 1 increment, got ${sent.length}`);
    continue;
  }
  if (sent[0].slug !== expected) {
    failures.push(`${path}: expected slug ${expected}, got ${sent[0].slug}`);
  }
  if (sent[0].fn !== "increment_page_view") {
    failures.push(`${path}: called ${sent[0].fn}, not increment_page_view`);
  }
  if (!SERVER_SLUG.test(sent[0].slug)) {
    failures.push(`${path}: slug ${sent[0].slug} would be REJECTED by the server`);
  }
}

for (const path of NOT_COUNTED) {
  checked++;
  const { sent } = run(path);
  if (sent.length !== 0) {
    failures.push(`${path}: must not be counted here, but sent ${sent[0].slug}`);
  }
}

// A second visit in the same session must read as already-seen and send nothing.
checked++;
{
  const store = new Map();
  run("/founders/", { store });
  const { sent } = run("/founders/", { store });
  if (sent.length !== 0) failures.push("second visit in one session sent a second increment");
}

// Private mode throws on BOTH getItem and setItem. The view must still count -
// a browser that refuses storage is still a visitor.
checked++;
{
  const { sent } = run("/founders/", { storageThrows: true });
  if (sent.length !== 1 || sent[0].slug !== "page-founders") {
    failures.push(`private mode: expected one page-founders increment, got ${JSON.stringify(sent)}`);
  }
}

// The counted list must not collide with the other two counters' namespaces.
checked++;
for (const [, slug] of COUNTED) {
  if (slug.startsWith("tool-") || slug === "tools-hub") {
    failures.push(`${slug} collides with the tool-page namespace`);
  }
}

if (checked === 0) {
  console.error("FAIL - examined nothing. A lookup that finds no cases must not read as a pass.");
  process.exit(2);
}

console.log(`paths and scenarios checked: ${checked}`);
console.log(`counted paths:              ${COUNTED.length}`);
console.log(`must-not-count paths:       ${NOT_COUNTED.length}`);

if (failures.length) {
  console.error(`\nFAIL - ${failures.length} problem(s):`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log("\nPASS - every counted path maps to a server-valid slug, and nothing else is counted.");
