#!/usr/bin/env node
/**
 * backfill-articles.mjs — one-off: regenerate pruned articles and republish
 * -------------------------------------------------------------
 * For each `slug=YYYY-MM-DD` argument (date optional; defaults to today),
 * looks the slug up in content-queue/topics.json, generates a full-length
 * article with the same prompts and truncation guards as the daily
 * generator, and publishes it directly with the given date — restoring
 * posts that were pruned for truncation onto their original calendar slots.
 *
 * Rebuilds the blog index, homepage teaser, and sitemap once at the end.
 * Fails hard (exit 1) if any article can't be generated after 3 attempts,
 * so a partial backfill is never silently committed as complete — articles
 * generated before the failure ARE written and can be committed.
 *
 * Requires: ANTHROPIC_API_KEY in the environment.
 *
 * Usage:  node scripts/backfill-articles.mjs zero-based-budgeting-guide=2026-07-07 ...
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  ARTICLE_SCHEMA,
  MIN_WORDS,
  buildMaintenancePrompt,
  buildPrompt,
  callClaude,
  slugify,
} from './generate-article.mjs';
import {
  injectBetween,
  renderArticle,
  renderBlogIndex,
  renderTeaser,
  renderSitemapUrls,
} from './publish-next.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOPICS_PATH = join(ROOT, 'content-queue', 'topics.json');
const PUBLISHED_PATH = join(ROOT, 'content-queue', 'published.json');

const ATTEMPTS = 3;

const args = process.argv.slice(2);
if (!args.length) {
  console.error('Usage: node scripts/backfill-articles.mjs <slug>[=YYYY-MM-DD] ...');
  process.exit(1);
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is not set.');
  process.exit(1);
}

const proseWords = (html) =>
  String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;

const generateOne = async (topic, recentTitles) => {
  const isMaintenance = topic.category === 'car-maintenance';
  const mentionForgenta = !isMaintenance && Math.random() < 0.66;
  const prompt = isMaintenance
    ? buildMaintenancePrompt(topic, recentTitles)
    : buildPrompt(topic, recentTitles, mentionForgenta);

  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const article = await callClaude(apiKey, prompt, ARTICLE_SCHEMA);
      const words = proseWords(article.bodyHtml);
      const faqs = Array.isArray(article.faqs) ? article.faqs : [];
      if (words < MIN_WORDS) throw new Error(`only ${words} words of prose (min ${MIN_WORDS})`);
      if (!faqs.length) throw new Error('no FAQs — likely truncated');

      article.slug = topic.slug; // keep the original slug so URLs are restored
      article.tags = Array.isArray(article.tags) ? article.tags.slice(0, 3) : ['Money Basics'];
      article.readMins = Number.isInteger(article.readMins) ? article.readMins : 6;
      article.promoteApp = article.promoteApp !== false;
      article.faqs = faqs;
      console.log(`  ✓ generated "${article.title}" (${words} words, ${faqs.length} FAQs, attempt ${attempt})`);
      return article;
    } catch (err) {
      lastError = err;
      console.log(`  ✗ attempt ${attempt}/${ATTEMPTS} failed: ${err.message}`);
    }
  }
  throw new Error(`Failed to generate "${topic.slug}" after ${ATTEMPTS} attempts: ${lastError.message}`);
};

const main = async () => {
  const topics = JSON.parse(await readFile(TOPICS_PATH, 'utf8'));
  const published = JSON.parse(await readFile(PUBLISHED_PATH, 'utf8'));
  const today = new Date().toISOString().slice(0, 10);

  const jobs = args.map((arg) => {
    const [slugRaw, date] = arg.split('=');
    const slug = slugify(slugRaw);
    const topic = topics.find((t) => t.slug === slug);
    if (!topic) throw new Error(`Slug "${slug}" not found in topics.json`);
    if (published.some((a) => a.slug === slug)) throw new Error(`"${slug}" is already published`);
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Bad date "${date}" for ${slug}`);
    return { topic, date: date || today };
  });

  for (const job of jobs) {
    console.log(`Generating ${job.topic.slug} (publish date ${job.date})...`);
    const recentTitles = published.slice(0, 8).map((a) => a.title);
    const article = await generateOne(job.topic, recentTitles);
    article.published = job.date;
    published.push(article);

    // Keep the listing newest-first by publish date.
    published.sort((a, b) => String(b.published || b.date).localeCompare(String(a.published || a.date)));

    // Write the article page.
    const related = published.filter((p) => p.slug !== article.slug).slice(0, 3);
    const dir = join(ROOT, 'blog', article.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), renderArticle(article, related), 'utf8');

    // Persist after each article so a later failure loses nothing.
    await writeFile(PUBLISHED_PATH, JSON.stringify(published, null, 2) + '\n', 'utf8');
  }

  // Rebuild the derived files once from the final set.
  await writeFile(join(ROOT, 'blog', 'index.html'), renderBlogIndex(published), 'utf8');

  const homePath = join(ROOT, 'index.html');
  await writeFile(homePath, injectBetween(await readFile(homePath, 'utf8'), 'BLOG_TEASER', renderTeaser(published[0])), 'utf8');

  const sitemapPath = join(ROOT, 'sitemap.xml');
  await writeFile(sitemapPath, injectBetween(await readFile(sitemapPath, 'utf8'), 'BLOG_URLS', renderSitemapUrls(published)), 'utf8');

  console.log(`Backfilled ${jobs.length} article(s). Published total: ${published.length}.`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
