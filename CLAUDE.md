# treforged.com — how work runs here

The executive at this desk is **Ellis**. Same manager loop as every other folder
(`~/.claude/CLAUDE.md`, Hands-Off CEO Protocol); this file is what is true *here*
and outranks the Desktop router inside this repo.

## Routing table — read the row, open that path, stop there

Answer the question from ONE row. Reading the whole tree to find where something
lives is the cost this table exists to remove, and `blog/` alone is 66 folders.

| The question | Open this | Not this |
| --- | --- | --- |
| A page's copy, layout or meta tags | the page's own `index.html` (`founders/`, `cars/`, `about/`, `contact/`, `services/`, `partnerships/`) or `index.html` at the root | `styles.css` — shared, and editing it changes every page |
| Anything shared across pages: colours, type, the header, the card and form classes | `styles.css` | a page's inline `style=` |
| Behaviour in the browser: the newsletter form, the founders waitlist form, view counts, the mobile menu | `main.js` | any page — none of them carry their own script |
| How a blog post is WORDED or structured | `scripts/generate-article.mjs` (the prompt) | `blog/<slug>/index.html` — a pipeline wrote it and will overwrite you |
| How a blog post is RENDERED: template, CTAs, UTMs, nav, "Keep reading", RSS | `scripts/publish-next.mjs` | the rendered posts |
| What gets published next, and what already was | `content-queue/queue.json`, `content-queue/published.json` (the source of truth for posts) | `blog/` |
| Which keywords the blog is chasing | `content-queue/keyword-targets.md`, `content-queue/topics.json` | |
| Which posts CONTAIN the keywords they chase | `node scripts/keyword-coverage.mjs` | the targets file alone - it says what was aimed at, never what landed |
| Whether anyone PRESSES the Forgenta CTA on a post | `counters.cta_clicks` in the `treforged-site` project, and `supabase/migrations/20260905_cta_click_counter.sql` | the view count alone - views say people arrived, not that they left for the app |
| Why the daily post fired, or did not | `.github/workflows/daily-article.yml` (cron `0 13 * * *`) | |
| The email capture backend: signups, the confirmation, unsubscribe | `supabase/functions/founder-waitlist/index.ts` | `main.js` — it only posts to it |
| The waitlist table's shape and grants | `supabase/migrations/20260903_founder_waitlist.sql` (source of truth; Ada keeps a copy in getforgenta) | |
| Why a deploy of `main.js` or `styles.css` has not reached visitors | `scripts/version-assets.mjs` - the filenames carry no hash, so the HTML stamps one | purging Cloudflare by hand, which fixes one deploy and not the next |
| Why almost nothing is served from the Cloudflare edge cache | `docs/cloudflare-cache.md` - HTML is `DYNAMIC` by default, so the existing extension-matched rules never see a page | adding a `?v=` exclusion, which silently defeats the content hashing |
| A calculator tool | `tools/<name>/` | |
| Whether the calculators are reachable at all - the hub, the nav link, the sitemap entry | `tools/index.html` and `scripts/tools-reachable.mjs` | the tool pages themselves - they were fine, and nobody could find them |
| What the last session did and what is open | `handoff.md` | git log |

**Gates. Run the one that matches what you touched; none of them need a build.**

| Touched | Run |
| --- | --- |
| `main.js` source attribution | `node scripts/test-source-attribution.mjs` |
| `main.js` Forgenta CTA click counting | `node scripts/test-cta-clicks.mjs` |
| the article prompt | `node scripts/generator-prompt.test.mjs` |
| the keyword targets, or a post's headings | `node scripts/keyword-coverage.mjs` (a report - it exits 0 with misses, 1 only if it examined nothing) |
| an FAQ heading on any post | `node scripts/faq-sync.mjs` - the question also lives in the FAQPage JSON-LD, and editing one and not the other is invisible on the page |
| anything that renders or publishes a post | `node scripts/seo-check.mjs` |
| `main.js` or `styles.css` themselves | `node scripts/version-assets.mjs` then commit the restamped HTML |
| a Cloudflare cache rule on either zone | `node scripts/cache-check.mjs` (add `--host=getforgenta.com` for that zone) |
| a tool page, the `/tools/` hub, or the site nav | `node scripts/tools-reachable.mjs` |
| this table | `node scripts/check-routing-table.mjs` |

## Handing a slice to a free local model

A free executor cannot see this repo. Paste the row's path AND the constraint,
or you get a plausible file that breaks the site — there is no build step to
catch it.

Always include, verbatim:

> This is a hand-written static site served by GitHub Pages. There is no build
> step, no framework, no bundler and no TypeScript: the file as committed is the
> file served, so it must run in a browser exactly as written. `main.js` is ES5-
> style plain JavaScript with `var` and `function` — match it, do not introduce
> `const`, arrow functions, imports or JSX. Reuse the existing CSS classes; do
> not invent class names or add a stylesheet. Output only the file content.

Then add the one that applies:

- **A page**: paste the whole of the nearest existing page as the shell, and ask
  for the `<main>` only. Never let it write the `<head>` — canonical, OG and
  Twitter tags are per-page and it will fabricate them.
- **A blog change**: paste `scripts/publish-next.mjs`, not a rendered post. A
  post it "fixes" is overwritten on the next run.
- **The edge function**: say the deployed path is `/founder-waitlist`, not `/`,
  and name every value that must never reach a log. It infers neither, and both
  have already shipped as defects here once.

## What this repo is

The public TRE Forged site: hand-written static HTML at the root
(`index.html`, `cars.html`, `founder.html`, `contact.html`), the SEO blog under
`blog/`, the article pipeline under `content-queue/`, and `feed.xml`. `CNAME`
holds the domain. There is no build step and no framework — what is committed is
what is served, which is the point.

## What that means in practice

- **Every change is live on merge.** There is no staging. Read the page you
  changed before committing; a broken tag ships as a broken page.
- **Its job is signups.** The site exists to turn attention into Forgenta users,
  so CTAs stay UTM-tagged (`utm_source=blog&utm_medium=article&utm_campaign=<slug>`)
  and a change that removes a path to the app is a regression, not a cleanup.
- **Keep it free to run.** Tre's explicit constraint: GitHub Pages plus
  Cloudflare, no paid services introduced without him saying so.
- **The blog auto-publishes.** Articles are generated and committed on a
  schedule from `content-queue/`. Before "fixing" an oddly-worded post, check
  whether a pipeline wrote it and fix the generator instead.
- **View counts are real numbers on a public page.** Never render a placeholder
  that looks like a measurement.

`handoff.md` here is a log. Commit on `main` and push there; no PRs unless Tre
asks.
