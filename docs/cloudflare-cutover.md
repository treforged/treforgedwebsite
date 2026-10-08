# Cutover: GitHub Pages → Cloudflare Pages, then a private repo

Ask 6db247d4 (decision f54c3e7a). Tre, 2026-10-08: keep the code private, serve
the public site from Cloudflare, and run jobs on the PC instead of spending
Actions minutes.

**Status: READY, NOT DONE.** Everything in this repo is in place on branch
`claude/cloudflare-pages-6db247d4`. Nothing in the Cloudflare account, the
GitHub settings or DNS has been touched. Every step in section 3 is Tre's click.

---

## 1. What changed in the repo, and why

| Piece | What it does |
| --- | --- |
| `scripts/build-pages.mjs` (`npm run build`) | Runs the gates, then copies **only the served site** into `dist/`. Cloudflare serves `dist/`. |
| `cloudflare/_headers` | `nosniff`, referrer policy, a week of cache on `/assets/*`, and `noindex` on every `*.pages.dev` hostname. |
| `cloudflare/_redirects` | Real 301s for `/cars.html`, `/contact.html`, `/founder.html` (on GitHub Pages they were meta-refresh stub pages). |
| `cloudflare/404.html` | The not-found page. **Without it Cloudflare Pages assumes a single-page app and answers every unknown URL with the homepage and a 200.** |
| `daily-article.yml`, `backfill-articles.yml` | Runner is picked by the repo variable `ARTICLE_RUNNER`. Unset = GitHub-hosted, as today. `pc` = Tre's Windows runner. |
| `seo-check`, `version-assets`, `form-control-theming`, `tools-reachable` | Skip `dist/`, so a local build does not get counted as a second copy of the site. |

**Why a build step exists at all.** GitHub Pages served the whole repo root, so
`/scripts/generate-article.mjs`, `/CLAUDE.md`, `/content-queue/queue.json` and
`/supabase/...` were all public URLs. Making the GitHub repo private would not
change that if the host still served the whole checkout. The build is an
allowlist. It is fail-closed: a tracked file that is neither PUBLIC nor PRIVATE
in `build-pages.mjs` stops the build, so a new page directory cannot vanish and
a new private directory cannot leak without someone choosing that.

Nothing is transpiled. Every file in `dist/` is byte-for-byte the committed file.

**Verified 2026-10-08 in the cloud container** (Node 24.21, `wrangler pages dev`
serving `dist/`):

- Build: 26 gates passed, 11 tool suites found. 148 files served, 106 tracked
  files kept out. All 114 sitemap URLs, all 3,327 root-relative links and all 3
  redirects resolve inside `dist/`.
- Proven red four ways: an unclassified new page dir, an unclassified `.md` in
  `tools/`, a page linking into `/docs/` (resolves in the repo, 404 in `dist/`),
  and a failing gate.
- Served: pages 200. `/about` → 308 `/about/`. The three `.html` stubs → 301.
  `/does-not-exist` → **404** with the styled page. `/scripts/…`, `/CLAUDE.md`,
  `/content-queue/queue.json`, `/package.json`, `/CNAME`, `*.test.mjs` → **404**.
  `/assets/*` carries `Cache-Control: public, max-age=604800`.
- Not verifiable from the container: the live site. The container's network
  proxy blocks treforged.com, so the before/after comparison is section 5, run
  by Tre.

## 2. Build settings (what you type into Cloudflare)

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Framework preset | `None` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | *(leave blank)* |
| Environment variable | `NODE_VERSION` = `24` (the repo's `.nvmrc` already says 24; this is a backup) |
| Build system version | v3 (the default for new projects) |

Cloudflare installs dependencies itself (`npm ci` from `package-lock.json`, which
brings eslint for the lint gate). No secrets are needed: the build calls no API.

**Limits that apply** (Cloudflare docs, read 2026-10-08, Free plan): 500 builds
a month, one at a time, 20-minute timeout, 20,000 files, 25 MiB per file. This
site is 148 files and the build takes seconds. About 31 daily-post builds plus
normal pushes is well under 500.

**If a gate fails, the build fails and Cloudflare keeps serving the last good
deployment.** That is stricter than GitHub Pages, which served whatever was
committed. In an emergency, set the variable `SKIP_GATES` = `1` in the Pages
project, redeploy, and delete the variable afterwards. The build log says loudly
that it skipped.

## 3. The cutover, click by click (Tre)

Do the steps in order. Steps A to E change nothing visitors see. The switch
happens at step F.

### A. Merge the branch

Merge `claude/cloudflare-pages-6db247d4` into `main`. This is safe while GitHub
Pages is still live: the article workflows behave exactly as before because
`ARTICLE_RUNNER` is unset, `dist/` is gitignored, and the files under
`cloudflare/` sit unused at `/cloudflare/…` on GitHub Pages.

### B. Write down the current DNS (needed for rollback)

1. Cloudflare dashboard → **treforged.com** → **DNS** → **Records**.
2. Screenshot or export the records for `treforged.com` (the apex) and `www`.
   Today they point at GitHub Pages: A records `185.199.108.153` to
   `185.199.111.153`, and/or a CNAME to `treforged.github.io`.

### C. Create the Pages project

1. Cloudflare dashboard → **Workers & Pages** → **Create application**.
2. Choose the **Pages** tab, then **Import an existing Git repository** (the
   wording may read "Connect to Git"). Do not choose the Workers option.
   Cloudflare now pushes new projects towards Workers; this cutover uses Pages.
3. **Connect GitHub**. When GitHub asks which repositories the Cloudflare app may
   see, choose **Only select repositories** → `treforged/treforgedwebsite`. This
   access keeps working after the repo goes private.
4. Select the repo → **Begin setup**.
5. Project name: `treforged`. This gives you `treforged.pages.dev`.
6. Enter the settings from section 2: branch `main`, preset `None`, build
   `npm run build`, output `dist`. Under **Environment variables** add
   `NODE_VERSION` = `24`.
7. **Save and Deploy**. Watch the log. It should end with
   `PASS - dist/ holds only the served site…`.

### D. Check the preview before anyone sees it

Open `https://treforged.pages.dev` and run section 5 against it, with
`SITE=https://treforged.pages.dev`. Two expected differences there: responses
carry `X-Robots-Tag: noindex` (correct, that host must never rank), and the
founders waitlist form may refuse the request, because its edge function only
allows the treforged.com origin. Both are fine.

### E. (Optional) Limit preview builds

Pages project → **Settings** → **Builds** → **Branch control**. Leave preview
builds on: each branch push builds a preview and runs every gate, which is how
the gates keep running once `lint.yml` is off (step I). Turn them off only if
builds get anywhere near 500 a month.

### F. Point treforged.com at Pages (the switch)

1. Pages project → **Custom domains** → **Set up a custom domain** →
   `treforged.com` → **Continue**.
2. Because the zone is already on Cloudflare, it offers to replace the apex
   records with a CNAME to `treforged.pages.dev`. **Activate domain**. The
   certificate is issued within minutes.
3. **www**: look at what you wrote down in step B.
   - If `www` is a CNAME to `treforged.github.io`, it breaks when GitHub Pages
     is switched off. Add `www.treforged.com` as a second custom domain, then
     **Rules** → **Redirect Rules** → create a rule: hostname equals
     `www.treforged.com` → **Dynamic** redirect, expression
     `concat("https://treforged.com", http.request.uri.path)`, status 301,
     **Preserve query string** on.
   - If `www` already redirects with a Cloudflare rule, leave it alone.
4. **SSL/TLS** → **Edge Certificates** → make sure **Always Use HTTPS** is on.
   GitHub Pages enforced HTTPS before; this is now Cloudflare's job.
5. Run section 5 against `https://treforged.com`.

### G. Make the GitHub repo private

GitHub → `treforged/treforgedwebsite` → **Settings** → **General** → **Danger
Zone** → **Change repository visibility** → **Make private**.

What follows from that:
- On a free GitHub plan, Pages does not serve private repos, so the GitHub Pages
  site stops. That is intended: step F already moved traffic.
- The Cloudflare app keeps access (step C3), so deploys continue.
- Actions on a private repo draw from the account's private-repo minutes. Those
  are exhausted until 11-01, which is what step H is for.

### H. Move the daily article to the PC

1. Confirm Sam's runner is attached to this repo and online: repo **Settings**
   → **Actions** → **Runners** → a runner with labels `self-hosted`, `windows`,
   status **Idle**.
2. The PC needs **Git for Windows**, so `bash` is on the runner's PATH. The
   workflow steps are bash. `actions/setup-node` installs Node 24 itself.
3. Repo **Settings** → **Secrets and variables** → **Actions** → **Variables**
   tab → **New repository variable** → name `ARTICLE_RUNNER`, value `pc`.
4. **Actions** → **Publish daily blog article** → **Run workflow**. The first
   step must print `repo is private - PC runner allowed`. The run should end
   with a push, and Cloudflare should start a build for it within a minute.

If the PC is off at 13:00 UTC, the job waits in the queue. GitHub drops a
self-hosted job that waits 24 hours, so a day with the PC off all day is a day
with no post. The next run's catch-up logic in `publish-next.mjs` is unchanged.

The workflow refuses to run on the PC while the repo is public. Sam's runner
is for private repos only, and the first step checks the repo's visibility
through the API before any script runs.

### I. Turn off what no longer has a job

1. **Actions** → **Lint** → **···** → **Disable workflow**. Its node gates now
   run in every Cloudflare build, on every branch.
2. GitHub repo → **Settings** → **Pages** → **Unpublish site** / set the source
   to **None**, and remove the custom domain there. It may already show as
   disabled after step G.
3. **Keep** the `CNAME` file and the workflow files for now. Delete them only
   after a week without a rollback.

**Two checks are lost when `lint.yml` is off.** Neither can run in the
Cloudflare build:
- `deno test supabase/functions/calculator-result-email/`: there is no Deno in
  the build image. Run it on the desk whenever that function is touched (the
  CLAUDE.md gates table already says so).
- `secret-scan-ci --range`: the build checks HEAD only, so a key added and then
  deleted inside one push is not caught. The pre-commit hook still runs locally.
  Once the repo is private, a slip like that is no longer public, but it is
  still a key to rotate.

## 4. The three workflows: what replaces each

| Workflow | Replacement | Why |
| --- | --- | --- |
| `lint.yml` (push/PR) | **The Cloudflare Pages build.** `build-pages.mjs` runs the same node gates on every push to every branch, at no Actions cost. | Gates belong where the deploy is decided. A red build blocks the deploy, where `lint.yml` only reported after the fact. |
| `daily-article.yml` (cron 13:00 UTC) | **PC self-hosted runner** (`ARTICLE_RUNNER=pc`). Its push to `main` triggers the Cloudflare build, which is the deploy. | A Worker cron is not viable on the free plan. Cloudflare docs (read 2026-10-08): Workers Free gives **10 ms CPU per Cron Trigger** and 5 cron triggers per account, against 30 s or more on Workers Paid. Rendering, relinking and stamping 100+ HTML files and running the SEO gate is far beyond 10 ms. A Worker also has no git and no filesystem, so the whole pipeline would have to be rewritten to commit through the GitHub API. That is a paid plan plus a rewrite, against Tre's "keep it free" rule. |
| `backfill-articles.yml` (manual) | **PC runner**, same variable. | Manual and rare. It needs the same Node and git as the daily job. |

## 5. Post-cutover checklist

Run it from any terminal with `curl`. Set `SITE=https://treforged.com` (or the
`pages.dev` URL in step D).

```bash
SITE=https://treforged.com

# 1. DNS and serving. Expect "server: cloudflare" and NO x-github-request-id.
curl -sI "$SITE/" | grep -iE '^(HTTP|server|x-github-request-id|cf-ray)'

# 2. HTTPS. http:// must redirect to https://, and the cert must be valid
#    (no -k flag anywhere here).
curl -sI "http://treforged.com/" | grep -iE '^(HTTP|location)'

# 3. Every sitemap URL answers 200. Expect 0 lines of output.
curl -s "$SITE/sitemap.xml" | grep -o '<loc>[^<]*' | sed 's/<loc>//' \
  | sed "s#https://treforged.com#$SITE#" \
  | while read -r u; do c=$(curl -s -o /dev/null -w '%{http_code}' "$u"); [ "$c" = 200 ] || echo "$c $u"; done

# 4. Redirects, the 404, and the private paths.
for p in /about /cars.html /contact.html /founder.html /does-not-exist \
         /scripts/generate-article.mjs /CLAUDE.md /content-queue/queue.json /package.json; do
  printf '%-32s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$SITE$p")"
done
# Expect: /about 308 → /about/, the three .html files 301, everything else 404.

# 5. Feeds and crawler files: each must answer 200.
for p in /sitemap.xml /robots.txt /feed.xml /llms.txt; do echo "$(curl -s -o /dev/null -w '%{http_code}' "$SITE$p") $p"; done

# 6. pages.dev must NOT be indexable (header present), and treforged.com MUST be
#    indexable (header absent).
curl -sI https://treforged.pages.dev/ | grep -i x-robots-tag
curl -sI "$SITE/" | grep -i x-robots-tag || echo "ok: no x-robots-tag on $SITE"
```

Then, from the repo on the desk:

- [ ] **View counts** (the endpoint `5985e9b` kept recording). Open any blog
      post in a private window → DevTools → **Network** → there must be one
      `POST …supabase.co/rest/v1/rpc/increment_page_view` with status 200. Then
      confirm that slug's row in `counters.page_views` (treforged-site project)
      went up by one. The public count stays hidden; that is `5985e9b` working,
      not a regression.
- [ ] **CTA listener and arrival sources**: `node scripts/live-cta-listener.mjs`
      → exit 0. It fetches the live pages cache-busted, so it is the check that
      proves the Cloudflare-served HTML still loads the stamped `main.js`.
- [ ] **Founders waitlist**: submit a test address on `/founders/` from
      treforged.com and confirm the confirmation email arrives. The origin is
      unchanged, so the edge function's allowlist needs no edit.
- [ ] **Edge cache**: `node scripts/cache-check.mjs`, then compare with the
      after-numbers in `docs/cloudflare-cache.md`. The zone's cache rules still
      sit in front of the Pages custom domain, but re-measure rather than assume.
- [ ] **Search Console**: nothing to change (same domain, same URLs). Optionally
      resubmit `sitemap.xml` and spot-check URL Inspection on one post.
- [ ] **Next daily post** lands: Actions run green on the PC runner → a new
      Cloudflare deployment for that commit → the post answers 200 on
      treforged.com.

## 6. Rollback

**A bad deploy (site up, content wrong).** Pages project → **Deployments** →
pick the last good one → **···** → **Rollback to this deployment**. Instant,
with no DNS change. Then fix forward on `main`.

**Back to GitHub Pages, before step G (repo still public).**
1. Pages project → **Custom domains** → remove `treforged.com` (and `www`).
2. **DNS** → restore the records you wrote down in step B.
3. GitHub → **Settings** → **Pages** → source **Deploy from a branch** → `main`
   / `/ (root)` → custom domain `treforged.com` → **Enforce HTTPS**. The `CNAME`
   file is still in the repo, which is why step I keeps it.
4. Unset `ARTICLE_RUNNER` (if it was set) so publishing goes back to
   GitHub-hosted runners.

**Back to GitHub Pages, after step G.** GitHub Pages on a free plan needs a
public repo, so this means making the repo public again, which publishes the
code. Prefer the deployment rollback above. If Cloudflare Pages itself is the
problem, the steps are: make the repo public, then follow the steps above.

**Undo the repo changes.** `git revert` the merge commit. GitHub Pages is
unaffected either way: it never read `dist/`, `cloudflare/` or `package.json`'s
build script.

## 7. After cutover: small follow-ups for the desk

- `CLAUDE.md` still says "served by GitHub Pages" in "What this repo is" and in
  the free-model handoff text. Update both once step F is done.
- `.gitignore`'s comment about `handoff.md` ("they'd be served at
  treforged.com") stops being true: `dist/` never contains it. It still should
  not be committed.
- After a week with no rollback: delete `CNAME`, delete `lint.yml`, and decide
  whether the two article workflows should drop their GitHub-hosted branch.
