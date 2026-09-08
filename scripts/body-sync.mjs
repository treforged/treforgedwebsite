#!/usr/bin/env node
/**
 * body-sync.mjs - the rendered post and its source of truth must agree.
 *
 * content-queue/published.json holds each post's bodyHtml, and publish-next.mjs
 * renders the page FROM it. So a hand-edit made to blog/<slug>/index.html and
 * not mirrored into bodyHtml is not a change - it is a change with a fuse on it.
 * The next re-render silently reverts it, with no error anywhere and no way to
 * tell afterwards that it ever happened.
 *
 * That had happened to SIX posts before this existed, and the edits were real
 * ones: accuracy rewrites and keyword retro-fits, each a paragraph of somebody's
 * deliberate work sitting one render away from deletion. It surfaced only
 * because a script refused to append to a post whose page did not match its
 * body - the invariant caught it, nothing else would have.
 *
 * The check is EQUALITY of the extracted body, not containment.
 *
 * Containment was the first version and it was wrong in a way that only showed
 * up when it was pointed at real work. `page.includes(bodyHtml)` is satisfied
 * whenever the page has extra content APPENDED - the old body is still a prefix
 * - so a paragraph added to a page and not to published.json passed cleanly.
 * That is exactly the edit this gate exists to catch, and five of them sailed
 * through it while it printed PASS.
 *
 * Extracting the body between its markers and comparing it exactly catches both
 * directions: text changed, and text added. Anything looser still - normalising
 * whitespace, comparing lengths, sampling sentences - goes back to passing on
 * the small wording drift that matters here.
 *
 * --fix adopts the PAGE as truth, which is the right direction: the page is what
 * a reader has been served and what someone deliberately edited. It refuses to
 * touch a page whose body markers it cannot find rather than guess.
 *
 * Usage:
 *   node scripts/body-sync.mjs          report, non-zero if any post has drifted
 *   node scripts/body-sync.mjs --fix    copy the page's body back into published.json
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(ROOT, 'content-queue', 'published.json');
const FIX = process.argv.includes('--fix');

const OPEN = '<div class="article-body reveal">\n';
const CLOSE = '\n      </div>\n    </article>';

const pub = JSON.parse(readFileSync(PUB, 'utf8'));
const posts = Array.isArray(pub) ? pub : pub.published;

let examined = 0;
let drifted = 0;
let fixed = 0;
const unfixable = [];

for (const post of posts) {
  const file = join(ROOT, 'blog', post.slug, 'index.html');
  if (!existsSync(file)) continue;
  examined++;
  const page = readFileSync(file, 'utf8');

  const a = page.indexOf(OPEN);
  const b = page.indexOf(CLOSE, a);
  if (a === -1 || b === -1) {
    // Cannot locate the body at all: report it rather than silently skipping,
    // because an unparseable page is not a page that agrees.
    drifted++;
    if (FIX) unfixable.push(`${post.slug}: could not find the article-body markers`);
    else console.log(`DRIFT ${post.slug} - could not find the article-body markers to compare`);
    continue;
  }
  const body = page.slice(a + OPEN.length, b);

  if (body === post.bodyHtml) continue;

  drifted++;
  if (!FIX) {
    const extra = body.startsWith(post.bodyHtml)
      ? ` (the page has ${body.length - post.bodyHtml.length} extra chars appended)`
      : '';
    console.log(`DRIFT ${post.slug} - the page's body differs from published.json${extra}; a re-render would revert the page`);
    continue;
  }
  post.bodyHtml = body;
  console.log(`fixed ${post.slug}`);
  fixed++;
}

// A run that examined nothing must fail rather than report a clean repo.
if (examined === 0) {
  console.error('no posts examined - published.json and blog/ do not line up, so nothing was actually checked');
  process.exit(2);
}

console.log(`\nposts examined: ${examined}`);

if (FIX) {
  if (unfixable.length) {
    console.error('could not fix:');
    unfixable.forEach((u) => console.error('  ' + u));
    process.exit(1);
  }
  if (fixed > 0) writeFileSync(PUB, JSON.stringify(pub, null, 2) + '\n', 'utf8');
  console.log(`${fixed} post(s) synced from the page.`);
  process.exit(0);
}

if (drifted > 0) {
  console.error(`\nFAIL - ${drifted} post(s) have drifted from published.json.`);
  console.error('Their page edits are one re-render from being silently reverted.');
  console.error('run: node scripts/body-sync.mjs --fix');
  process.exit(1);
}
console.log('PASS - every rendered post matches its bodyHtml.');
process.exit(0);
