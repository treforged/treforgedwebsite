# Blog content queue

This folder drives the TRE Forged blog. A daily GitHub Action
(`.github/workflows/daily-article.yml`) publishes **one queued article per day**,
then regenerates the blog index, the homepage teaser, and the sitemap — all for
free (no API calls, just GitHub's included Actions minutes).

## Files

- **`queue.json`** — Pending articles, published oldest-first (top of the array
  goes out next). Add new articles here.
- **`published.json`** — Articles already live. Generated automatically; don't
  edit by hand.

## How publishing works

Each day the Action runs `node scripts/publish-next.mjs`, which:

1. Takes the first article out of `queue.json`.
2. Writes `blog/<slug>/index.html` with full SEO (meta tags, Open Graph,
   `BlogPosting` + `BreadcrumbList` + `FAQPage` JSON-LD).
3. Rebuilds `blog/index.html` (the listing).
4. Updates the homepage "From the Blog" teaser (between the
   `BLOG_TEASER:START/END` markers in `index.html`).
5. Adds the article to `sitemap.xml` (between the `BLOG_URLS:START/END` markers).
6. Moves the article into `published.json` and commits everything.

When the queue is empty, the Action does nothing and succeeds quietly.

## Adding a new article

Append an object to the array in `queue.json`:

```json
{
  "slug": "url-friendly-slug",
  "title": "The Article Title",
  "description": "150–160 char meta description used for SEO and the teaser.",
  "date": "2026-07-05",
  "tags": ["Budgeting", "Beginners"],
  "readMins": 6,
  "bodyHtml": "<p>Article body as HTML. Use h2/h3/p/ul/li/blockquote/strong/em/a.</p>",
  "faqs": [
    { "q": "A question?", "a": "A clear answer (also emitted as FAQ schema)." }
  ]
}
```

Guidelines that keep the SEO strong:

- **`slug`** — lowercase, hyphens, keyword-rich, no spaces.
- **`description`** — one compelling sentence, ~150–160 characters.
- **`bodyHtml`** — lead paragraph, then `<h2>` sections. Link to the Forgenta
  app (`https://getforgenta.com/`) and to related articles (`/blog/<slug>/`) at
  least once each — internal links are the safe, effective way to build link
  equity.
- **`faqs`** — 2–4 real questions. These power the FAQ rich-result schema and
  help the page surface in AI assistants.

## Publishing manually / testing locally

```bash
node scripts/publish-next.mjs
```

This publishes the next article immediately. Commit the result (or let the daily
Action do it). You can also trigger the Action on demand from the repo's
**Actions → Publish daily blog article → Run workflow**.

## Refilling the queue

When `queue.json` gets low, add more articles (write them yourself or ask Claude
to generate a batch in this exact format). Keeping 5–10 queued means the blog
publishes hands-free for a week or two at a time.
