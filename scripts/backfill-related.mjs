#!/usr/bin/env node
/**
 * backfill-related.mjs — rebuild the "Keep reading" card grid in every
 * published post, and make sure no post is left with nothing linking to it.
 *
 * WHY THIS RUNS EVERY DAY, not just once:
 * publish-next.mjs renders the NEW post only. Existing posts are never
 * re-rendered, so a post published today is linked by nobody, forever, and
 * receives none of the site's internal authority. That is a permanent orphan
 * factory, and it is why 57 of 63 posts had zero inbound in-body links before
 * 2026-09-02. Running this after each publish closes the loop.
 *
 * WHY IT IS SURGICAL:
 * it replaces ONLY the card grid. A full renderArticle() re-render would be
 * simpler and would destroy the retro-fitted FAQ entries, which live in the
 * HTML and were never written back to published.json.
 *
 * Usage:  node scripts/backfill-related.mjs [--apply]
 *         (without --apply it is a dry run and writes nothing)
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickRelated, relatedScore, pairHash } from './publish-next.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const apply = process.argv.includes('--apply');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const published = JSON.parse(await readFile(join(ROOT, 'content-queue/published.json'), 'utf8'));
const onDisk = published.filter((p) => existsSync(join(ROOT, 'blog', p.slug, 'index.html')));
const bySlug = new Map(onDisk.map((p) => [p.slug, p]));

// 1. Topical pick for every post.
const chosen = new Map(onDisk.map((item) => [item.slug, pickRelated(onDisk, item).map((r) => r.slug)]));

// 2. Orphan rescue. A post nothing links to gets none of the site's internal
//    authority, and Google reaches it only via the sitemap. Rather than force a
//    link from an arbitrary post, the orphan is placed with its MOST RELATED
//    host, displacing that host's weakest card - and only when displacing it
//    does not orphan the card being dropped. Relevance is preserved; coverage
//    is guaranteed. If a host cannot be found without creating a new orphan,
//    the orphan is reported rather than forced.
const inboundOf = (sets) => {
  const c = new Map(onDisk.map((p) => [p.slug, 0]));
  for (const [, targets] of sets) for (const t of targets) if (c.has(t)) c.set(t, c.get(t) + 1);
  return c;
};

let rescued = 0;
for (let pass = 0; pass < 10; pass++) {
  const inbound = inboundOf(chosen);
  const orphans = [...inbound].filter(([, n]) => n === 0).map(([s]) => s);
  if (!orphans.length) break;
  let progressed = false;

  for (const orphan of orphans) {
    const hosts = onDisk
      .filter((p) => p.slug !== orphan && !chosen.get(p.slug).includes(orphan))
      .map((p) => ({ slug: p.slug, score: relatedScore(bySlug.get(orphan), p), h: pairHash(orphan, p.slug) }))
      .sort((a, b) => b.score - a.score || a.h - b.h);

    for (const host of hosts) {
      const set = chosen.get(host.slug);
      // Drop the host's least related card, but never one that would become an
      // orphan itself. Recompute inbound each time so the check stays honest.
      const live = inboundOf(chosen);
      const droppable = [...set]
        .map((s) => ({ s, score: relatedScore(bySlug.get(host.slug), bySlug.get(s)), inb: live.get(s) || 0 }))
        .filter((x) => x.inb > 1)
        .sort((a, b) => a.score - b.score || a.inb - b.inb);
      if (!droppable.length) continue;
      chosen.set(host.slug, set.map((s) => (s === droppable[0].s ? orphan : s)));
      rescued++;
      progressed = true;
      break;
    }
  }
  if (!progressed) break;
}

// 3. Write the grids.
let changed = 0, unchanged = 0, skipped = 0;
for (const item of onDisk) {
  const file = join(ROOT, 'blog', item.slug, 'index.html');
  const html = await readFile(file, 'utf8');
  const start = html.indexOf('<div class="grid-3">', html.indexOf('>Keep reading<'));
  if (start < 0) { console.log('SKIP no grid:', item.slug); skipped++; continue; }
  const end = html.indexOf('\n        </div>', start);
  if (end < 0) { console.log('SKIP no grid end:', item.slug); skipped++; continue; }

  const cards = chosen.get(item.slug).map((slug) => {
    const r = bySlug.get(slug);
    return `<a class="blog-card reveal" href="/blog/${r.slug}/">
            <div class="blog-card-tag">${esc((r.tags || [])[0] || 'Guide')}</div>
            <h4>${esc(r.title)}</h4>
            <p>${esc(r.description)}</p>
            <span class="blog-card-more">Read →</span>
          </a>`;
  }).join('\n          ');
  const block = `<div class="grid-3">\n          ${cards}`;

  if (html.slice(start, end) === block) { unchanged++; continue; }
  if (apply) await writeFile(file, html.slice(0, start) + block + html.slice(end), 'utf8');
  changed++;
}

const finalOrphans = [...inboundOf(chosen)].filter(([, n]) => n === 0).map(([s]) => s);
console.log(`${apply ? 'APPLIED' : 'DRY RUN'}: ${changed} changed, ${unchanged} already correct, ${skipped} skipped`);
console.log(`orphan rescues: ${rescued} | remaining orphans: ${finalOrphans.length}${finalOrphans.length ? ' (' + finalOrphans.join(', ') + ')' : ''}`);
