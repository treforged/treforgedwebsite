#!/usr/bin/env node
/**
 * Every FAQ question on a post exists TWICE: once as the <h3> a reader sees,
 * and once as a "name" inside the FAQPage JSON-LD that Google reads. Editing a
 * heading and forgetting its twin ships structured data that describes a
 * question the page does not contain - and nothing on the page looks wrong, so
 * only Search Console would ever have said so, weeks later.
 *
 * Seven posts had a heading rewritten on 2026-09-06 for keyword coverage. This
 * check was run by hand eight times that day, which is exactly the kind of
 * one-off that protects one commit and nothing after it.
 *
 * Exits non-zero when nothing was checked, so an empty run cannot read as a pass.
 *
 * Usage: node scripts/faq-sync.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const blogDir = join(root, 'blog');
let posts = 0;
let questions = 0;
let failed = 0;

function nodesOf(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && parsed['@graph']) return parsed['@graph'];
  return [parsed];
}

for (const slug of readdirSync(blogDir)) {
  const file = join(blogDir, slug, 'index.html');
  if (!existsSync(file)) continue;
  const html = readFileSync(file, 'utf8');

  const headings = [...html.matchAll(/<h3>([^<]*)<\/h3>/g)].map((m) => m[1].trim());

  for (const block of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let parsed;
    try {
      parsed = JSON.parse(block[1]);
    } catch (err) {
      failed += 1;
      console.log('FAIL ' + slug + '  ->  JSON-LD does not parse: ' + err.message);
      continue;
    }
    const faq = nodesOf(parsed).find((n) => n && n['@type'] === 'FAQPage');
    if (!faq || !Array.isArray(faq.mainEntity)) continue;

    posts += 1;
    const names = faq.mainEntity.map((q) => String(q.name || '').trim());
    questions += names.length;

    const orphans = names.filter((n) => !headings.includes(n));
    if (orphans.length) {
      failed += 1;
      console.log('FAIL ' + slug + '  ->  in the JSON-LD but not on the page: ' + orphans.join(' | '));
    } else {
      console.log('ok   ' + slug + '  (' + names.length + ' questions)');
    }
  }
}

console.log('');
if (posts === 0) {
  console.log('FAIL - no FAQ blocks were examined, which is not a pass.');
  process.exit(1);
}
console.log(posts + ' posts with an FAQ block, ' + questions + ' questions, ' + failed + ' out of sync.');
process.exit(failed === 0 ? 0 : 1);
