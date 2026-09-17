/**
 * Gate for the founders-page source attribution.
 *
 * The `source` column is the RESULT of Ruby's two-arm reachability test: one arm
 * is Tre's brand account, the other is developer-native placements. If the two
 * arms collapse into one bucket, the experiment answers nothing — so this asserts
 * that each arm resolves to its own distinguishable value.
 *
 * It reads the real resolver out of main.js rather than restating it, so the
 * thing under test is the shipped code. If the markers move, it FAILS rather than
 * silently passing on a stale copy.
 *
 *   node scripts/test-source-attribution.mjs
 */

import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../main.js", import.meta.url), "utf8");

function extract(startMarker, endMarker, label) {
  const start = SRC.indexOf(startMarker);
  if (start === -1) throw new Error(`could not find ${label} in main.js (marker moved?)`);
  const end = SRC.indexOf(endMarker, start);
  if (end === -1) throw new Error(`could not find end of ${label} in main.js`);
  return SRC.slice(start, end + endMarker.length);
}

// Extraction is by MARKER, never by indentation. This block moved out of
// `if (wlForm)` on 2026-09-16 and shed two spaces of indent; the previous
// end anchor was an indented closing brace literal, so it stopped matching.
// failure was LOUD, which is the only reason it was safe - an anchor that
// merely matched something ELSE would have tested the wrong code silently.

const blockSrc = extract(
  "// ARRIVAL_SOURCE_BLOCK_START",
  "// ARRIVAL_SOURCE_BLOCK_END",
  "arrival source block",
);

// Positive control on the instrument itself: the lifted block must contain the
// two things the sandbox below depends on. A block that extracted the wrong
// region, or an empty one, would otherwise run zero assertions and look clean.
if (!blockSrc.includes("var IN_APP = [")) {
  throw new Error("extracted block has no IN_APP table - wrong region lifted");
}
if (!blockSrc.includes("var wlSource = function")) {
  throw new Error("extracted block has no wlSource resolver - wrong region lifted");
}

// Build the resolver in a sandbox where the browser globals it reads are ours.
function resolve({ search = "", ua = "", referrer = "", host = "treforged.com" }) {
  // See test-cta-clicks.mjs: this runs a block lifted verbatim out of main.js
  // against globals we supply, so the thing under test is the code the site
  // actually serves.
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    "navigator",
    "document",
    "location",
    "URLSearchParams",
    "URL",
    `${blockSrc}\nreturn wlSource;`,
  );
  const wlSource = factory(
    { userAgent: ua },
    { referrer },
    { search, hostname: host },
    URLSearchParams,
    URL,
  );
  return wlSource();
}

const IG_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
  "Instagram 335.0.0.32.95 (iPhone14,2; iOS 17_5; en_US)";
const TIKTOK_UA =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 musical_ly_2023 BytedanceWebview/d8a21c";
const FB_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) [FBAN/FBIOS;FBAV/451.0.0.35.108]";
const PLAIN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36";

const cases = [
  // A tagged placement names itself, and beats everything else.
  ["tagged arm wins over UA", { search: "?utm_source=hn", ua: IG_UA }, "hn"],
  ["tagged arm wins over referrer", { search: "?utm_source=devto", referrer: "https://dev.to/x" }, "devto"],

  // PAID CREATIVE. A small ad budget iterates on the creative, so the answer has
  // to name the creative and not just the platform.
  ["utm_content names the creative", { search: "?utm_source=ig_ads&utm_content=hook-a", ua: IG_UA }, "ig_ads/hook-a"],
  ["utm_campaign is the fallback variant", { search: "?utm_source=tt_ads&utm_campaign=sept", ua: TIKTOK_UA }, "tt_ads/sept"],
  ["utm_content beats utm_campaign", { search: "?utm_source=ig_ads&utm_campaign=sept&utm_content=hook-b" }, "ig_ads/hook-b"],
  ["an untagged ad still reports its platform", { search: "?utm_source=ig_ads", ua: IG_UA }, "ig_ads"],

  // THE BRAND ARM. Tre posted a bare URL and in-app browsers send no referrer,
  // so without the UA check this would be indistinguishable from a typed URL.
  ["instagram in-app is identified", { ua: IG_UA }, "ig-inapp"],
  ["tiktok in-app is identified", { ua: TIKTOK_UA }, "tiktok-inapp"],
  ["facebook in-app is identified", { ua: FB_UA }, "fb-inapp"],

  // THE DEVELOPER-NATIVE ARM, arriving as an ordinary link.
  ["hacker news referrer", { ua: PLAIN_UA, referrer: "https://news.ycombinator.com/item?id=1" }, "news.ycombinator.com"],
  ["github referrer", { ua: PLAIN_UA, referrer: "https://github.com/treforged" }, "github.com"],
  ["www is stripped", { ua: PLAIN_UA, referrer: "https://www.reddit.com/r/x" }, "reddit.com"],

  // THE LIVE BIO LINK, verbatim. Measured 2026-09-16 via the Instagram Graph
  // API, business_discovery.username(treforged), with the username and follower
  // count asserted as controls in the same request - business_discovery returns
  // nothing at all for a private or non-business account, which looks identical
  // to an empty bio if you only ask for the link. Query intact.
  //
  // CITED BY DATE AND METHOD, NOT BY NAME, AND THAT IS THE POINT. An earlier
  // version of this comment named the measurer, and it was written BEFORE the
  // measurement existed - at the time, that desk was on record saying this
  // account was unreadable from theirs. It became true half an hour later
  // because this comment sent them to look. A provenance line that happens to
  // come true is indistinguishable from one that never does, and a name plus a
  // date reads as a measurement and gets relayed as one.
  // Instagram has truncated bio links before and this time it did not. It is
  // asserted here so that a zero from utm_medium=bio can never be read as a
  // result before the instrument is proven able to return the positive.
  //
  // Note it resolves to `instagram/ig_treforged`, NOT bare `instagram`: there is
  // no utm_content, so utm_campaign becomes the variant. Any query grouping this
  // surface must split on `/` or it will report the bio arm as missing.
  [
    "the live @treforged bio link resolves, in-app UA and all",
    {
      search: "?utm_source=instagram&utm_medium=bio&utm_campaign=ig_treforged",
      ua: IG_UA,
    },
    "instagram/ig_treforged",
  ],
  // And the same visitor's SECOND page, where the query string is gone. THE
  // EXPECTED VALUE HERE WAS WRITTEN WRONG FIRST and the gate corrected it: I
  // assumed `on-site`, because the referrer is our own host. It is `ig-inapp`,
  // because the in-app UA check runs BEFORE the referrer check - so an in-app
  // visitor keeps being attributed to Instagram all the way through the visit.
  //
  // That is better than the assumption, and it still argues for sending once
  // per session: the CAMPAIGN is lost on page two (instagram/ig_treforged
  // becomes bare ig-inapp), so a per-page send would dilute the one bucket
  // that answers whether the bio link works.
  [
    "the bio visitor's second page keeps the platform but loses the campaign",
    { ua: IG_UA, referrer: "https://treforged.com/" },
    "ig-inapp",
  ],

  // Honest fallbacks. 'direct' must NOT absorb the brand arm.
  ["own site is not a source", { ua: PLAIN_UA, referrer: "https://treforged.com/blog/" }, "on-site"],
  ["nothing known says direct", { ua: PLAIN_UA }, "direct"],
];

let failed = 0;
for (const [name, input, expected] of cases) {
  const got = resolve(input);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ->  ${got}${ok ? "" : `  (expected ${expected})`}`);
}

// The whole point of the experiment: the two arms must not land on one value.
const brand = resolve({ ua: IG_UA });
const dev = resolve({ ua: PLAIN_UA, referrer: "https://news.ycombinator.com/x" });
const armsDistinct = brand !== dev && brand !== "direct" && dev !== "direct";
console.log(
  `${armsDistinct ? "PASS" : "FAIL"}  the two experiment arms are distinguishable  ->  brand=${brand} dev=${dev}`,
);
if (!armsDistinct) failed++;

// --- STRUCTURAL: the resolver must be reachable SITE-WIDE ------------------
// This is the half that has nothing to do with what the resolver RETURNS, and
// it is the half that was broken. Every case above passed for nine days while
// the resolver sat inside `if (wlForm)`, so the only page on the site that
// could reach it was /founders/. A resolver that returns the right answer on a
// page that never calls it is worth exactly nothing - the same shape as the CTA
// listener that was correct and blog-gated.
let structural = 0;
function must(label, cond) {
  structural++;
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
}

const iSource = SRC.indexOf('// ARRIVAL_SOURCE_BLOCK_START');
const iForm = SRC.indexOf("var wlForm = document.getElementById('waitlist-form')");
const iSend = SRC.indexOf('// ARRIVAL_SEND_BLOCK_START');

must('the source resolver is defined BEFORE the waitlist form block', iSource !== -1 && iForm !== -1 && iSource < iForm);
must('an arrival send block exists', iSend !== -1);
must('the arrival send calls record_arrival', SRC.slice(iSend).includes("viewsRpc('record_arrival'"));
must('the arrival send is OUTSIDE the waitlist form block', iSend !== -1 && iSend > iForm);
must('the arrival send passes the resolver, not a literal', SRC.slice(iSend, iSend + 1400).includes('p_source: wlSource()'));
must('the arrival is sent once per session, not once per page', SRC.slice(iSend, iSend + 1400).includes("sessionStorage.getItem('tf_arrival')"));

console.log(`\n${cases.length + 1 + structural} checks run, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
