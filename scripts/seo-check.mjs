#!/usr/bin/env node
/**
 * seo-check.mjs — the SEO gate for treforged.com.
 *
 * Every published post must be something Google can index and something a
 * social card can render. This asserts that, with numbers, and exits non-zero
 * when it is not true. Run it before committing anything that touches a post,
 * the post template in publish-next.mjs, or sitemap.xml.
 *
 * Usage: node scripts/seo-check.mjs
 */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://treforged.com';
const fail = [];
const note = (slug, msg) => fail.push(`${slug}: ${msg}`);

const entries = await readdir(join(ROOT, 'blog'), { withFileTypes: true });
const slugs = entries
  .filter((e) => e.isDirectory() && existsSync(join(ROOT, 'blog', e.name, 'index.html')))
  .map((e) => e.name)
  .sort();
const known = new Set(slugs);

let withDesc = 0, withCanonical = 0, withOgImage = 0, withLd = 0, linkTotal = 0;

for (const slug of slugs) {
  const html = await readFile(join(ROOT, 'blog', slug, 'index.html'), 'utf8');

  if (!/<title>[^<]+<\/title>/.test(html)) note(slug, 'no <title>');
  if (/name="description" content="[^"]+"/.test(html)) withDesc++; else note(slug, 'no meta description');

  const canonical = html.match(/rel="canonical" href="([^"]+)"/);
  if (canonical) {
    withCanonical++;
    const want = `${SITE}/blog/${slug}/`;
    if (canonical[1] !== want) note(slug, `canonical is ${canonical[1]}, expected ${want}`);
  } else note(slug, 'no canonical');

  // Social card: twitter:card promises a large image, so an image must exist.
  const og = html.match(/property="og:image" content="([^"]+)"/);
  if (og) {
    withOgImage++;
    const rel = og[1].replace(`${SITE}/`, '');
    if (!existsSync(join(ROOT, rel))) note(slug, `og:image missing on disk: ${rel}`);
  } else note(slug, 'no og:image (twitter:card is summary_large_image)');

  // Structured data must actually parse, or Google silently ignores all of it.
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!ld) note(slug, 'no JSON-LD');
  else {
    try {
      const parsed = JSON.parse(ld[1]);
      const types = (Array.isArray(parsed) ? parsed : [parsed]).map((n) => n['@type']);
      if (!types.includes('BlogPosting') && !types.includes('Article')) {
        note(slug, `JSON-LD has no BlogPosting/Article (got ${types.join(', ')})`);
      } else withLd++;
    } catch (e) {
      note(slug, `JSON-LD does not parse: ${e.message}`);
    }
  }

  // A link to a post that does not exist is a crawled soft-404.
  const links = [...html.matchAll(/href="\/blog\/([a-z0-9-]+)\//g)].map((m) => m[1]);
  const others = [...new Set(links)].filter((s) => s !== slug);
  linkTotal += others.length;
  for (const target of others) {
    if (!known.has(target)) note(slug, `links to non-existent post /blog/${target}/`);
  }
}

// The sitemap is what Google is told to crawl; drift makes posts invisible.
const sitemap = await readFile(join(ROOT, 'sitemap.xml'), 'utf8');
const inMap = new Set(
  [...sitemap.matchAll(/<loc>https:\/\/treforged\.com\/blog\/([a-z0-9-]+)\/<\/loc>/g)].map((m) => m[1]),
);
for (const slug of slugs) if (!inMap.has(slug)) note(slug, 'missing from sitemap.xml');
for (const slug of inMap) if (!known.has(slug)) note(slug, 'in sitemap.xml but not on disk');

console.log(`posts:              ${slugs.length}`);
console.log(`meta description:   ${withDesc}/${slugs.length}`);
console.log(`canonical:          ${withCanonical}/${slugs.length}`);
console.log(`og:image:           ${withOgImage}/${slugs.length}`);
console.log(`valid BlogPosting:  ${withLd}/${slugs.length}`);
console.log(`in sitemap.xml:     ${slugs.filter((s) => inMap.has(s)).length}/${slugs.length}`);
console.log(`internal post links: ${linkTotal} (avg ${(linkTotal / slugs.length).toFixed(1)}/post)`);

if (fail.length) {
  console.error(`\nFAIL — ${fail.length} problem(s):`);
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nPASS');
