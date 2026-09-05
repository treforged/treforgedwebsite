/**
 * Gate for the Forgenta CTA click counter.
 *
 * The blog's whole commercial job is to send readers to Forgenta, and until this
 * counter shipped nobody could tell whether a single reader had ever pressed the
 * CTA. A miscounted funnel is worse than none: it would make a dead CTA look
 * alive, or a live one look dead, and the next decision would be made on it.
 *
 * So this PRESSES THE BUTTON. It extracts the real listener out of main.js and
 * dispatches synthetic clicks at it, asserting which CTA name each anchor
 * resolves to and that a second click on the same CTA sends nothing. It reads the
 * shipped code rather than restating it, so if the block moves it FAILS rather
 * than passing on a stale copy.
 *
 *   node scripts/test-cta-clicks.mjs
 */

import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../main.js", import.meta.url), "utf8");

const start = SRC.indexOf("if (slugMatch) {");
if (start === -1) throw new Error("CTA click block not found in main.js (marker moved?)");
const end = SRC.indexOf("\n    }\n", start);
if (end === -1) throw new Error("could not find the end of the CTA click block in main.js");
const BLOCK = SRC.slice(start, end + "\n    }".length);

if (!BLOCK.includes("record_cta_click")) {
  throw new Error("extracted block does not call record_cta_click - wrong block");
}

// Builds a fresh sandbox per scenario: our document captures the listener, our
// sessionStorage is a plain object, our viewsRpc records what would be sent.
function mount({ slug = "car-loans-explained", storageThrows = false } = {}) {
  let listener = null;
  const sent = [];
  const store = new Map();

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

  const document = {
    addEventListener(type, fn) {
      if (type === "click") listener = fn;
    },
  };

  const viewsRpc = (fn, body) => {
    sent.push({ fn, ...body });
    return Promise.resolve(1);
  };

  const factory = new Function(
    "document",
    "sessionStorage",
    "viewsRpc",
    "slugMatch",
    `${BLOCK}\nreturn true;`,
  );
  factory(document, sessionStorage, viewsRpc, slug === null ? null : [`/blog/${slug}/`, slug]);

  return { listener, sent };
}

// A stand-in for a real anchor: only the two members the listener touches.
function anchor(href, classes = []) {
  return {
    getAttribute: (n) => (n === "href" ? href : null),
    classList: { contains: (c) => classes.includes(c) },
  };
}

function click(listener, a) {
  listener({ target: { closest: () => a } });
}

let failed = 0;
let ran = 0;
function check(label, actual, expected) {
  ran++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}` +
      (ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`),
  );
}

const APP = "https://getforgenta.com/?utm_source=blog&utm_medium=article&utm_campaign=car-loans-explained";
const PLAY = "https://play.google.com/store/apps/details?id=com.treforged.forged&referrer=x";
const BUILD = "https://getforgenta.com/builds/share/5311e587-27e4-44b9-8c16-d386775dd94d?utm_source=blog";

// --- classification: each CTA surface must be its own bucket -----------------
// If two surfaces collapse into one name, "which CTA works" stops being
// answerable, which is the entire reason this counter exists.
for (const [label, a, expected] of [
  ["header nav button      -> nav_app", anchor("https://getforgenta.com/", ["nav-app-btn"]), "nav_app"],
  ["Google Play button     -> article_play", anchor(PLAY, ["btn", "btn-ghost"]), "article_play"],
  ["C5 build link          -> article_build", anchor(BUILD, ["btn", "btn-gold"]), "article_build"],
  ["in-article app CTA     -> article_app", anchor(APP, ["btn", "btn-ghost"]), "article_app"],
  ["footer prose link      -> footer_link", anchor("https://getforgenta.com/", []), "footer_link"],
]) {
  const { listener, sent } = mount();
  click(listener, a);
  check(label, sent.map((s) => s.p_cta), [expected]);
}

// The nav button is on every page and also carries a bare getforgenta.com href,
// so without the class check first it would be counted as a footer link.
{
  const { listener, sent } = mount();
  click(listener, anchor("https://getforgenta.com/", ["nav-app-btn", "btn"]));
  check("nav button is not miscounted as article_app", sent.map((s) => s.p_cta), ["nav_app"]);
}

// --- the slug that is sent must be the post being read ----------------------
{
  const { listener, sent } = mount({ slug: "how-to-track-expenses" });
  click(listener, anchor(APP, ["btn"]));
  check("sends the post's own slug", sent, [
    { fn: "record_cta_click", p_slug: "how-to-track-expenses", p_cta: "article_app" },
  ]);
}

// --- what must NOT be counted ------------------------------------------------
{
  const { listener, sent } = mount();
  click(listener, anchor("/blog/how-to-track-expenses/", []));
  check("internal link sends nothing", sent, []);
}
{
  const { listener, sent } = mount();
  listener({ target: { closest: () => null } });
  check("click on non-anchor sends nothing", sent, []);
}
{
  const { listener } = mount({ slug: null });
  check("no listener attached off a blog post", listener, null);
}

// --- dedupe: one record per CTA per session ---------------------------------
// Views dedupe per visitor per 24h. If clicks did not, the ratio would be built
// from two different denominators and every funnel number would be inflated.
{
  const { listener, sent } = mount();
  const a = anchor(APP, ["btn"]);
  click(listener, a);
  click(listener, a);
  click(listener, a);
  check("three clicks on one CTA send one record", sent.length, 1);
}
{
  const { listener, sent } = mount();
  click(listener, anchor(APP, ["btn"]));
  click(listener, anchor("https://getforgenta.com/", ["nav-app-btn"]));
  check("different CTAs are counted separately", sent.map((s) => s.p_cta), ["article_app", "nav_app"]);
}
{
  // Private browsing throws on sessionStorage. Losing the reading there would
  // silently under-report every private-mode reader, so it sends anyway.
  const { listener, sent } = mount({ storageThrows: true });
  click(listener, anchor(APP, ["btn"]));
  check("private mode still sends", sent.length, 1);
}

// --- the CTA names must satisfy the server's own validator ------------------
// record_cta_click raises on anything outside this shape, so a name that fails
// here would be a click the database refuses at runtime.
{
  const { listener, sent } = mount();
  for (const a of [
    anchor("https://getforgenta.com/", ["nav-app-btn"]),
    anchor(PLAY, ["btn"]),
    anchor(BUILD, ["btn"]),
    anchor(APP, ["btn"]),
    anchor("https://getforgenta.com/", []),
  ]) click(listener, a);
  const bad = sent.map((s) => s.p_cta).filter((c) => !/^[a-z][a-z0-9_-]{0,31}$/.test(c));
  check("every CTA name passes the server's regex", bad, []);
}

console.log(`\n${ran} checks run, ${failed} failed.`);
if (ran === 0) {
  console.error("no checks ran - the gate would have passed on nothing");
  process.exit(1);
}
process.exit(failed ? 1 : 0);
