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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOPICS_PATH = join(ROOT, 'content-queue', 'topics.json');
const QUEUE_PATH = join(ROOT, 'content-queue', 'queue.json');
const PUBLISHED_PATH = join(ROOT, 'content-queue', 'published.json');

const MODEL = process.env.ARTICLE_MODEL || 'claude-sonnet-5';
const MAX_BUFFER = 10; // don't let the queue grow unbounded if publishing stalls
export const MIN_WORDS = 850; // hard floor of body prose words — below this the article is rejected
const REFILL_THRESHOLD = 7; // when fewer unused topics than this remain...
const REFILL_COUNT = 28; // ...brainstorm this many fresh topics (~4 weeks)
const TARGET_BUFFER = 5; // fill the queue up to this depth each run, so a single rejection can't leave it empty
const MAX_FAILURES = 3; // give up after this many failed topics in one run — keeps API cost bounded on an outage
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

export const ARTICLE_SCHEMA = {
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

export const buildMaintenancePrompt = (topic, recentTitles) => `You are writing one article for The Forge, the TRE Forged blog (treforged.com). TRE Forged covers wealth AND car culture, so this piece is a practical do-it-yourself car maintenance guide for everyday car owners.

Write a complete, original how-to article on this topic:
- Working title: "${topic.title}"
- Angle: ${topic.angle}
- Suggested URL slug: "${topic.slug}"

STRICT REQUIREMENTS:
- Audience: regular car owners doing this themselves for the first time. Clear, encouraging, safety-conscious. No condescension, no filler.
- Length: this is a long-form how-to. The bodyHtml MUST contain at least 1000 words of actual body prose (HTML tags do not count toward the word total). Aim for 1100-1400 words. A thin or short guide is a failure even if it reads well, so do NOT wrap up early; explain each step fully with specific detail, real numbers, and what to watch out for.
- Structure the body as clean semantic HTML using only these tags: <p>, <h2>, <h3>, <ul>, <li>, <ol>, <blockquote>, <strong>, <em>, <a>. Start directly with a <p> lead paragraph (do NOT include an <h1> or the title). Write 5 to 7 <h2> sections; give each 2 to 3 substantial paragraphs of at least 3 sentences, plus lists where they genuinely help.
- Include these sections where they fit: a quick "what you'll need" tools & materials list, an estimated difficulty / time / rough cost, a numbered step-by-step, at least one clear safety warning (in a <blockquote> or <strong>), and a short "when to see a mechanic instead" note.
- END the body with a final <h2> section titled "Quick Recap" (or similar) containing a single <ol> that restates every step in one short line each, so a reader can follow the whole job at a glance.
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
- bodyHtml: the article body as the HTML described above, at least 1000 words of real prose across 5 to 7 <h2> sections
- faqs: array of {q, a}`;

export const buildPrompt = (topic, recentTitles, mentionForgenta) => `You are writing one article for the TRE Forged blog (treforged.com), a personal finance blog by TRE Forged LLC. The blog exists to help everyday people with budgeting, saving, and paying off debt, and to introduce Forgenta, the company's personal finance app.

Write a complete, original, SEO-optimized article on this topic:
- Working title: "${topic.title}"
- Angle: ${topic.angle}
- Suggested URL slug: "${topic.slug}"

STRICT REQUIREMENTS:
- Audience: beginners and everyday people. Clear, warm, jargon-free, genuinely useful. No fluff, no filler intros.
- Length: this is a long-form guide. The bodyHtml MUST contain at least 1000 words of actual body prose (HTML tags do not count toward the word total). Aim for 1100-1400 words. A thin or short article is a failure even if it reads well, so do NOT wrap up early or compress to save space; develop each point fully with concrete examples, specific numbers, and real scenarios.
- Structure the body as clean semantic HTML using only these tags: <p>, <h2>, <h3>, <ul>, <li>, <ol>, <blockquote>, <strong>, <em>, <a>. Start directly with a <p> lead paragraph (do NOT include an <h1> or the title — the page template adds those). Write 5 to 7 <h2> sections; give each section 2 to 3 substantial paragraphs of at least 3 sentences, plus lists where they genuinely help.
- Do NOT use em dashes (—) anywhere. Use commas, periods, or "to"/"and" instead. Em dashes read as AI-generated.
- If the article is built around a set of steps, ways, tips, or rules (e.g. "20 ways to...", "how to... in 5 steps"), END the body with a final <h2> section titled "Quick Recap" (or similar) containing a single <ol> that lists every step or item in one short line each, so a reader can act on the whole article at a glance.
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
- bodyHtml: the article body as the HTML described above, at least 1000 words of real prose across 5 to 7 <h2> sections
- faqs: array of {q, a}`;

export const callClaude = async (apiKey, prompt, schema, maxTokens = 28000) => {
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
        effort: 'high',
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
  // Guard against truncation: with adaptive thinking sharing the max_tokens
  // budget, a long article can exhaust the output cap. Structured output then
  // force-closes the JSON, yielding a parseable-but-cut-off article (body
  // ends mid-sentence, empty faqs). Truncation is not always reported as
  // "max_tokens" (pause_turn / model_context_window_exceeded slip through a
  // narrow check), so accept ONLY a clean end_turn.
  if (data.stop_reason !== 'end_turn') {
    const usage = data.usage ? ` (output_tokens=${data.usage.output_tokens})` : '';
    throw new Error(`stop_reason "${data.stop_reason}" != end_turn — output may be truncated; not queuing${usage}.`);
  }
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('No text block in Claude response.');
  return JSON.parse(textBlock.text);
};

/**
 * Returns a defect description if the article looks incomplete, else null.
 * Length/FAQ checks alone are not enough: the model can end the bodyHtml
 * string mid-sentence and still emit complete FAQs and a clean end_turn.
 */
export const articleDefect = (article) => {
  const body = String(article.bodyHtml || '').trim();
  const words = body
    .replace(/<[^>]+>/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  if (words < MIN_WORDS) return `only ${words} words of prose (min ${MIN_WORDS})`;
  if (!Array.isArray(article.faqs) || !article.faqs.length) return 'no FAQs — likely truncated';
  // Body must end on a closed block element, not a heading (a trailing
  // "<h2>FAQ</h2>" means the model stopped before writing the section).
  if (!/<\/(p|ul|ol|blockquote)>$/i.test(body)) return 'body does not end with a closed block element';
  // When the body ends in a paragraph, the final prose must end like a
  // sentence, not mid-thought. (List/blockquote endings are exempt — recap
  // list items legitimately omit terminal punctuation.)
  if (/<\/p>$/i.test(body)) {
    const prose = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!/[.!?:"”'’)\]]$/.test(prose)) return `body ends mid-sentence ("...${prose.slice(-60)}")`;
  }
  return null;
};

export const slugify = (s) =>
  String(s).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const proseWords = (html) =>
  String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;

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
    12000,
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

/**
 * Generate ONE publishable article for a topic. Returns the normalized article,
 * or throws with a reason (API error, slug collision, or completeness defect) so
 * the caller can move on and try a different topic instead of skipping the day.
 */
const generateArticle = async (apiKey, topic, published, usedSlugs) => {
  const recentTitles = published.slice(0, 8).map((a) => a.title);
  const isMaintenance = topic.category === 'car-maintenance';
  // Finance posts mention Forgenta ~2 in 3 times; DIY car posts never pitch it.
  const mentionForgenta = !isMaintenance && Math.random() < 0.66;
  const prompt = isMaintenance
    ? buildMaintenancePrompt(topic, recentTitles)
    : buildPrompt(topic, recentTitles, mentionForgenta);

  const article = await callClaude(apiKey, prompt, ARTICLE_SCHEMA);

  // Normalize + guard against slug collisions.
  article.slug = slugify(article.slug || topic.slug);
  if (usedSlugs.has(article.slug)) article.slug = slugify(topic.slug);
  if (usedSlugs.has(article.slug)) throw new Error(`generated slug "${article.slug}" already exists`);
  article.tags = Array.isArray(article.tags) ? article.tags.slice(0, 3) : ['Money Basics'];
  article.readMins = Number.isInteger(article.readMins) ? article.readMins : 6;
  article.promoteApp = article.promoteApp !== false;
  article.faqs = Array.isArray(article.faqs) ? article.faqs : [];

  // Completeness gate: reject short, truncated, or mid-sentence output.
  const defect = articleDefect(article);
  if (defect) throw new Error(defect);
  return article;
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

  // Fill the queue up to TARGET_BUFFER. A single rejected or failed topic no
  // longer skips the day: we move on to the NEXT topic (that IS the retry) and
  // keep a buffer so an empty queue can never silently drop a publish day.
  // Bounded by MAX_FAILURES so a systemic API outage can't burn the backlog.
  const triedThisRun = new Set();
  let failures = 0;
  let generated = 0;

  while (queue.length < TARGET_BUFFER && failures < MAX_FAILURES) {
    const topic = topics.find((t) => !usedSlugs.has(t.slug) && !triedThisRun.has(t.slug));
    if (!topic) {
      console.log('::notice::No more unused topics available this run.');
      break;
    }
    triedThisRun.add(topic.slug);

    try {
      const article = await generateArticle(apiKey, topic, published, usedSlugs);
      queue.push(article);
      usedSlugs.add(article.slug);
      // Persist after every success so a later failure never loses generated work.
      await writeFile(QUEUE_PATH, JSON.stringify(queue, null, 2) + '\n', 'utf8');
      generated++;
      console.log(`::notice::Generated "${article.title}" → queued as ${article.slug} (${MODEL}, ${proseWords(article.bodyHtml)} words, promoteApp=${article.promoteApp}). Queue length: ${queue.length}.`);
    } catch (err) {
      failures++;
      // Soft warning, not an error: generation must never break the build. The
      // topic stays unused so a future run can retry it.
      console.log(`::warning::Topic "${topic.slug}" skipped (${failures}/${MAX_FAILURES}): ${err.message} — trying another topic.`);
    }
  }

  if (failures >= MAX_FAILURES && queue.length < TARGET_BUFFER) {
    console.log(`::error::Generation stopped after ${MAX_FAILURES} failed topics; queue depth ${queue.length}/${TARGET_BUFFER}.`);
  }
  console.log(`::notice::Generation run complete — added ${generated} article(s); queue depth now ${queue.length}.`);
};

// Only run the daily generate flow when executed directly; when imported
// (e.g. by backfill-articles.mjs) only the exported helpers are used.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => softFail(err.message));
}
