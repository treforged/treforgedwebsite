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
const REFILL_THRESHOLD = 7; // when fewer unused topics than this remain...
const REFILL_COUNT = 28; // ...brainstorm this many fresh topics (~4 weeks)
const APP_URL = 'https://getforgenta.com/';

// DIY car-maintenance references (topics with category "car-maintenance").
// YOUR_PAGE is the brand page these articles point readers to.
const YOUR_PAGE = 'https://www.instagram.com/treforged/';
const YOUR_PAGE_LABEL = 'TRE Forged on Instagram (@treforged)';
const CARCAREKIOSK = 'https://www.carcarekiosk.com';

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

const buildMaintenancePrompt = (topic, recentTitles) => `You are writing one article for The Forge, the TRE Forged blog (treforged.com). TRE Forged covers wealth AND car culture, so this piece is a practical do-it-yourself car maintenance guide for everyday car owners.

Write a complete, original how-to article on this topic:
- Working title: "${topic.title}"
- Angle: ${topic.angle}
- Suggested URL slug: "${topic.slug}"

STRICT REQUIREMENTS:
- Audience: regular car owners doing this themselves for the first time. Clear, encouraging, safety-conscious. No condescension, no filler.
- Length: 900-1400 words of real, specific substance.
- Structure the body as clean semantic HTML using only these tags: <p>, <h2>, <h3>, <ul>, <li>, <ol>, <blockquote>, <strong>, <em>, <a>. Start directly with a <p> lead paragraph (do NOT include an <h1> or the title). Use several <h2> sections.
- Include these sections where they fit: a quick "what you'll need" tools & materials list, an estimated difficulty / time / rough cost, a numbered step-by-step, at least one clear safety warning (in a <blockquote> or <strong>), and a short "when to see a mechanic instead" note.
- Do NOT use em dashes (—) anywhere. Use commas, periods, or "to"/"and" instead.
- American English, 2026 as the current year where relevant. Generic to most cars; remind readers that exact steps and specs vary by year, make, and model.
- IMPORTANT resource references (include both, naturally in the body):
  - Point readers to <a href="${CARCAREKIOSK}" target="_blank" rel="noopener">CarCareKiosk</a> for free, model-specific step-by-step how-to videos (they can look up their exact year/make/model there).
  - Link once to the brand page as <a href="${YOUR_PAGE}" target="_blank" rel="noopener">${YOUR_PAGE_LABEL}</a> for more car content.
- Also include one internal link to a related money article using a relative URL, e.g. <a href="/blog/how-to-build-your-first-budget-2026/">budgeting basics</a>, since maintaining your own car saves money.
- Do NOT mention or pitch Forgenta in this article. Set "promoteApp": false.
- Include a 2-4 item FAQ answering real questions a searcher would type (e.g. "how often should I...", "can I do this myself...").

Avoid overlapping with these recently published titles: ${recentTitles.length ? recentTitles.join('; ') : '(none yet)'}.

Return ONLY the article as JSON matching the required schema:
- slug: url-friendly, lowercase, hyphenated (use the suggested slug unless a better one fits)
- title: a compelling, SEO-friendly how-to headline
- description: one meta-description sentence, roughly 150-160 characters
- tags: 2 short tags, e.g. ["Car Care","DIY"]
- readMins: estimated reading time in minutes (integer)
- promoteApp: false
- bodyHtml: the article body as the HTML described above
- faqs: array of {q, a}`;

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

const callClaude = async (apiKey, prompt, schema, maxTokens = 8000) => {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema },
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

/* ── topic backlog auto-refill ──────────────────────────── */

const TOPICS_SCHEMA = {
  type: 'object',
  properties: {
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          slug: { type: 'string' },
          title: { type: 'string' },
          angle: { type: 'string' },
          category: { type: 'string', enum: ['finance', 'car-maintenance'] },
        },
        required: ['slug', 'title', 'angle', 'category'],
        additionalProperties: false,
      },
    },
  },
  required: ['topics'],
  additionalProperties: false,
};

const buildTopicsPrompt = (count, existingSlugs, publishedTitles) => `You are refilling the editorial backlog for The Forge, the TRE Forged blog (treforged.com). The Forge covers personal finance AND car culture: budgeting and money skills, plus car buying, financing, ownership, and hands-on do-it-yourself maintenance.

Brainstorm ${count} fresh, specific, evergreen blog topic ideas that do NOT duplicate or lightly reword anything already covered.

Mix guidance:
- About 60% personal finance (budgeting, saving, debt, credit, cash flow, goals, insurance, everyday money skills) with "category": "finance".
- About 40% cars: some car-money topics (buying, financing, insurance, cost of ownership) with "category": "finance", and some hands-on DIY maintenance how-tos, ONE specific job per topic, with "category": "car-maintenance".
- Keep everything practical and beginner-friendly. Avoid investing-heavy or region-specific tax topics. Assume readers have already seen the absolute basics (what a budget is, 50/30/20), so bring fresh angles rather than re-teaching square one.

SEQUENCING (important): Return the topics as an ORDERED reading progression, because they will be published one per day in exactly the order you return them. Order the array so it flows naturally:
- Start lighter and more foundational, then build toward more advanced or situational topics.
- Interleave finance and car topics rather than grouping all of one type together, so the reader gets variety day to day.
- Arrange the DIY car-maintenance ("category": "car-maintenance") topics from easiest/quickest jobs to the more involved or safety-critical ones, and spread them through the list (not all at the end).
- Each topic should feel like a sensible next step after the previous one.

Do NOT reuse or reword any of these existing slugs:
${existingSlugs.join(', ')}

Do NOT overlap these already-published titles:
${publishedTitles.join('; ') || '(none yet)'}

For each topic return:
- slug: url-friendly, lowercase, hyphenated, unique, not in the existing list
- title: a compelling, specific, SEO-friendly headline
- angle: one sentence on what the article should cover
- category: "finance" or "car-maintenance" (use "car-maintenance" ONLY for hands-on DIY repair/maintenance how-tos)

Return ONLY JSON: {"topics": [ ... ${count} items, already in the intended publish order ... ]}`;

const refillTopics = async (apiKey, topics, usedSlugs, published) => {
  const existingSlugs = topics.map((t) => t.slug);
  const publishedTitles = published.map((a) => a.title);
  const result = await callClaude(
    apiKey,
    buildTopicsPrompt(REFILL_COUNT, existingSlugs, publishedTitles),
    TOPICS_SCHEMA,
    4000,
  );
  const raw = Array.isArray(result && result.topics) ? result.topics : [];
  const seen = new Set([...existingSlugs, ...usedSlugs]);
  const added = [];
  for (const t of raw) {
    if (!t || !t.slug || !t.title || !t.angle) continue;
    const slug = slugify(t.slug);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const topic = { slug, title: String(t.title), angle: String(t.angle) };
    // Keep file style consistent: only DIY posts carry an explicit category.
    if (t.category === 'car-maintenance') topic.category = 'car-maintenance';
    added.push(topic);
  }
  return added;
};

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
  let unused = topics.filter((t) => !usedSlugs.has(t.slug));

  // Auto-refill: when the backlog runs low, brainstorm a fresh batch so it never dries up.
  if (unused.length < REFILL_THRESHOLD) {
    try {
      const added = await refillTopics(apiKey, topics, usedSlugs, published);
      if (added.length) {
        topics.push(...added);
        await writeFile(TOPICS_PATH, JSON.stringify(topics, null, 2) + '\n', 'utf8');
        unused = topics.filter((t) => !usedSlugs.has(t.slug));
        console.log(`::notice::Auto-refilled backlog with ${added.length} new topics (now ${unused.length} unused).`);
      }
    } catch (err) {
      console.log(`::error::Topic refill failed: ${err.message}`);
    }
  }

  const topic = unused[0];
  if (!topic) {
    done('::notice::No unused topics left in topics.json — add more to keep generating.');
  }

  const recentTitles = published.slice(0, 8).map((a) => a.title);
  const isMaintenance = topic.category === 'car-maintenance';
  // Finance posts mention Forgenta ~2 in 3 times; DIY car posts never pitch it.
  const mentionForgenta = !isMaintenance && Math.random() < 0.66;
  const prompt = isMaintenance
    ? buildMaintenancePrompt(topic, recentTitles)
    : buildPrompt(topic, recentTitles, mentionForgenta);

  let article;
  try {
    article = await callClaude(apiKey, prompt, ARTICLE_SCHEMA);
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
