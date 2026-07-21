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
 * Exit 0 with a notice when the queue is empty (never fails the build).
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
  <meta property="article:published_time" content="${pubDate}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(item.title)}">
  <meta name="twitter:description" content="${esc(item.description)}">
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

/* ── main ───────────────────────────────────────────────── */

const main = async () => {
  const queue = await readJson(QUEUE_PATH, []);
  const published = await readJson(PUBLISHED_PATH, []);

  if (!queue.length) {
    console.log('::notice::Article queue is empty — nothing to publish today.');
    return;
  }

  // One post per calendar day: if an article is already dated today (or
  // later, e.g. a backfill/re-date), skip this run and resume tomorrow.
  const today = new Date().toISOString().slice(0, 10);
  const latest = published.reduce((m, a) => {
    const d = String(a.published || a.date || '');
    return d > m ? d : m;
  }, '');
  if (latest >= today) {
    console.log(`::notice::An article is already published for ${latest} — skipping today's publish.`);
    return;
  }

  const item = queue.shift();
  item.published = item.date || today;

  // newest first
  published.unshift(item);

  // article page
  const related = published.filter((p) => p.slug !== item.slug).slice(0, 3);
  const dir = join(ROOT, 'blog', item.slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.html'), renderArticle(item, related), 'utf8');

  // blog listing
  await writeFile(join(ROOT, 'blog', 'index.html'), renderBlogIndex(published), 'utf8');

  // homepage teaser
  const homePath = join(ROOT, 'index.html');
  let home = await readFile(homePath, 'utf8');
  home = injectBetween(home, 'BLOG_TEASER', renderTeaser(published[0]));
  await writeFile(homePath, home, 'utf8');

  // sitemap
  const sitemapPath = join(ROOT, 'sitemap.xml');
  let sitemap = await readFile(sitemapPath, 'utf8');
  sitemap = injectBetween(sitemap, 'BLOG_URLS', renderSitemapUrls(published));
  await writeFile(sitemapPath, sitemap, 'utf8');

  // persist queue + published
  await writeFile(QUEUE_PATH, JSON.stringify(queue, null, 2) + '\n', 'utf8');
  await writeFile(PUBLISHED_PATH, JSON.stringify(published, null, 2) + '\n', 'utf8');

  console.log(`::notice::Published "${item.title}" → /blog/${item.slug}/ (${queue.length} left in queue)`);
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
