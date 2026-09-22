-- COUNTER HEALTH AUDIT for treforged.com (project zyvqoefbgsgkbdoydopt).
-- Written by Ellis 2026-09-22 while answering ask 0eb61a8f ("arrival tracking
-- is 90% blind"). Run it against the live database; it only reads.
--
-- ⚠️ WHY THIS IS A .sql FILE AND NOT A GATE, SAID PLAINLY. This repo holds no
-- credential that can reach these tables - counters is not in PostgREST's
-- exposed schema list and RLS is on with zero policies, so the site's own anon
-- key cannot SELECT any of them. Every other check in this repo reads the repo.
-- So NOTHING RE-RUNS THIS. It is a query somebody must choose to run, and a
-- future regression will not go red. 20260917's own footer records the same gap
-- for the same reason; this file does not close it, it just makes the
-- measurement re-derivable instead of living in one session's transcript.

-- ── 1. RETENTION. Every log table's code promises 48 hours. ─────────────
-- Measured 2026-09-22 BEFORE the fix: arrival_log 95 stale of 107, view_log
-- 118 of 139, cta_log 0 of 1. AFTER: 0 / 0 / 0.
-- Any non-zero `stale` here is a privacy statement that is currently false.
select 'arrival_log' t, count(*) rows, count(*) filter (where last_seen < now() - interval '48 hours') stale, min(last_seen) oldest from counters.arrival_log
union all
select 'view_log',      count(*),      count(*) filter (where last_seen < now() - interval '48 hours'), min(last_seen) from counters.view_log
union all
select 'cta_log',       count(*),      count(*) filter (where last_seen < now() - interval '48 hours'), min(last_seen) from counters.cta_log;

-- A sweep that is gated on chance has a period measured in TRAFFIC while the
-- comment beside it states a period in HOURS. Assert the code shape too, so a
-- reverted fix is visible without waiting 48 hours for rows to accumulate.
-- EXPECT 0. A non-zero count means a probabilistic sweep is back.
select count(*) fns_with_probabilistic_sweep
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('record_arrival', 'record_cta_click', 'increment_page_view')
  and position('if random()' in pg_get_functiondef(p.oid)) > 0;

-- POSITIVE CONTROL for the query above: it must be able to FIND those three
-- functions at all. EXPECT 3. A zero from the check plus a zero here is a
-- broken lookup, not a clean database - and the two are the same zero.
select count(*) fns_examined
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('record_arrival', 'record_cta_click', 'increment_page_view');

-- ── 2. WHAT 'direct' ACTUALLY CONTAINS ──────────────────────────────────
-- The ask's real question: 'direct' collapses three different things - a typed
-- URL, a source the resolver cannot read, and traffic that is not a reader at
-- all. wlSource() in main.js resolves in this order: utm_source, then the
-- in-app browser user agents, then document.referrer, then 'direct'. So
-- 'direct' means NO utm AND not a known in-app browser AND an EMPTY referrer.
--
-- The resolver is NOT broken, and that is asserted rather than assumed: the
-- live table carries on-site, google.com, appagg.com and instagram/link_in_bio,
-- so the referrer and utm paths demonstrably work. A label of 'direct' is a
-- real absence of signal, not a failure to read one.
--
-- THE DISCRIMINATOR THAT IS AVAILABLE WITHOUT COLLECTING ANYTHING NEW: whether
-- the arriving visitor ever recorded a single page view. record_arrival and
-- increment_page_view fire from the same main.js on the same load, so a real
-- reader who lands on a counted page produces both. Joining on ip_hash is
-- legitimate here because both functions hash with the same salt - which the
-- matched_control column below proves, rather than asserting.
with m as (
  select a.day,
         (select count(distinct v.slug) from counters.view_log v where v.ip_hash = a.ip_hash) slugs
  from counters.arrival_log a)
select day,
       count(*)                                    arrivals,
       count(*) filter (where slugs = 0)           read_nothing,
       round(100.0 * count(*) filter (where slugs = 0) / nullif(count(*),0), 1) pct_read_nothing,
       count(*) filter (where slugs between 1 and 3) read_1_to_3,
       count(*) filter (where slugs > 3)           read_over_3,
       max(slugs)                                  max_slugs
from m group by day order by day;

-- POSITIVE CONTROL for that join. EXPECT matched > 0. If nothing matches, the
-- two tables hash different inputs and every `read_nothing` above is an
-- artefact of a join that cannot match - which looks exactly like a site nobody
-- reads. Measured 2026-09-22: 36 matched, 71 did not.
select count(*) filter (where exists (select 1 from counters.view_log v where v.ip_hash = a.ip_hash)) matched_control,
       count(*) total
from counters.arrival_log a;

-- ── 3. WHAT THIS CANNOT SEE. Read before quoting any number above. ──────
--  * A BOT AND A PERSON ARE NOT DISTINGUISHABLE HERE. `read_nothing` is a
--    behaviour, not an identity. It is strong evidence that a population is
--    not reading the site; it is NOT evidence of what that population is.
--    Nothing in these tables stores a user agent, and deliberately so.
--  * DISTINCT IPs, NOT PEOPLE. A shared network reads as one arrival, so this
--    UNDERCOUNTS, and it undercounts hardest where a campaign is working.
--  * A VISITOR LANDING ON AN UNCOUNTED PAGE RECORDS NO VIEW. main.js counts
--    home, about, cars, contact, founders, partnerships, services, the tools
--    pages and every blog post. The blog INDEX and the tools HUB are not
--    counted, so a real person who lands on one and leaves scores slugs = 0.
--    This is a live alternative explanation for part of `read_nothing` and it
--    has NOT been retired.
--  * ARRIVALS ARE PER SESSION, VIEWS ARE PER SLUG PER 24h. The two dedupe on
--    different keys, so the join answers "did this visitor EVER record a view",
--    never "did they record one on this visit".
--  * THE LOGS ARE NOW SWEPT AT 48 HOURS, so section 2 can only ever describe
--    the last two days. The six-day window measured on 2026-09-22 existed only
--    because the sweep was broken. That reading is preserved in the handoff;
--    it is not reproducible from the database any more, and that trade - a
--    kept privacy promise over a longer analytics window - is deliberate.
