#!/usr/bin/env node
/**
 * rebuild-derived.mjs — one-off maintenance: prune article(s) and rebuild
 * -------------------------------------------------------------
 * Removes the given slug(s) from content-queue/published.json, deletes their
 * /blog/<slug>/ directories, and regenerates the derived files that list all
 * articles (blog/index.html, sitemap.xml BLOG_URLS, homepage teaser) from the
 * pruned set — reusing the exact templates in publish-next.mjs.
 *
 * The pruned slugs remain in content-queue/topics.json, so the daily generator
 * treats them as unused again and regenerates them (now full-length).
 *
 * Usage:  node scripts/rebuild-derived.mjs <slug> [<slug> ...]
 */

import { readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  injectBetween,
  renderBlogIndex,
  renderTeaser,
  renderSitemapUrls,
} from './publish-next.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLISHED_PATH = join(ROOT, 'content-queue', 'published.json');

const prune = new Set(process.argv.slice(2));
if (!prune.size) {
  console.error('Usage: node scripts/rebuild-derived.mjs <slug> [<slug> ...]');
  process.exit(1);
}

const main = async () => {
  const published = JSON.parse(await readFile(PUBLISHED_PATH, 'utf8'));
  const kept = published.filter((a) => !prune.has(a.slug));
  const removed = published.filter((a) => prune.has(a.slug));

  if (!removed.length) {
    console.log('No matching articles in published.json — nothing to prune.');
    return;
  }

  // Delete each pruned article's page directory.
  for (const a of removed) {
    const dir = join(ROOT, 'blog', a.slug);
    if (existsSync(dir)) {
      await rm(dir, { recursive: true, force: true });
      console.log(`Deleted /blog/${a.slug}/`);
    }
  }

  // Persist the pruned published set.
  await writeFile(PUBLISHED_PATH, JSON.stringify(kept, null, 2) + '\n', 'utf8');

  // Rebuild the blog listing.
  await writeFile(join(ROOT, 'blog', 'index.html'), renderBlogIndex(kept), 'utf8');

  // Rebuild the homepage teaser (newest kept article).
  const homePath = join(ROOT, 'index.html');
  let home = await readFile(homePath, 'utf8');
  home = injectBetween(home, 'BLOG_TEASER', renderTeaser(kept[0]));
  await writeFile(homePath, home, 'utf8');

  // Rebuild the sitemap blog URLs.
  const sitemapPath = join(ROOT, 'sitemap.xml');
  let sitemap = await readFile(sitemapPath, 'utf8');
  sitemap = injectBetween(sitemap, 'BLOG_URLS', renderSitemapUrls(kept));
  await writeFile(sitemapPath, sitemap, 'utf8');

  console.log(
    `Pruned ${removed.map((a) => a.slug).join(', ')} → ${kept.length} articles remain. ` +
      `Derived files rebuilt.`,
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
