#!/usr/bin/env node
/**
 * publish-next.mjs — TRE Forged blog publisher
 * -------------------------------------------------------------
 * Publishes the NEXT queued article (content-queue/queue.json),
 * then regenerates everything that depends on the article set:
 *   - /blog/<slug>/index.html   (the article page, full SEO)
 *   - /blog/index.html          (the blog listing)
 *   - index.html                (homepage "latest article" teaser)
 *   - sitemap.xml               (blog URLs)
 *
 * No external dependencies. No API calls. Safe to run in CI.
 * Exit 0 when today's post already exists (nothing to do). Exit 1 (loud) when a
 * publish is due today but the queue is empty, so a skipped day is never silent.
 *
 * Usage:  node scripts/publish-next.mjs
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://treforged.com';
const APP = 'https://getforgenta.com/';
const BUILD = 'https://getforgenta.com/builds/share/5311e587-27e4-44b9-8c16-d386775dd94d';

/* UTM tag so we can attribute Forgenta signups back to the blog post. */
const utm = (slug) => `utm_source=blog&utm_medium=article&utm_campaign=${slug}`;
/* Posts tagged as automotive get the build-tracker CTA instead of the budgeting one. */
const CAR_RE = /car care|automotive|\bdiy\b|maintenance|tires?|wiper|windshield|engine|brake|wheel/i;
const isCarPost = (item) => (item.tags || []).some((t) => CAR_RE.test(t));

const QUEUE_PATH = join(ROOT, 'content-queue', 'queue.json');
const PUBLISHED_PATH = join(ROOT, 'content-queue', 'published.json');

/* ── helpers ─────────────────────────────────────────────── */

const readJson = async (p, fallback) => {
  if (!existsSync(p)) return fallback;
  return JSON.parse(await readFile(p, 'utf8'));
};

const esc = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const prettyDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['January','February','March','April','May','June','July',
    'August','September','October','November','December'];
  return `${months[m - 1]} ${d}, ${y}`;
};

/** Add n days to a YYYY-MM-DD date (UTC), returning YYYY-MM-DD. */
const addDays = (iso, n) => {
  const dt = new Date(`${iso}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};

/** Replace the region between START/END markers, keeping the markers. */
export const injectBetween = (source, name, replacement) => {
  const start = `<!-- ${name}:START -->`;
  const end = `<!-- ${name}:END -->`;
  const re = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (!re.test(source)) {
    throw new Error(`Marker ${name} not found in target file.`);
  }
  return source.replace(re, `${start}\n${replacement}\n${end}`);
};

/* ── shared page chrome (matches existing site template) ─── */

const nav = (active) => {
  const link = (href, label, key) =>
    `      <a href="${href}"${active === key ? ' class="active"' : ''}>${label}</a>`;
  const app = `      <a href="${APP}" target="_blank" rel="noopener" class="nav-app-btn">Launch App ↗</a>`;
  const items = [
    link('/', 'Home', 'home'),
    link('/blog/', 'Blog', 'blog'),
    link('/services/', 'Services', 'services'),
    link('/cars/', 'Cars', 'cars'),
    link('/partnerships/', 'Partnerships', 'partnerships'),
    link('/contact/', 'Contact', 'contact'),
    app,
  ].join('\n');
  return `<header class="site-header">
  <div class="container site-top">
    <a href="/" class="brand-link" aria-label="TRE Forged home">
      <picture>
        <source srcset="/assets/logo.webp" type="image/webp">
        <img src="/assets/logo.png" alt="TRE Forged logo" class="site-logo" width="200" height="200">
      </picture>
      <div class="brand-text">
        <h1>TRE Forged</h1>
        <div class="tagline">Wealth · Cars · Strategy</div>
      </div>
    </a>
    <nav class="primary" aria-label="Primary">
${items}
    </nav>
    <button id="burger" class="hamburger"
            aria-label="Open menu"
            aria-expanded="false"
            aria-controls="mobileNav">
      <span></span><span></span><span></span>
    </button>
  </div>
  <nav id="mobileNav" aria-label="Mobile navigation">
${items}
  </nav>
</header>`;
};

const footer = () => `<footer class="site-footer">
  <div class="container footer-inner">
    <div>
      <div class="footer-brand">TRE Forged</div>
      <div class="footer-copy">© 2026 TRE Forged LLC. All rights reserved.</div>
    </div>
    <div class="footer-right">Designed for collectors, investors &amp; enthusiasts.</div>
  </div>
</footer>`;

const head = ({ title, description, canonical, extra = '' }) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="icon" href="/favicon.ico" type="image/x-icon">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800;900&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,700&display=swap" onload="this.onload=null;this.rel='stylesheet'">
  <noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800;900&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,700&display=swap"></noscript>
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" type="application/rss+xml" title="The Forge — TRE Forged" href="${SITE}/feed.xml">
  <link rel="stylesheet" href="/styles.css">
${extra}</head>
<body>`;

/* ── CTA block reused inside every article ──────────────── */

const appCta = (slug) => `    <div class="app-block reveal">
      <div class="app-inner">
        <div>
          <div class="app-label">Android · iOS · Web</div>
          <h2>Put this into practice with Forgenta&#8482;</h2>
          <p>Forgenta is TRE Forged's personal finance app — build a budget, track every account, forecast your cash flow, and plan debt payoff from any device. Free to start.</p>
        </div>
        <div class="app-cta-stack">
          <a href="https://apps.apple.com/us/app/forgenta-track-build-wealth/id6762540239?ct=blog_${slug}" target="_blank" rel="noopener" class="btn btn-gold">App Store ↗</a>
          <a href="https://play.google.com/store/apps/details?id=com.treforged.forged&referrer=${encodeURIComponent(utm(slug))}" target="_blank" rel="noopener" class="btn btn-ghost">Google Play ↗</a>
          <a href="${APP}?${utm(slug)}" target="_blank" rel="noopener" class="btn btn-ghost">Try Forgenta Free ↗</a>
        </div>
      </div>
    </div>`;

/* Automotive posts: point at the C5 build + the build tracker, not budgeting. */
const buildCta = (slug) => `    <div class="app-block reveal">
      <div class="app-inner">
        <div>
          <div class="app-label">Build Tracker · Forgenta</div>
          <h2>Track your build's every dollar in Forgenta&#8482;</h2>
          <p>Forgenta lets you log a car build phase by phase — every mod, every part, every dollar — right next to your budget. See the C5 build in action, or start tracking your own.</p>
        </div>
        <div class="app-cta-stack">
          <a href="${BUILD}?${utm(slug)}" target="_blank" rel="noopener" class="btn btn-gold">View the C5 Build ↗</a>
          <a href="${APP}?${utm(slug)}" target="_blank" rel="noopener" class="btn btn-ghost">Track Your Own Build ↗</a>
        </div>
      </div>
    </div>`;

/* Choose the right CTA: build for car posts, app for finance, none if suppressed. */
const ctaFor = (item) =>
  isCarPost(item) ? buildCta(item.slug)
  : item.promoteApp === false ? ''
  : appCta(item.slug);

/* ── article page ───────────────────────────────────────── */

export const renderArticle = (item, related) => {
  const url = `${SITE}/blog/${item.slug}/`;
  const pubDate = item.published || item.date;
  const tags = item.tags || [];

  const faqJsonLd = (item.faqs && item.faqs.length)
    ? `,
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [${item.faqs.map((f) => `
      {"@type":"Question","name":${JSON.stringify(f.q)},"acceptedAnswer":{"@type":"Answer","text":${JSON.stringify(f.a)}}}`).join(',')}
    ]
  }`
    : '';

  const jsonLd = `  <script type="application/ld+json">
  [
  {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": ${JSON.stringify(item.title)},
    "description": ${JSON.stringify(item.description)},
    "datePublished": "${pubDate}",
    "dateModified": "${pubDate}",
    "author": {"@type":"Organization","name":"TRE Forged","url":"${SITE}/"},
    "publisher": {"@type":"Organization","name":"TRE Forged","logo":{"@type":"ImageObject","url":"${SITE}/assets/logo.png"}},
    "image": {"@type":"ImageObject","url":"${SITE}/assets/og-default.png","width":1200,"height":630},
    "mainEntityOfPage": {"@type":"WebPage","@id":"${url}"},
    "url": "${url}",
    "keywords": ${JSON.stringify(tags.join(', '))}
  },
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      {"@type":"ListItem","position":1,"name":"Home","item":"${SITE}/"},
      {"@type":"ListItem","position":2,"name":"Blog","item":"${SITE}/blog/"},
      {"@type":"ListItem","position":3,"name":${JSON.stringify(item.title)},"item":"${url}"}
    ]
  }${faqJsonLd}
  ]
  </script>`;

  const ogTwitter = `  <meta property="og:type" content="article">
  <meta property="og:title" content="${esc(item.title)}">
  <meta property="og:description" content="${esc(item.description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:site_name" content="TRE Forged">
  <meta property="og:image" content="${SITE}/assets/og-default.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${esc(item.title)}">
  <meta property="article:published_time" content="${pubDate}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(item.title)}">
  <meta name="twitter:description" content="${esc(item.description)}">
  <meta name="twitter:image" content="${SITE}/assets/og-default.png">
`;

  const faqSection = (item.faqs && item.faqs.length)
    ? `
      <div class="block reveal">
        <div class="block-title">FAQ</div>
        <h2>Common questions</h2>
        ${item.faqs.map((f) => `<div class="faq-item">
          <h3>${esc(f.q)}</h3>
          <p>${esc(f.a)}</p>
        </div>`).join('\n        ')}
      </div>`
    : '';

  const relatedSection = related.length
    ? `
      <div class="block reveal">
        <div class="block-title">Keep reading</div>
        <h2>More from the blog</h2>
        <div class="grid-3">
          ${related.map((r) => `<a class="blog-card reveal" href="/blog/${r.slug}/">
            <div class="blog-card-tag">${esc((r.tags || [])[0] || 'Guide')}</div>
            <h4>${esc(r.title)}</h4>
            <p>${esc(r.description)}</p>
            <span class="blog-card-more">Read →</span>
          </a>`).join('\n          ')}
        </div>
      </div>`
    : '';

  return `${head({ title: `${item.title} — TRE Forged`, description: item.description, canonical: url, extra: ogTwitter + jsonLd + '\n' })}
${nav('blog')}
<main class="page-main">
  <div class="container">
    <article class="article">
      <nav class="crumbs" aria-label="Breadcrumb">
        <a href="/">Home</a> <span>/</span> <a href="/blog/">Blog</a> <span>/</span> <span>${esc(item.title)}</span>
      </nav>
      <header class="article-head reveal">
        <div class="article-tags">${tags.map((t) => `<span class="pill">${esc(t)}</span>`).join('')}</div>
        <h1>${esc(item.title)}</h1>
        <p class="article-lead">${esc(item.description)}</p>
        <div class="article-meta">
          <time datetime="${pubDate}">${prettyDate(pubDate)}</time>
          <span>·</span>
          <span>${item.readMins || 6} min read</span>
          <span>·</span>
          <span>TRE Forged</span>
        </div>
      </header>

      <div class="article-body reveal">
${item.bodyHtml}
      </div>
    </article>

${ctaFor(item)}
${faqSection}
${relatedSection}
  </div>
</main>
${footer()}
<script src="/main.js"></script>
</body>
</html>
`;
};

/* ── blog index (listing) ───────────────────────────────── */

export const renderBlogIndex = (published) => {
  const cards = published.length
    ? published.map((p, i) => `      <a class="blog-card reveal${i === 0 ? ' blog-card-feature' : ''}" href="/blog/${p.slug}/">
        <div class="blog-card-tag">${esc((p.tags || [])[0] || 'Guide')}</div>
        <h3>${esc(p.title)}</h3>
        <p>${esc(p.description)}</p>
        <div class="blog-card-foot">
          <time datetime="${p.published || p.date}">${prettyDate(p.published || p.date)}</time>
          <span class="blog-card-more">Read more →</span>
        </div>
      </a>`).join('\n')
    : '      <p class="lead">New articles are on the way. Check back soon.</p>';

  return `${head({
    title: 'The Forge: Money Basics & Budgeting Guides | TRE Forged',
    description: 'Practical, jargon-free personal finance guides from TRE Forged: budgeting, saving, debt payoff, and getting the most out of the Forgenta app.',
    canonical: `${SITE}/blog/`,
    extra: `  <meta property="og:type" content="website">
  <meta property="og:title" content="The Forge: Personal Finance Guides by TRE Forged">
  <meta property="og:description" content="Practical, jargon-free personal finance guides: budgeting, saving, and debt payoff.">
  <meta property="og:url" content="${SITE}/blog/">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Blog",
    "name": "The Forge",
    "url": "${SITE}/blog/",
    "description": "Practical personal finance guides: budgeting, saving, and debt payoff.",
    "publisher": {"@type":"Organization","name":"TRE Forged","url":"${SITE}/"}
  }
  </script>
`,
  })}
${nav('blog')}
<main class="page-main">
  <div class="container">
    <section class="page-hero reveal">
      <div class="page-hero-label">Money Basics</div>
      <h2>The Forge</h2>
      <p>Practical, jargon-free guides on budgeting, saving, and paying down debt, plus tips for getting the most out of <a href="${APP}" target="_blank" rel="noopener">Forgenta</a>, our personal finance app.</p>
    </section>

    <div class="blog-grid">
${cards}
    </div>

    <div class="newsletter reveal">
      <div class="newsletter-inner">
        <div class="newsletter-copy">
          <div class="block-title">The Forge Newsletter</div>
          <h2>Never miss a guide.</h2>
          <p>New money guides, C5 build updates, and Forgenta tips — straight to your inbox. No spam, unsubscribe anytime.</p>
        </div>
        <form class="newsletter-form" id="newsletter-form" novalidate>
          <div class="newsletter-fields">
            <input type="email" id="newsletter-email" name="email" placeholder="you@example.com" autocomplete="email" required aria-label="Your email address">
            <button type="submit" class="btn btn-gold">Subscribe →</button>
          </div>
          <input type="text" class="nl-hp" name="company" tabindex="-1" autocomplete="off" aria-hidden="true">
          <p class="newsletter-msg" id="newsletter-msg" role="status" aria-live="polite"></p>
        </form>
      </div>
    </div>
  </div>
</main>
${footer()}
<script src="/main.js"></script>
</body>
</html>
`;
};

/* ── homepage teaser (injected between markers) ─────────── */

export const renderTeaser = (latest) => {
  if (!latest) return '    <!-- no articles yet -->';
  return `    <div class="block reveal blog-teaser">
      <div class="block-title">From the Blog</div>
      <h2>${esc(latest.title)}</h2>
      <p class="lead">${esc(latest.description)}</p>
      <div class="blog-teaser-foot">
        <time datetime="${latest.published || latest.date}">${prettyDate(latest.published || latest.date)} · ${latest.readMins || 6} min read</time>
        <a href="/blog/${latest.slug}/" class="btn btn-primary">Read more →</a>
      </div>
      <div style="margin-top:14px"><a href="/blog/">Browse all articles →</a></div>
    </div>`;
};

/* ── sitemap urls (injected between markers) ────────────── */

export const renderSitemapUrls = (published) => {
  const blogIndex = `  <url>
    <loc>${SITE}/blog/</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>`;
  const articles = published.map((p) => `  <url>
    <loc>${SITE}/blog/${p.slug}/</loc>
    <lastmod>${p.published || p.date}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`).join('\n');
  return published.length ? `${blogIndex}\n${articles}` : blogIndex;
};

/* ── RSS feed ───────────────────────────────────────────────
   Free, ESP-agnostic. A free email tool (MailerLite / Kit / Brevo) points its
   RSS-to-email automation at ${SITE}/feed.xml to auto-send new posts — no code
   or ongoing cost. Also useful for readers and discovery. */

export const renderRssFeed = (published) => {
  const rfc822 = (d) => new Date(`${d}T12:00:00Z`).toUTCString();
  const items = published.slice(0, 20).map((p) => {
    const url = `${SITE}/blog/${p.slug}/`;
    return `    <item>
      <title>${esc(p.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${rfc822(p.published || p.date)}</pubDate>
      <description>${esc(p.description)}</description>
    </item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>The Forge — TRE Forged</title>
    <link>${SITE}/blog/</link>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>
    <description>Practical, jargon-free personal finance guides from TRE Forged: budgeting, saving, debt payoff, and getting the most out of Forgenta.</description>
    <language>en-us</language>
    <lastBuildDate>${published.length ? rfc822(published[0].published || published[0].date) : new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
};

/* ── main ───────────────────────────────────────────────── */

const main = async () => {
  const queue = await readJson(QUEUE_PATH, []);
  const published = await readJson(PUBLISHED_PATH, []);

  // Determine today's state FIRST. Order matters: an empty queue must only be
  // treated as "nothing to do" when today's post already exists — otherwise an
  // empty queue means a publish day WOULD be skipped, and that must fail loudly.
  const today = new Date().toISOString().slice(0, 10);
  const latest = published.reduce((m, a) => {
    const d = String(a.published || a.date || '');
    return d > m ? d : m;
  }, '');

  // One post per calendar day: if an article is already dated today (or later,
  // e.g. a backfill/re-date), there is nothing to do — exit 0 and resume tomorrow.
  if (latest >= today) {
    console.log(`::notice::An article is already published for ${latest} — skipping today's publish.`);
    return;
  }

  // Days that still need a post: from the day after `latest` up to and
  // including today. Normally that's just [today]. But GitHub's scheduled cron
  // is best-effort and can DROP a run entirely — when that happens the next
  // run finds several missing days. Catch up by publishing one queued article
  // per missing day (oldest first) instead of only ever posting "today" and
  // leaving the skipped day a permanent hole.
  const missingDates = [];
  let cursor = latest ? addDays(latest, 1) : today;
  while (cursor <= today) {
    missingDates.push(cursor);
    cursor = addDays(cursor, 1);
  }

  // A publish IS due but the queue is empty → day(s) would be skipped.
  // Fail loudly (exit 1 → workflow goes red) instead of silently exiting 0.
  // This is the guard that would have caught the 2026-07-21 skip.
  if (!queue.length) {
    const span = missingDates.length > 1 ? `${missingDates[0]}..${today} (${missingDates.length} days)` : today;
    console.log(`::error::Article queue is empty but no post exists for ${span} — publish day(s) would be skipped. Failing loudly so this is noticed. Fix: run generate-article.mjs (needs ANTHROPIC_API_KEY) or backfill.`);
    process.exit(1);
  }

  // Publish one article per missing day, oldest first, until we reach today or
  // run out of queued articles. The buffer generate-article keeps is what makes
  // multi-day catch-up possible within a single run.
  const publishedNow = [];
  for (const date of missingDates) {
    if (!queue.length) break;
    const item = queue.shift();
    item.published = item.date || date;
    // newest-first: ascending dates mean the last unshift (today) stays at index 0.
    published.unshift(item);

    // The generator is told to link a related post and sometimes invents a
    // plausible-but-nonexistent slug (2 of the first 37 posts did). A link to
    // a post that does not exist is a soft-404 Google crawls, so any unknown
    // target is demoted to the blog index rather than shipped dead.
    const knownSlugs = new Set(published.map((p) => p.slug));
    if (item.bodyHtml) {
      item.bodyHtml = item.bodyHtml.replace(
        /href="\/blog\/([a-z0-9-]+)\/"/g,
        (match, target) => {
          if (knownSlugs.has(target)) return match;
          console.log(`::warning::${item.slug}: link to unknown post /blog/${target}/ rewritten to /blog/`);
          return 'href="/blog/"';
        },
      );
    }

    const related = published.filter((p) => p.slug !== item.slug).slice(0, 3);
    const dir = join(ROOT, 'blog', item.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), renderArticle(item, related), 'utf8');
    publishedNow.push(item);
  }

  // Rebuild every derived file ONCE from the final published set.
  await writeFile(join(ROOT, 'blog', 'index.html'), renderBlogIndex(published), 'utf8');

  const homePath = join(ROOT, 'index.html');
  let home = await readFile(homePath, 'utf8');
  home = injectBetween(home, 'BLOG_TEASER', renderTeaser(published[0]));
  await writeFile(homePath, home, 'utf8');

  const sitemapPath = join(ROOT, 'sitemap.xml');
  let sitemap = await readFile(sitemapPath, 'utf8');
  sitemap = injectBetween(sitemap, 'BLOG_URLS', renderSitemapUrls(published));
  await writeFile(sitemapPath, sitemap, 'utf8');

  // RSS feed (drives the free RSS-to-email newsletter digest)
  await writeFile(join(ROOT, 'feed.xml'), renderRssFeed(published), 'utf8');

  // persist queue + published (before any loud exit, so progress is saved)
  await writeFile(QUEUE_PATH, JSON.stringify(queue, null, 2) + '\n', 'utf8');
  await writeFile(PUBLISHED_PATH, JSON.stringify(published, null, 2) + '\n', 'utf8');

  const filled = publishedNow.map((p) => p.published).join(', ');
  console.log(`::notice::Published ${publishedNow.length} article(s) for ${filled} (${queue.length} left in queue).`);

  // If the queue ran dry before covering every missing day, the earlier gap is
  // still open. Fail loudly so it gets backfilled rather than lingering silently.
  const remaining = missingDates.length - publishedNow.length;
  if (remaining > 0) {
    console.log(`::error::${remaining} missing day(s) up to ${today} still have NO post — the queue ran dry mid-catch-up. Backfill (scripts/backfill-articles.mjs) or add topics and let generation refill the buffer.`);
    process.exit(1);
  }
};

// Only auto-publish when run directly (e.g. `node scripts/publish-next.mjs`).
// When imported (e.g. by a rebuild script) the render helpers above are reused
// without triggering a publish.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
