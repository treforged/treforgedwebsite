# Cloudflare edge cache — why it was off, and the rules that turn it on

Measured 2026-09-06 by `node scripts/cache-check.mjs`. Re-run that script to
prove any change; a rule that exists is not a rule that fires.

## The measurement, before

| Zone | Sample | Cached | Ratio |
| --- | --- | --- | --- |
| treforged.com | 80 URLs x 2 passes (78 sitemap pages + 2 versioned assets) | 2 | **2.5%** |
| getforgenta.com | 20 sitemap URLs x 2 passes | 0 | **0.0%** |

Cloudflare's own 30-day counter for treforged.com read 407 cached of 90.89k
requests (0.45%). The 80-URL sample agrees with it and says WHICH requests: the
only two cached responses were `/styles.css?v=` and `/main.js?v=`. **Every one
of the 78 HTML pages returned `cf-cache-status: DYNAMIC`, on both passes.**

## APPLIED 2026-09-06, and the measurement after

Tre approved it in Ellis's session; both rules were added by hand in the
dashboard, in the documented order.

| | Sample | Pass 1 | Pass 2 | Cached |
| --- | --- | --- | --- | --- |
| Before | 80 URLs x 2 | 78 DYNAMIC, 1 HIT, 1 MISS | 78 DYNAMIC, 2 HIT | **2.5%** |
| After | 83 URLs x 2 | 2 HIT, **81 MISS** | **83 HIT** | **100.0%** |

**The number that proves the fix is not the 100% - it is `MISS`.** Before, pages
came back `DYNAMIC`, meaning Cloudflare never considered them cacheable. A MISS
means it tried, found nothing, and stored the response. That is the eligibility
change; the 100% on pass 2 is just the consequence.

Rules on the zone, in order - **the order is load-bearing, do not reorder**:

| Order | Name | Match | Action |
| --- | --- | --- | --- |
| 1 | Cache static assets | file extension in css, js, jpg... | pre-existing, untouched |
| 2 | Versioned assets (main.js, styles.css) | URI path eq /main.js or /styles.css | eligible, Edge TTL 30 days ignoring origin, Browser TTL 1 year |
| 3 | Cache HTML zone-wide | hostname eq treforged.com | eligible, Edge TTL 2 hours ignoring origin, Browser TTL respect origin |

**STILL OUTSTANDING: the UTM query-string exclusion on rule 3.** The cache key
still includes the whole query string, so each `?utm_campaign=<slug>` is a
separate entry that starts cold. That is the smaller of the two causes above and
costs efficiency, not correctness - the rule is doing its job without it.

It was not applied because the dashboard's cache-key form rendered with
overlapping, unclickable elements twice, and blind-clicking a cache key on a
production zone risks an "ignore all query strings" setting that would collapse
every `?v=` hash to one key and serve stale assets forever. **Set it as
`all_except` with exactly `utm_source, utm_medium, utm_campaign, utm_content,
utm_term, gclid, fbclid` - never "ignore all".** Re-run `cache-check` after.

## The cause

`DYNAMIC` does not mean "tried to cache and failed". It means Cloudflare never
considered the response cacheable. Cloudflare's default cache eligibility is
decided by file EXTENSION, and HTML is not on that list. The cache rules already
on the zone match static extensions, so they fire for the assets and never see
a page.

This site is ~97% HTML pages by URL count, so extension-based caching can only
ever reach a low single-digit hit rate. It did: 0.45%.

A second, smaller cause on blog URLs: the default cache key includes the whole
query string, so `?utm_source=blog&utm_medium=article&utm_campaign=<slug>` makes
every campaign a separate cache entry that starts cold.

## The fix — treforged.com, TWO rules, and the ORDER is load-bearing

**Rule 1 must be first.** It protects the content-hash versioning, which is the
thing that makes any of this safe: `styles.css?v=8f6cff59` and `main.js?v=c4f9fb0f`
change their URL whenever their bytes change, so a new deploy is a new cache key
and can never be masked by a stale one.

### Rule 1 — versioned assets (priority 1)

- **Expression**:
  `(http.request.uri.path eq "/main.js" or http.request.uri.path eq "/styles.css")`
- **Cache eligibility**: Eligible for cache
- **Edge TTL**: Ignore cache-control header and use this TTL — **1 month**
- **Browser TTL**: Override origin — **1 year**
- **Cache key**: leave the query string IN the key. Default is correct.

**Never add "ignore query string" to this rule, and never add a `?v=` exclusion
to any rule.** Ignoring the query string collapses every hash to one cache key
and silently serves the old file forever. Excluding `?v=` from caching throws
away the one URL shape that is safe to cache hardest. Both defeat the versioning
without producing an error anyone would notice.

### Rule 2 — the rest of the zone (priority 2)

- **Expression**: `(http.host eq "treforged.com")`
- **Cache eligibility**: Eligible for cache
- **Edge TTL**: Ignore cache-control header and use this TTL — **2 hours**
- **Browser TTL**: Respect origin (GitHub Pages sends `max-age=600` on HTML)
- **Cache key → Query string**: Exclude `utm_source`, `utm_medium`,
  `utm_campaign`, `utm_content`, `utm_term`, `gclid`, `fbclid`.
  **Exclude those named params only — never "ignore all".** Rule 1 sits above
  this one so the assets never reach it, but an ignore-all here is one rule
  reorder away from breaking them.

**What 2 hours costs:** the blog auto-publishes at 13:00 UTC, so a new post and
the blog index can be up to 2 hours stale at the edge. The browser TTL still
respects the origin's 600s, so a returning visitor re-checks in 10 minutes.
Shorten the edge TTL if that trade stops being worth it; do not solve it by
turning caching off.

## The fix is NOT the same on getforgenta.com

Two differences, and the second is a safety question, not a tuning one.

1. **The origin actively forbids caching.** Vercel sends
   `Cache-Control: public, max-age=0, must-revalidate` on HTML. On treforged the
   origin sends `max-age=600`, so "Respect origin" would at least cache for ten
   minutes. On getforgenta, "Respect origin" caches for zero seconds — the Edge
   TTL **must** be an explicit override or the rule changes nothing while looking
   correct on the rule page.
2. **getforgenta is an application, not a brochure.** A zone-wide "eligible for
   cache" rule on a site with authenticated routes can serve one signed-in
   person's HTML to another. The marketing pages are safe to cache; the app
   routes are not, and deciding which is which belongs to Ada, who owns that
   repo. Do not copy Rule 2 across.

## Proving it

```
node scripts/cache-check.mjs                       # treforged.com, gate at 50%
node scripts/cache-check.mjs --host=getforgenta.com
node scripts/cache-check.mjs --min-cached=80
```

It walks the live sitemap plus the two versioned assets, twice, and reports
`cf-cache-status` counts per pass. Pass 2 is the one that matters: a first
request to a cold edge is expected to MISS. Exit code 0 only if pass 2 clears
the threshold.
