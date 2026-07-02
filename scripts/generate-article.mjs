#!/usr/bin/env node
/**
 * generate-article.mjs — TRE Forged blog article generator (Claude API)
 * -------------------------------------------------------------
 * Picks the next unused topic from content-queue/topics.json, asks Claude to
 * write a fresh, unique SEO article in the exact queue schema, and appends it
 * to content-queue/queue.json. The daily Action then publishes the oldest
 * queued item via publish-next.mjs.
 *
 * Zero dependencies — uses Node 20's global fetch. No SDK required.
 *
 * Requires: ANTHROPIC_API_KEY in the environment.
 * Optional: ARTICLE_MODEL (default "claude-sonnet-5").
 *
 * Never fails the build: on any error it prints an ::error:: notice and exits 0
 * so the publish step can still drain the existing queue.
 *
 * Usage:  node scripts/generate-article.mjs
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOPICS_PATH = join(ROOT, 'content-queue', 'topics.json');
const QUEUE_PATH = join(ROOT, 'content-queue', 'queue.json');
const PUBLISHED_PATH = join(ROOT, 'content-queue', 'published.json');

const MODEL = process.env.ARTICLE_MODEL || 'claude-sonnet-5';
const MAX_BUFFER = 10; // don't let the queue grow unbounded if publishing stalls
const APP_URL = 'https://getforgenta.com/';

const readJson = async (p, fallback) => {
  if (!existsSync(p)) return fallback;
  return JSON.parse(await readFile(p, 'utf8'));
};

const done = (msg) => {
  console.log(msg);
  process.exit(0);
};

const softFail = (msg) => {
  console.log(`::error::${msg}`);
  process.exit(0); // never break the daily job — publish step still runs
};

/* ── JSON schema for a guaranteed-parseable article ─────── */

const ARTICLE_SCHEMA = {
  type: 'object',
  properties: {
    slug: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    readMins: { type: 'integer' },
    promoteApp: { type: 'boolean' },
    bodyHtml: { type: 'string' },
    faqs: {
      type: 'array',
      items: {
        type: 'object',
        properties: { q: { type: 'string' }, a: { type: 'string' } },
        required: ['q', 'a'],
        additionalProperties: false,
      },
    },
  },
  required: ['slug', 'title', 'description', 'tags', 'readMins', 'promoteApp', 'bodyHtml', 'faqs'],
  additionalProperties: false,
};

const buildPrompt = (topic, recentTitles, mentionForgenta) => `You are writing one article for the TRE Forged blog (treforged.com), a personal finance blog by TRE Forged LLC. The blog exists to help everyday people with budgeting, saving, and paying off debt, and to introduce Forgenta, the company's personal finance app.

Write a complete, original, SEO-optimized article on this topic:
- Working title: "${topic.title}"
- Angle: ${topic.angle}
- Suggested URL slug: "${topic.slug}"

STRICT REQUIREMENTS:
- Audience: beginners and everyday people. Clear, warm, jargon-free, genuinely useful. No fluff, no filler intros.
- Length: 900-1400 words of real substance.
- Structure the body as clean semantic HTML using only these tags: <p>, <h2>, <h3>, <ul>, <li>, <ol>, <blockquote>, <strong>, <em>, <a>. Start directly with a <p> lead paragraph (do NOT include an <h1> or the title — the page template adds those). Use several <h2> sections.
- Do NOT use em dashes (—) anywhere. Use commas, periods, or "to"/"and" instead. Em dashes read as AI-generated.
- Use American English and 2026 as the current year where a year is relevant.
- Include a 2-4 item FAQ that answers real questions a reader would search for. These become FAQ rich-result schema, so make questions natural search queries.
- Internal linking: include at least one in-body link to a related blog article using a relative URL like <a href="/blog/some-slug/">anchor text</a>. Invent a plausible related slug from these known/likely posts if helpful: /blog/how-to-build-your-first-budget-2026/, /blog/50-30-20-budget-rule-explained/, /blog/how-to-build-an-emergency-fund/, /blog/debt-snowball-vs-avalanche/.
${mentionForgenta
  ? `- Forgenta: mention Forgenta naturally ONCE or TWICE in the body as a helpful tool where it genuinely fits (it connects bank accounts, auto-categorizes spending, budgets, sets savings goals, forecasts cash flow, and plans debt payoff). Link it as <a href="${APP_URL}" target="_blank" rel="noopener">Forgenta</a>. Do not oversell. Set "promoteApp": true.`
  : `- Do NOT mention Forgenta in the body of this article. Keep it purely educational. Set "promoteApp": false.`}

Avoid overlapping with these recently published titles: ${recentTitles.length ? recentTitles.join('; ') : '(none yet)'}.

Return ONLY the article as JSON matching the required schema:
- slug: url-friendly, lowercase, hyphenated (use the suggested slug unless a better one fits)
- title: a compelling, SEO-friendly headline (may differ from the working title)
- description: one meta-description sentence, roughly 150-160 characters
- tags: 2 short topic tags (e.g. ["Budgeting","Saving"])
- readMins: estimated reading time in minutes (integer)
- promoteApp: boolean per the Forgenta instruction above
- bodyHtml: the article body as the HTML described above
- faqs: array of {q, a}`;

const callClaude = async (apiKey, prompt) => {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: ARTICLE_SCHEMA },
      },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Claude API ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  if (data.stop_reason === 'refusal') {
    throw new Error('Claude declined the request (refusal).');
  }
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('No text block in Claude response.');
  return JSON.parse(textBlock.text);
};

const slugify = (s) =>
  String(s).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const main = async () => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) softFail('ANTHROPIC_API_KEY is not set — skipping generation.');

  const topics = await readJson(TOPICS_PATH, []);
  const queue = await readJson(QUEUE_PATH, []);
  const published = await readJson(PUBLISHED_PATH, []);

  if (queue.length >= MAX_BUFFER) {
    done(`::notice::Queue has ${queue.length} items (>= ${MAX_BUFFER}); skipping generation.`);
  }

  const usedSlugs = new Set([...queue, ...published].map((a) => a.slug));
  const topic = topics.find((t) => !usedSlugs.has(t.slug));
  if (!topic) {
    done('::notice::No unused topics left in topics.json — add more to keep generating.');
  }

  const recentTitles = published.slice(0, 8).map((a) => a.title);
  // Roughly 2 in 3 articles mention Forgenta, so promotion feels natural, not constant.
  const mentionForgenta = Math.random() < 0.66;

  let article;
  try {
    article = await callClaude(apiKey, buildPrompt(topic, recentTitles, mentionForgenta));
  } catch (err) {
    softFail(`Generation failed: ${err.message}`);
  }

  // Normalize + guard against slug collisions.
  article.slug = slugify(article.slug || topic.slug);
  if (usedSlugs.has(article.slug)) article.slug = slugify(topic.slug);
  if (usedSlugs.has(article.slug)) {
    done(`::notice::Generated slug "${article.slug}" already exists; skipping.`);
  }
  article.tags = Array.isArray(article.tags) ? article.tags.slice(0, 3) : ['Money Basics'];
  article.readMins = Number.isInteger(article.readMins) ? article.readMins : 6;
  article.promoteApp = article.promoteApp !== false;
  article.faqs = Array.isArray(article.faqs) ? article.faqs : [];

  queue.push(article);
  await writeFile(QUEUE_PATH, JSON.stringify(queue, null, 2) + '\n', 'utf8');

  console.log(`::notice::Generated "${article.title}" → queued as ${article.slug} (${MODEL}, promoteApp=${article.promoteApp}). Queue length: ${queue.length}.`);
};

main().catch((err) => softFail(err.message));
