#!/usr/bin/env node
/**
 * generator-prompt.test.mjs — asserts the article prompt actually carries the
 * two things it was changed to carry: real harvested search phrases, and ONLY
 * slugs of posts that exist. Both failures ship silently otherwise: the first
 * as a post nobody searches for, the second as the soft-404s that survived 37
 * posts before anything checked.
 *
 * Usage: node scripts/generator-prompt.test.mjs
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseKeywordTargets, keywordsForSlug, keywordBlock, slugList,
  buildPrompt, buildMaintenancePrompt,
} from './generate-article.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (name, cond) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
  if (!cond) failed++;
};

const md = await readFile(join(ROOT, 'content-queue', 'keyword-targets.md'), 'utf8');
const map = parseKeywordTargets(md);
check(`parses keyword groups (${map.size} found)`, map.size >= 30);

const phrases = keywordsForSlug(map, 'debt-snowball-vs-avalanche');
check('finds phrases for an exact slug', phrases.length > 0);
check('phrase looks like a real query', phrases.some((p) => p.includes('snowball')));

// Slugs on disk carry suffixes the harvest headings do not, e.g. -in-2026.
check('tolerates a slug suffix', keywordsForSlug(map, 'envelope-budgeting-in-2026').length > 0);
check('unknown slug returns empty, not a crash', keywordsForSlug(map, 'no-such-topic-xyz').length === 0);
check('empty map is safe', keywordsForSlug(new Map(), 'anything').length === 0);

check('keywordBlock is empty when there are no phrases', keywordBlock([]) === '');
check('keywordBlock lists phrases', keywordBlock(['how to budget']).includes('how to budget'));
check('keywordBlock caps at 10', keywordBlock(Array.from({ length: 30 }, (_, i) => `p${i}`)).split('\n  - ').length - 1 === 10);

check('slugList renders real slugs', slugList(['a-post']).includes('/blog/a-post/'));
check('slugList handles the empty case', slugList([]).includes('skip internal linking'));

const topic = { slug: 'debt-snowball-vs-avalanche', title: 'Snowball vs Avalanche', angle: 'compare' };
const real = ['how-to-build-an-emergency-fund', 'how-to-track-expenses'];
const prompt = buildPrompt(topic, ['Older Post'], true, phrases, real);

check('prompt carries a harvested phrase', prompt.includes(phrases[0]));
check('prompt lists only real slugs', prompt.includes('/blog/how-to-build-an-emergency-fund/'));
check('prompt FORBIDS inventing a slug', /NEVER invent a slug/.test(prompt));
check('the old invent-a-slug instruction is gone', !/Invent a plausible related slug/i.test(prompt));

const car = buildMaintenancePrompt({ slug: 'how-to-change-your-own-oil', title: 'Oil', angle: 'diy' }, [], phrases, real);
check('maintenance prompt also forbids invented slugs', /NEVER invent a slug/.test(car));
check('maintenance prompt lists real slugs', car.includes('/blog/how-to-track-expenses/'));

// Untargeted must still produce a usable prompt: a day with no post is worse.
const bare = buildPrompt(topic, [], false);
check('prompt still builds with no keywords and no slugs', bare.length > 500 && bare.includes('skip internal linking'));

console.log(failed ? `\n${failed} check(s) FAILED` : '\nPASS');
process.exit(failed ? 1 : 0);
