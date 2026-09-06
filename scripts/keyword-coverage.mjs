import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseKeywordTargets, keywordsForSlug } from './generate-article.mjs';

// Helper to normalize text for searching
const normalize = (text) =>
  text
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

// Decode the five HTML entities required
const decodeEntities = (str) =>
  str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

// Strip <script>…</script> and <style>…</style> blocks
const stripScriptsAndStyles = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

// Remove remaining HTML tags
const stripTags = (html) => html.replace(/<\/?[^>]+>/g, '');

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..', '..'); // repository root

const keywordPath = join(__dirname, 'content-queue', 'keyword-targets.md');
const blogRoot = join(__dirname, 'blog');

(async () => {
  // Verify blog/ exists
  try {
    const blogStat = await stat(blogRoot);
    if (!blogStat.isDirectory()) throw new Error();
  } catch {
    console.error('Missing blog/ directory');
    process.exit(1);
  }

  // Load and parse keyword targets
  let keywordMap;
  try {
    const kwContent = await readFile(keywordPath, 'utf8');
    keywordMap = parseKeywordTargets(kwContent);
  } catch {
    console.error('Missing or unreadable content-queue/keyword-targets.md');
    process.exit(1);
  }

  if (!(keywordMap instanceof Map) || keywordMap.size === 0) {
    console.error('Keyword targets file parsed to an empty map');
    process.exit(1);
  }

  // Discover slugs (directories with index.html)
  const entries = await readdir(blogRoot, { withFileTypes: true });
  const slugs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const idxPath = join(blogRoot, entry.name, 'index.html');
    try {
      const s = await stat(idxPath);
      if (s.isFile()) slugs.push(entry.name);
    } catch {
      // no index.html – ignore
    }
  }

  if (slugs.length === 0) {
    console.error('No blog posts found');
    process.exit(1);
  }

  const results = [];

  for (const slug of slugs) {
    const phrases = keywordsForSlug(keywordMap, slug);
    if (!Array.isArray(phrases) || phrases.length === 0) continue; // no targets

    const htmlPath = join(blogRoot, slug, 'index.html');
    let html;
    try {
      html = await readFile(htmlPath, 'utf8');
    } catch {
      console.error(`Unable to read ${htmlPath}`);
      process.exit(1);
    }

    const searchable = normalize(
      decodeEntities(
        stripTags(
          stripScriptsAndStyles(html)
        )
      )
    );

    let hits = 0;
    for (const rawPhrase of phrases) {
      const phraseNorm = normalize(rawPhrase);
      if (searchable.includes(phraseNorm)) hits++;
    }

    results.push({ slug, total: phrases.length, hits, phrases });
  }

  const postsWithTargets = results.length;
  if (postsWithTargets === 0) {
    console.error('No posts with target phrases were found');
    process.exit(1);
  }

  const missPosts = results.filter(r => r.hits === 0);
  const okPosts = results.filter(r => r.hits > 0);

  // Output MISS lines
  for (const r of missPosts) {
    console.log(`MISS  ${r.slug}  (0 of ${r.total})`);
  }
  // Output ok lines
  for (const r of okPosts) {
    console.log(`ok    ${r.slug}  (${r.hits} of ${r.total})`);
  }

  console.log('');
  console.log(`${postsWithTargets} posts have targets, ${missPosts.length} contain none of them.`);

  if (missPosts.length > 0) {
    const topMisses = missPosts
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);

    console.log('Biggest opportunities:');
    for (const r of topMisses) {
      const toShow = r.phrases.slice(0, 3);
      for (const phrase of toShow) {
        console.log(`  ${r.slug}: ${phrase}`);
      }
    }
  }

  // Default is a REPORT: misses are the finding, not an error. Pass
  // --max-misses=N to turn it into a gate, the same shape as
  // cache-check.mjs's --min-cached. Coverage reached 0 misses on 2026-09-06,
  // so --max-misses=0 is what stops that quietly sliding back.
  const arg = process.argv.find((a) => a.startsWith('--max-misses='));
  if (arg) {
    const limit = Number(arg.slice('--max-misses='.length));
    if (!Number.isFinite(limit) || limit < 0) {
      console.error('--max-misses needs a number that is zero or more');
      process.exit(1);
    }
    if (missPosts.length > limit) {
      console.error(`FAIL - ${missPosts.length} posts contain none of their target phrases, limit is ${limit}.`);
      process.exit(1);
    }
    console.log(`PASS - ${missPosts.length} misses, limit ${limit}.`);
  }

  process.exit(0);
})();
