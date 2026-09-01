# treforged.com — how work runs here

The executive at this desk is **Ellis**. Same manager loop as every other folder
(`~/.claude/CLAUDE.md`, Hands-Off CEO Protocol); this file is what is true *here*
and outranks the Desktop router inside this repo.

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
