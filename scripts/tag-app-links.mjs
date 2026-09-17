/**
 * Every link from this site to getforgenta.com must carry UTM tags, or the
 * destination cannot tell where the visitor came from.
 *
 * WHY THE TAGS MUST BE PLAIN TOKENS: getforgenta validates each value at the
 * door against ^[a-z0-9][a-z0-9_-]{0,63}$ and DISCARDS anything else SILENTLY.
 * A malformed tag therefore does not fail - it makes the link LOOK attributed
 * while attributing nothing, which is worse than an honest zero. So this script
 * asserts every value it is about to write and refuses the whole run if one
 * fails, rather than writing 230 good links and one silent hole.
 *
 * THE CAMPAIGN KEY IS DELIBERATELY THE KEY ctaPageKey() PRODUCES in main.js.
 * Attribution and CTA clicks then join on one column instead of drifting into
 * two vocabularies.
 *
 *   node scripts/tag-app-links.mjs            gate: exit 1 if anything is untagged
 *   node scripts/tag-app-links.mjs --fix      rewrite
 *   node scripts/tag-app-links.mjs --limits   what this does NOT catch
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const SOURCE = 'treforged';
const BARE = 'https://getforgenta.com/';
// The anchor is matched WHOLE, because the medium comes from its class.
const ANCHOR = /<a\b[^>]*>/g;
const VALID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

// `git ls-files` with no glob: on Windows execSync goes through cmd.exe, which
// does not strip single quotes, so a quoted pattern matches literally nothing
// and the run reports a clean repo. Filter in JS instead.
function htmlFiles() {
  return execSync('git ls-files', { encoding: 'utf8' })
    .split('\n')
    .map(function (f) { return f.trim(); })
    .filter(function (f) { return f.endsWith('.html') && !f.startsWith('backups/'); });
}

export function pageKey(file) {
  if (file === 'index.html') return 'page-home';
  const blog = file.match(/^blog\/([a-z0-9-]+)\/index\.html$/);
  // An article keeps its BARE slug, exactly as ctaPageKey does, so the two
  // datasets share one denominator.
  if (blog) return blog[1];
  let raw = ('/' + file.replace(/index\.html$/, '').replace(/\.html$/, ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  raw = raw.replace(/^-+/, '').replace(/-+$/, '');
  if (!raw) return 'page-home';
  return ('page-' + raw).slice(0, 100).replace(/-+$/, '');
}

export function medium(classAttr) {
  if (/\bnav-app-btn\b/.test(classAttr)) return 'nav';
  if (/\bbtn\b/.test(classAttr)) return 'button';
  return 'link';
}

function retag(file, campaign, onMatch) {
  const html = readFileSync(file, 'utf8');
  // ONE pass with a replacer, never exec()-plus-splice: mutating the string
  // while a /g regex walks it shifts every later index by the length of the
  // edit, so the second link on a page lands in the wrong place.
  const out = html.replace(ANCHOR, function (tag) {
    const href = tag.match(/href="([^"]*)"/);
    if (!href || href[1] !== BARE) return tag;
    // indexOf(...) + 7 can never be -1, so an absent class must be detected on
    // the MATCH, not on the offset. The first draft of this script got that
    // wrong and handed every class-less anchor a garbage medium.
    const cls = tag.match(/class="([^"]*)"/);
    const q = 'utm_source=' + SOURCE +
              '&utm_medium=' + medium(cls ? cls[1] : '') +
              '&utm_campaign=' + campaign;
    onMatch();
    return tag.replace('href="' + BARE + '"', 'href="' + BARE + '?' + q + '"');
  });
  return { out: out, changed: out !== html };
}

function countBare(html) {
  let n = 0;
  html.replace(ANCHOR, function (tag) {
    const href = tag.match(/href="([^"]*)"/);
    if (href && href[1] === BARE) n++;
    return tag;
  });
  return n;
}

// A zero from a broken matcher and a zero from a clean repo are the same zero,
// so the instrument proves it can find the thing before its silence is trusted.
function controls() {
  const fails = [];
  if (countBare('<a href="' + BARE + '" class="nav-app-btn">x</a>') !== 1) {
    fails.push('positive control: a bare link was not matched');
  }
  if (countBare('<a href="' + BARE + '?utm_source=x">x</a>') !== 0) {
    fails.push('negative control: an already-tagged link was matched');
  }
  if (medium('') !== 'link') fails.push('a class-less anchor must be medium=link');
  if (medium('nav-app-btn') !== 'nav') fails.push('nav-app-btn must be medium=nav');
  if (medium('btn btn-ghost') !== 'button') fails.push('btn must be medium=button');
  if (pageKey('index.html') !== 'page-home') fails.push('root page key');
  if (pageKey('about/index.html') !== 'page-about') fails.push('section page key');
  if (pageKey('tools/debt-payoff-calculator/index.html') !== 'page-tools-debt-payoff-calculator') {
    fails.push('nested page key');
  }
  if (pageKey('blog/how-to-save/index.html') !== 'how-to-save') {
    fails.push('an article key must be the bare slug');
  }
  // Two links on one page: the second must be rewritten too. This is the index
  // drift the replacer exists to avoid, and nothing else in this file tests it.
  const two = '<a href="' + BARE + '">a</a><p>x</p><a href="' + BARE + '" class="btn">b</a>';
  let hits = 0;
  const res = (function () {
    return two.replace(ANCHOR, function (tag) {
      const href = tag.match(/href="([^"]*)"/);
      if (!href || href[1] !== BARE) return tag;
      hits++;
      return tag.replace('href="' + BARE + '"', 'href="' + BARE + '?q"');
    });
  })();
  if (hits !== 2 || countBare(res) !== 0) fails.push('two links on one page: both must be rewritten');
  return fails;
}

// Only run when executed directly. Without this, importing pageKey() to test it
// would run the whole gate as a side effect - and a test that cannot import the
// shipped function ends up asserting a COPY, which is free to drift from it.
const RUN_DIRECTLY = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

const argv = process.argv.slice(2);

if (RUN_DIRECTLY && argv.includes('--limits')) {
  console.log('tag-app-links --limits\n');
  console.log('This is a SOURCE check over the repo on disk. It does NOT catch:');
  console.log('  - what Cloudflare actually serves. The edge rewrites markup, so the');
  console.log('    deployed HTML is not the committed HTML and no source gate sees it.');
  console.log('  - links to getforgenta.com that are not exactly the bare root href,');
  console.log('    such as /builds/share/ links - publish-next.mjs tags those.');
  console.log('  - links built at runtime by JavaScript.');
  console.log('  - whether the DESTINATION stores what it is sent. Nothing reports on');
  console.log('    those columns yet, and attribution is not retrospective, so the');
  console.log('    first weeks read low for reasons that are not distribution.');
  console.log('  - whether the values are the RIGHT ones, only that they are valid');
  console.log('    tokens the destination will not silently discard.');
  process.exit(0);
}

if (RUN_DIRECTLY) {

// THE GENERATOR IS THE OTHER HALF, AND A SOURCE SCAN CANNOT SEE IT.
// Scanning committed HTML proves nothing about TOMORROW's post: the daily
// publish would ship an untagged page and this gate would only notice the day
// AFTER, once that page was already live. So the template is exercised here.
const generated = await (async () => {
  const mod = await import('./publish-next.mjs');
  const html = mod.renderArticle(
    { slug: 'gate-probe', title: 'T', description: 'd', date: '2026-01-01', body: '<p>x</p>', tags: [] },
    [],
  );
  const links = [...html.matchAll(/href="(https:\/\/getforgenta\.com[^"]*)"/g)].map((m) => m[1]);
  return { count: links.length, untagged: links.filter((l) => !l.includes('utm_source=')) };
})();
if (generated.count === 0) {
  console.error('CONTROL FAILED: the generator produced no app links at all, so this proves nothing.');
  process.exit(2);
}
// AND THE IN-PROSE HALF, which the probe above is structurally blind to: its
// fixture body is '<p>x</p>', so it contains no app link and the body-tagging
// branch is unreachable from it. A green there was never evidence about a link
// the article generator writes into the prose - and on 2026-09-17 a published
// post shipped exactly one such bare link.
const inProse = await (async () => {
  const mod = await import('./publish-next.mjs');
  if (typeof mod.tagBodyLinks !== 'function') return { broken: 'publish-next.mjs no longer exports tagBodyLinks' };
  const bare = '<p>see <a href="https://getforgenta.com/" rel="noopener">Forgenta</a></p>';
  const already = '<p><a href="https://getforgenta.com/?utm_source=treforged&utm_medium=link&utm_campaign=kept">F</a></p>';
  const out = mod.tagBodyLinks(bare, 'probe-slug');
  // POSITIVE CONTROL: the fixture must actually contain a bare link, or this
  // proves nothing - the same blindness as the renderArticle probe above.
  if (!bare.includes('getforgenta.com/"')) return { broken: 'the fixture carries no bare app link' };
  if (!out.includes('utm_campaign=probe-slug')) return { fail: 'a bare in-prose app link is NOT tagged at publish time' };
  if (mod.tagBodyLinks(already, 'probe-slug') !== already) return { fail: 'an already-tagged in-prose link was rewritten' };
  if (mod.tagBodyLinks(out, 'probe-slug') !== out) return { fail: 'tagging is not idempotent - a re-publish would double-tag' };
  return {};
})();
if (inProse.broken) {
  console.error('CONTROL FAILED: ' + inProse.broken + ' - refusing to report.');
  process.exit(2);
}
if (inProse.fail) {
  console.error('FAIL - ' + inProse.fail + '.');
  console.error('Every future post would ship an unattributable link. Fix tagBodyLinks in publish-next.mjs.');
  process.exit(1);
}

if (generated.untagged.length) {
  console.error('FAIL - publish-next.mjs would emit ' + generated.untagged.length + ' UNTAGGED app link(s):');
  for (const l of generated.untagged) console.error('  ' + l);
  console.error('\nThe next daily post would ship unattributed. Fix the template, not the output.');
  process.exit(1);
}

const fails = controls();
if (fails.length) {
  for (const f of fails) console.error('CONTROL FAILED: ' + f);
  console.error('\nThe instrument is broken, so its silence would mean nothing. Refusing to report.');
  process.exit(2);
}

const files = htmlFiles();
if (files.length === 0) {
  console.error('examined 0 files - the lookup is broken, which must never read as a clean repo.');
  process.exit(2);
}

const fix = argv.includes('--fix');
let untagged = 0;
let filesChanged = 0;
const offenders = [];
const keys = new Set();

for (const file of files) {
  const campaign = pageKey(file);
  if (!VALID.test(campaign)) {
    console.error('INVALID utm_campaign "' + campaign + '" derived from ' + file);
    console.error('The destination would discard it silently, so nothing is written.');
    process.exit(2);
  }
  keys.add(campaign);
  let n = 0;
  const result = retag(file, campaign, function () { n++; });
  if (n === 0) continue;
  untagged += n;
  offenders.push(n + '  ' + file);
  if (fix && result.changed) {
    writeFileSync(file, result.out, 'utf8');
    filesChanged++;
  }
}

console.log('files examined:         ' + files.length);
console.log('distinct campaign keys: ' + keys.size);

if (fix) {
  console.log('links tagged:           ' + untagged);
  console.log('files rewritten:        ' + filesChanged);
  process.exit(0);
}

console.log('untagged links:         ' + untagged);
if (untagged > 0) {
  console.log('');
  for (const o of offenders.slice(0, 12)) console.log('  ' + o);
  if (offenders.length > 12) console.log('  ... and ' + (offenders.length - 12) + ' more files');
  console.log('\nFAIL - run with --fix. An untagged link is a visit the destination cannot attribute.');
  process.exit(1);
}
console.log('\nPASS - every bare app link carries a valid UTM triple. Run --limits for what this cannot see.');
process.exit(0);

}
