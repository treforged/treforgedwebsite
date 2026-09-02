/**
 * One-off: rebuild ONLY the "Keep reading" card grid in every published post,
 * using the new topical pickRelated().
 *
 * Deliberately surgical. A full renderArticle() re-render would be simpler and
 * would DESTROY the retro-fitted FAQ entries, because those were inserted into
 * the HTML directly and never written back into published.json. The handoff
 * warned about full re-renders churning files; this is the sharper version of
 * that warning - they would also silently drop real content.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickRelated } from './publish-next.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const published = JSON.parse(await readFile(join(ROOT, 'content-queue/published.json'), 'utf8'));
const apply = process.argv.includes('--apply');
let changed = 0, skipped = 0, unchanged = 0;

for (const item of published) {
  const file = join(ROOT, 'blog', item.slug, 'index.html');
  if (!existsSync(file)) { console.log('SKIP no file:', item.slug); skipped++; continue; }
  const html = await readFile(file, 'utf8');

  const start = html.indexOf('<div class="grid-3">', html.indexOf('>Keep reading<'));
  if (start < 0) { console.log('SKIP no grid:', item.slug); skipped++; continue; }
  const end = html.indexOf('\n        </div>', start);
  if (end < 0) { console.log('SKIP no grid end:', item.slug); skipped++; continue; }

  const related = pickRelated(published, item);
  const cards = related.map((r) => `<a class="blog-card reveal" href="/blog/${r.slug}/">
            <div class="blog-card-tag">${esc((r.tags || [])[0] || 'Guide')}</div>
            <h4>${esc(r.title)}</h4>
            <p>${esc(r.description)}</p>
            <span class="blog-card-more">Read →</span>
          </a>`).join('\n          ');
  const block = `<div class="grid-3">\n          ${cards}`;

  if (html.slice(start, end) === block) { unchanged++; continue; }
  if (apply) await writeFile(file, html.slice(0, start) + block + html.slice(end), 'utf8');
  changed++;
}
console.log(`${apply ? 'APPLIED' : 'DRY RUN'}: ${changed} post(s) would change, ${unchanged} already correct, ${skipped} skipped`);
