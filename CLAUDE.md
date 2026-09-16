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
| Why a `<select>`, `<input>` or `<textarea>` looks like a white box, or its dropdown list is OS-grey | the FORM CONTROLS block in `styles.css` — and `color-scheme: dark` on `:root`, which is the ONLY lever over the OS-drawn popup, scrollbars, number spinners and date pickers | the page holding the control — none of them style their own fields |
| Behaviour in the browser: the newsletter form, the founders waitlist form, view counts, the mobile menu | `main.js` | any page — none of them carry their own script |
| How a blog post is WORDED or structured | `scripts/generate-article.mjs` (the prompt) | `blog/<slug>/index.html` — a pipeline wrote it and will overwrite you |
| How a blog post is RENDERED: template, CTAs, UTMs, nav, "Keep reading", RSS | `scripts/publish-next.mjs` | the rendered posts |
| What gets published next, and what already was | `content-queue/queue.json`, `content-queue/published.json` (the source of truth for posts) | `blog/` |
| Which keywords the blog is chasing | `content-queue/keyword-targets.md`, `content-queue/topics.json` | |
| Which posts CONTAIN the keywords they chase | `node scripts/keyword-coverage.mjs` | the targets file alone - it says what was aimed at, never what landed |
| Which pages have a view count at all, and why a page reads 0 views | the PAGEVIEW block in `main.js` - only `/blog/<slug>/`, the tools pages and the seven static pages are counted. A page outside that allow-list reads 0 because nothing counts it, which is an ABSENCE, not a measurement | the `counters.page_views` table alone - a slug missing from it and a slug with 0 visitors look identical |
| Whether the CTA listener actually SHIPS to visitors on the non-blog pages | `node scripts/live-cta-listener.mjs` - it fetches five live paths cache-busted and reads the `main.js` each one actually references. Cloudflare rewrites at the edge, so every OTHER gate here reads the repo and none of them can prove what ships | `main.js` on disk, or `scripts/test-cta-clicks.mjs` - both are source checks and were green for nine days while the homepage and all four calculators recorded nothing |
| WHERE a visitor came from - the UTM/campaign attribution for the whole site | `counters.arrival_sources` in the `treforged-site` project, and `supabase/migrations/20260916_arrival_source_counter.sql`. The resolver is the ARRIVAL_SOURCE block in `main.js`, which is site-wide - it lived inside `if (wlForm)` until 2026-09-16 and therefore existed ONLY on `/founders/` | `increment_page_view` or `record_cta_click` - NEITHER takes a source argument, confirmed against `pg_proc`. A campaign zero read from those is an ABSENCE |
| Whether anyone PRESSES the Forgenta CTA on a post | `counters.cta_clicks` in the `treforged-site` project, and `supabase/migrations/20260905_cta_click_counter.sql` | the view count alone - views say people arrived, not that they left for the app |
| Why the daily post fired, or did not | `.github/workflows/daily-article.yml` (cron `0 13 * * *`) | |
| The email capture backend: signups, the confirmation, unsubscribe | `supabase/functions/founder-waitlist/index.ts` | `main.js` — it only posts to it |
| The waitlist table's shape and grants | `supabase/migrations/20260903_founder_waitlist.sql` (source of truth; Ada keeps a copy in getforgenta) | |
| Why a deploy of `main.js` or `styles.css` has not reached visitors | `scripts/version-assets.mjs` - the filenames carry no hash, so the HTML stamps one | purging Cloudflare by hand, which fixes one deploy and not the next |
| Why almost nothing is served from the Cloudflare edge cache | `docs/cloudflare-cache.md` - HTML is `DYNAMIC` by default, so the existing extension-matched rules never see a page | adding a `?v=` exclusion, which silently defeats the content hashing |
| A calculator tool | `tools/<name>/` | |
| Whether the calculators are reachable at all - the hub, the nav link, the sitemap entry | `tools/index.html` and `scripts/tools-reachable.mjs` | the tool pages themselves - they were fine, and nobody could find them |
| Whether anything at all - a tool, a page, a link target - is built but reachable from nowhere | `scripts/reachability.mjs` and `reachability.config.json` - it reports ORPHAN and BROKEN separately, and exits 2 when it examined nothing | a "does it exist" check, which is the question that let three calculators sit unreachable for five days |
| Whether a rounded element nested inside another rounded element has the wrong corner radius | `node scripts/concentricity.mjs` for the source proxy, and `scripts/concentricity-probe.js` pasted into a real browser for the measurement - the probe is the only one that can see geometry | reading `border-radius` in `styles.css` and judging it by eye: the rule is `r_inner = r_outer - gap`, and the gap is a fact about computed layout, not about the stylesheet |
| Whether any JavaScript here is dead, undefined or unreachable | `node scripts/lint-baseline.mjs`, configured by `eslint.config.mjs` | `npx eslint .` alone - it says nothing about what it did NOT examine, and the Deno function is outside it |
| Whether a blog slug is load-bearing for a Forged Reach campaign, so renaming it would silently 404 a live campaign | `node scripts/reach-destinations.mjs` and `reach-destinations.json` - the slug list is DERIVED from forge-reach's own campaign data (scripts/data/pilot-campaigns.json, in THAT repo - deliberately not backticked, because it is not a path in this one), never hand-named here | a list of slugs written into a test file, which passes the campaign nobody added to it |
| What the last session did and what is open | `handoff.md` | git log |

**Gates. Run the one that matches what you touched; none of them need a build.**

| Touched | Run |
| --- | --- |
| `main.js` source attribution | `node scripts/test-source-attribution.mjs` |
| `main.js` Forgenta CTA click counting | `node scripts/test-cta-clicks.mjs` |
| `main.js` source/UTM attribution, the ARRIVAL_SOURCE or ARRIVAL_SEND blocks | `node scripts/test-source-attribution.mjs` - 23 checks. It lifts the block by MARKER (never by indentation) and asserts the resolver is reachable SITE-WIDE, not just that it returns the right string: every value case passed for nine days while the resolver was waitlist-scoped |
| `main.js` CTA counting, AFTER the deploy has landed | `node scripts/live-cta-listener.mjs` - exit 0 ships, 1 missing, 2 could not check. Assert on the LIVE page, never on the file: the deployed HTML is not the committed HTML. `--limits` prints what it misses |
| `main.js` page-view counting, or which pages are counted | `node scripts/test-page-views.mjs` - it EXTRACTS the shipped block between the `PAGEVIEW_BLOCK` markers, so moving or deleting the block fails it rather than passing over a restatement |
| the article prompt | `node scripts/generator-prompt.test.mjs` |
| the keyword targets, or a post's headings | `node scripts/keyword-coverage.mjs --max-misses=0` - without the flag it is a report and exits 0 with misses; with it, it is a gate. Coverage reached 0 misses on 2026-09-06 |
| an FAQ heading on any post | `node scripts/faq-sync.mjs` - the question also lives in the FAQPage JSON-LD, and editing one and not the other is invisible on the page |
| anything that renders or publishes a post | `node scripts/seo-check.mjs` |
| any `<select>`, `<input>`, `<textarea>`, checkbox, radio, number or date field, or the form-control CSS | `node scripts/form-control-theming.mjs` — a source scan, deliberately: jsdom returns `''` for class-driven styles, so a computed-style gate would be green against every defect it exists to catch. `--limits` prints what it does NOT catch; read that before trusting a PASS |
| `main.js` or `styles.css` themselves | `node scripts/version-assets.mjs` then commit the restamped HTML |
| a Cloudflare cache rule on either zone | `node scripts/cache-check.mjs` (add `--host=getforgenta.com` for that zone) |
| a tool page, the `/tools/` hub, or the site nav | `node scripts/tools-reachable.mjs` |
| any JavaScript file in this repo | `node scripts/lint-baseline.mjs` - every rule in `eslint.config.mjs` is `warn` ON PURPOSE, so this REPORTS a count and does not go red on it. It exits non-zero only for a lint ERROR, for a tracked file outside the linter with no recorded reason, or when it examined nothing. Baseline on 2026-09-08 was 5 warnings; swept to **1**, and CI runs it as `--max-warnings=1`. The 1 is `main.js`'s unused `e` parameter, left on purpose because restamping 82 HTML pages for it buys a visitor nothing - it goes with the next real `main.js` change |
| a page, a tool, or anything that is supposed to be linked from somewhere | `node scripts/reachability.mjs` |
| a `border-radius` or a `padding` in `styles.css` | `node scripts/concentricity.mjs` - it judges CONTAINERS only and prints how many, counting leaf form controls separately rather than excluding them silently. `--limits` prints what it cannot see; read that before trusting a PASS. It is a SOURCE proxy: for the geometry itself paste `scripts/concentricity-probe.js` into a browser |
| any blog slug: renaming, deleting or moving a post directory | `node scripts/reach-destinations.mjs` - exit 0 present, 1 missing or the snapshot drifted from forge-reach, 2 could not check. It runs DERIVED here (forge-reach is a sibling folder) and SNAPSHOT ONLY in CI, and says which on every run. It is a SOURCE check against this repo on disk: Cloudflare rewrites the markup at the edge, so it cannot prove what ships. `--limits` prints the rest of what it misses; `--refresh` after forge-reach changes its campaigns |
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
