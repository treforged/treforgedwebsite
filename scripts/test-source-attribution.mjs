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

const inAppSrc = extract("var IN_APP = [", "];", "IN_APP table");
const resolverSrc = extract("var wlSource = function () {", "\n      };", "wlSource resolver");

// Build the resolver in a sandbox where the browser globals it reads are ours.
function resolve({ search = "", ua = "", referrer = "", host = "treforged.com" }) {
  const factory = new Function(
    "navigator",
    "document",
    "location",
    "URLSearchParams",
    "URL",
    `${inAppSrc}\n${resolverSrc}\nreturn wlSource;`,
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

  // THE BRAND ARM. Tre posted a bare URL and in-app browsers send no referrer,
  // so without the UA check this would be indistinguishable from a typed URL.
  ["instagram in-app is identified", { ua: IG_UA }, "ig-inapp"],
  ["tiktok in-app is identified", { ua: TIKTOK_UA }, "tiktok-inapp"],
  ["facebook in-app is identified", { ua: FB_UA }, "fb-inapp"],

  // THE DEVELOPER-NATIVE ARM, arriving as an ordinary link.
  ["hacker news referrer", { ua: PLAIN_UA, referrer: "https://news.ycombinator.com/item?id=1" }, "news.ycombinator.com"],
  ["github referrer", { ua: PLAIN_UA, referrer: "https://github.com/treforged" }, "github.com"],
  ["www is stripped", { ua: PLAIN_UA, referrer: "https://www.reddit.com/r/x" }, "reddit.com"],

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

console.log(`\n${cases.length + 1} checks run, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
