-- Make the 48-hour retention promise TRUE. Applied to the treforged-site
-- project (zyvqoefbgsgkbdoydopt) on 2026-09-22 by Ellis.
--
-- THE DEFECT, MEASURED BEFORE TOUCHING ANYTHING: 20260916/20260917 both state
-- that arrival_log "is swept after 48 hours". On 2026-09-22 that table held
-- 107 rows, of which 95 were PAST that window, the oldest six days old
-- (2026-09-16 - the day the table was created). So the sweep had effectively
-- never run, and the sentence a privacy reviewer reads was false.
--
-- WHY IT NEVER RAN, and this is the generalisable half: the sweep was gated on
-- `random() < 0.01`, so it needs about 100 qualifying calls to fire ONCE. It is
-- also placed AFTER the dedupe check, so only a visitor's FIRST arrival of the
-- day reaches it. At this site's volume - about 15 arrivals a day - that is
-- roughly one sweep every several days, and nothing anywhere reports that it
-- did not happen. A probabilistic sweep is a retention policy whose period is a
-- function of TRAFFIC, while the comment beside it states a period in HOURS.
-- At low volume those two numbers are not close, and the document is the one
-- that gets believed.
--
-- THE FIX IS TO STOP BEING CLEVER. The delete is one indexed predicate over a
-- table that, once this is running, can never hold more than 48 hours of rows -
-- about 30 on current traffic. Running it unconditionally on every call costs
-- less than the random() draw saved, and it makes the retention period a
-- property of the CODE rather than of how busy the site happened to be.
--
-- ALL THREE LOG TABLES CARRY THE SAME DEFECT, and two were measurably IN
-- BREACH when this was written. Measured 2026-09-22, before any change:
--
--     counters.arrival_log   107 rows, oldest 2026-09-16,  95 past 48h
--     counters.view_log      139 rows, oldest 2026-09-16, 118 past 48h
--     counters.cta_log         1 row,                       0 past 48h
--
-- cta_log was clean on LUCK ABOUT VOLUME, not on a difference in its code -
-- this site has recorded two CTA clicks in total. A latent breach is what a
-- working campaign turns into a real one, so it is fixed here as well.
--
-- AFTER, measured the same way: 0 / 0 / 0, and 0 of the 3 functions still
-- carry a probabilistic gate (read back from pg_get_functiondef, not from the
-- apply result - an apply reporting success is a claim about the call).
--
-- NO COUNT MOVED. Both aggregate tables were fingerprinted before and after:
--   arrival_sources md5 092347a795e0fe2adae1a2e79dc16d6f, 15 buckets, 107 arrivals
--   page_views      md5 dbe2e5907e2e4304f1e227b0f621281d, 92 slugs,   343 views
-- Each function was then exercised once with an 'ellis-retention-probe' label,
-- the probe rows deleted, and BOTH fingerprints re-read IDENTICAL. The probe is
-- what proves the sweep actually runs; the fingerprint is what proves it cost
-- nothing. A fingerprint alone would have been satisfied by a sweep that never
-- fired.
--
-- NOTHING HERE TOUCHES A COUNT. arrival_sources and cta_clicks are aggregate
-- tables and are not read or written by this migration; the log tables hold
-- salted hashes used only for same-day dedupe, so a row older than today is
-- already functionally dead.

alter table counters.arrival_log add column if not exists source text;

create or replace function public.record_arrival(p_source text)
returns bigint
language plpgsql
security definer
set search_path to 'counters', 'pg_temp'
as $function$
declare
  v_source   text;
  v_day      date := (now() at time zone 'utc')::date;
  v_headers  jsonb;
  v_ip       text;
  v_hash     text;
  v_stored   text;
  v_found    boolean := false;
  v_arrivals bigint;
begin
  -- Normalise source label. Unchanged from the original migration.
  v_source := lower(trim(p_source));
  if v_source is null or v_source = '' then
    v_source := 'unknown';
  elsif v_source !~ '^[a-z0-9][a-z0-9._/-]{0,63}$' then
    raise exception 'invalid source';
  end if;

  v_headers := coalesce(current_setting('request.headers', true), '{}')::jsonb;

  v_ip := coalesce(
    v_headers ->> 'cf-connecting-ip',
    split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1),
    ''
  );
  if v_ip = '' then
    v_ip := 'unknown';
  end if;

  v_hash := encode(
    extensions.digest(
      v_ip || ':' || (select value from counters.config where key = 'ip_salt'),
      'sha256'
    ),
    'hex'
  );

  -- Retention, UNCONDITIONAL. See the header: the probabilistic gate this
  -- replaces meant the stated 48 hours was never honoured in practice.
  delete from counters.arrival_log where last_seen < now() - interval '48 hours';

  -- Has this visitor already been counted today, and under what label?
  -- The row is locked so two concurrent arrivals cannot both upgrade it and
  -- decrement the same bucket twice.
  select source, true into v_stored, v_found
  from counters.arrival_log
  where ip_hash = v_hash and day = v_day
  for update;

  if v_found then
    -- Already counted. The ONLY thing that may happen now is an upgrade from an
    -- unnamed label to a named one. Everything else returns the current reading
    -- and writes nothing.
    if v_stored in ('direct', 'on-site')
       and v_source not in ('direct', 'on-site', 'unknown')
       and v_source is distinct from v_stored
    then
      -- Move the count. Decrement first, floored at zero so a swept or
      -- hand-edited bucket can never go negative.
      update counters.arrival_sources
         set arrivals = greatest(arrivals - 1, 0)
       where day = v_day and source = v_stored;

      insert into counters.arrival_sources (day, source, arrivals)
      values (v_day, v_source, 1)
      on conflict (day, source) do update
        set arrivals = counters.arrival_sources.arrivals + 1
      returning arrivals into v_arrivals;

      update counters.arrival_log
         set source = v_source, last_seen = now()
       where ip_hash = v_hash and day = v_day;

      return v_arrivals;
    end if;

    update counters.arrival_log
       set last_seen = now()
     where ip_hash = v_hash and day = v_day;

    return coalesce(
      (select arrivals from counters.arrival_sources
        where day = v_day and source = v_source), 0);
  end if;

  -- First arrival of the day for this visitor. The label is now STORED, which
  -- is what makes a later upgrade possible at all.
  insert into counters.arrival_log (ip_hash, day, last_seen, source)
  values (v_hash, v_day, now(), v_source)
  on conflict (ip_hash, day) do update
    set last_seen = now();

  insert into counters.arrival_sources (day, source, arrivals)
  values (v_day, v_source, 1)
  on conflict (day, source) do update
    set arrivals = counters.arrival_sources.arrivals + 1
  returning arrivals into v_arrivals;

  return v_arrivals;
end;
$function$;

revoke all on function public.record_arrival(text) from public;
grant execute on function public.record_arrival(text) to anon;

comment on column counters.arrival_log.source is
  'The label this visitor was counted under today. Present so an unnamed arrival (direct/on-site) can be UPGRADED to a named campaign without double counting. NULL means the row predates the upgrade rule and can never upgrade.';

-- UNDO - restores the pre-upgrade behaviour without losing any count:
--   re-apply 20260916_arrival_source_counter.sql's record_arrival definition,
--   then, optionally:
--     alter table counters.arrival_log drop column source;
--   Dropping the column is safe: it holds no aggregate, only the label used to
--   decide an upgrade. The counts live in counters.arrival_sources.

-- (The block below is 20260917's own verification record, carried forward
-- unchanged because it still describes the upgrade logic, which this
-- migration does not touch.)
-- VERIFIED ON THE LIVE DATABASE, 2026-09-17, as a discriminating set with a
-- positive control - and the negative cases are the load-bearing ones, because
-- a rule that upgrades everything satisfies case A perfectly.
--
--   A  direct -> instagram/x            UPGRADED     x=1   (want 1)
--   B  instagram/y -> direct -> on-site KEPT         y=1   (want 1)
--   C  instagram/p -> instagram/q       FIRST KEPT   p=1   (want 1)
--   C                                   SECOND NONE  q=0   (want 0)
--   INVARIANT sum(arrivals) = distinct arrival_log rows   8 = 8
--
-- Test rows were then deleted and counters.arrival_sources compared against a
-- snapshot taken BEFORE the test: 0 rows differing, invariant back to 5 = 5.
-- The snapshot was asserted NON-EMPTY in the same query, so "0 differing" could
-- not have come from comparing two empty sets.
--
-- WHAT IS NOT GATED, SAID PLAINLY: this repo has no committed harness that can
-- reach the database, so the checks above were run by hand once and nothing
-- re-runs them. A future change to record_arrival will not go red. That is a
-- real gap, not a formality - it is recorded here rather than implied to be
-- covered.


-- ===================================================================
-- counters.cta_log - same fix, derived from 20260905_cta_click_counter.sql
-- with ONLY the sweep block changed. Everything else - the 24h cooldown, the
-- 60/hour cap, the slug and cta validation - is carried forward byte-exact.
-- ===================================================================

create or replace function public.record_cta_click(p_slug text, p_cta text)
returns bigint
language plpgsql
security definer
set search_path to 'counters', 'pg_temp'
as $function$
declare
  c_cooldown   constant interval := interval '24 hours';
  c_hourly_cap constant int      := 60;

  v_slug     text;
  v_cta      text;
  v_headers  jsonb;
  v_ip       text;
  v_hash     text;
  v_recent   int;
  v_existing timestamptz;
  v_clicks   bigint;
begin
  v_slug := trim(p_slug);
  v_cta  := trim(p_cta);

  if v_slug is null or v_slug !~ '^[a-z0-9]([a-z0-9-]{0,98}[a-z0-9])?$' then
    raise exception 'invalid slug';
  end if;
  -- The CTA name is a fixed vocabulary the page chooses, not free text.
  if v_cta is null or v_cta !~ '^[a-z][a-z0-9_-]{0,31}$' then
    raise exception 'invalid cta';
  end if;

  v_headers := coalesce(current_setting('request.headers', true), '{}')::jsonb;

  -- Cloudflare overwrites cf-connecting-ip at its edge, so a client cannot
  -- forge it. A missing IP falls into a shared bucket - fail closed, not open.
  v_ip := coalesce(
    v_headers ->> 'cf-connecting-ip',
    split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1),
    ''
  );
  if v_ip = '' then
    v_ip := 'unknown';
  end if;

  -- Raw IPs are never stored. Same salt as the view counter, so one visitor is
  -- the same visitor on both sides of the funnel.
  v_hash := encode(
    extensions.digest(
      v_ip || ':' || (select value from counters.config where key = 'ip_salt'),
      'sha256'
    ),
    'hex'
  );

  -- Opportunistic cleanup; the log only needs to cover the cooldown window.
  -- Retention, UNCONDITIONAL. cta_log was NOT in breach when this was written
  -- (1 row, 0 stale) - but only because the site has recorded two CTA clicks in
  -- total. Same code defect as the other two; different amount of luck.
  delete from counters.cta_log where last_seen < now() - interval '48 hours';

  select last_seen into v_existing
  from counters.cta_log
  where ip_hash = v_hash and slug = v_slug and cta = v_cta;

  -- Already counted this visitor on this CTA recently: report, do not inflate.
  if v_existing is not null and v_existing > now() - c_cooldown then
    return coalesce((select clicks from counters.cta_clicks
                     where slug = v_slug and cta = v_cta), 0);
  end if;

  select count(*) into v_recent
  from counters.cta_log
  where ip_hash = v_hash and last_seen > now() - interval '1 hour';

  if v_recent >= c_hourly_cap then
    return coalesce((select clicks from counters.cta_clicks
                     where slug = v_slug and cta = v_cta), 0);
  end if;

  insert into counters.cta_log (ip_hash, slug, cta, last_seen)
  values (v_hash, v_slug, v_cta, now())
  on conflict (ip_hash, slug, cta) do update set last_seen = now();

  insert into counters.cta_clicks (slug, cta, clicks, updated_at)
  values (v_slug, v_cta, 1, now())
  on conflict (slug, cta) do update
    set clicks = counters.cta_clicks.clicks + 1,
        updated_at = now()
  returning clicks into v_clicks;

  return v_clicks;
end;
$function$;


-- ===================================================================
-- counters.view_log - same fix.
--
-- ⚠️ AND THIS FUNCTION HAD NO COMMITTED MIGRATION AT ALL. Measured 2026-09-22:
-- `increment_page_view`, `counters.page_views` and `counters.view_log` are
-- referenced by two migrations in this repo and DEFINED by none. The site's
-- busiest counter - 343 views across 92 slugs, against 107 arrivals and 2 CTA
-- clicks - existed only inside the live database, while every counter beside
-- it carries a file claiming to be the source of truth. So a reader auditing
-- this directory would have concluded, reasonably, that they had seen all of
-- it. The body below is the LIVE definition read back from pg_get_functiondef
-- on 2026-09-22 with only the sweep block changed, so this file now records
-- what is actually deployed rather than what anybody remembers.
-- ===================================================================

create or replace function public.increment_page_view(p_slug text)
returns bigint
language plpgsql
security definer
set search_path to 'counters', 'pg_temp'
as $function$
declare
  -- One counted view per visitor per article per day.
  c_cooldown     constant interval := interval '24 hours';
  -- Ceiling on how many distinct articles one visitor can count per hour,
  -- so nobody can walk the whole blog on repeat.
  c_hourly_cap   constant int      := 30;

  v_slug     text;
  v_headers  jsonb;
  v_ip       text;
  v_hash     text;
  v_recent   int;
  v_existing timestamptz;
  v_views    bigint;
begin
  v_slug := trim(p_slug);

  if v_slug is null or v_slug !~ '^[a-z0-9]([a-z0-9-]{0,98}[a-z0-9])?$' then
    raise exception 'invalid slug';
  end if;

  v_headers := coalesce(current_setting('request.headers', true), '{}')::jsonb;

  -- Cloudflare overwrites cf-connecting-ip at its edge, so a client cannot
  -- forge it. Fall back to a shared "unknown" bucket rather than failing open.
  v_ip := coalesce(
    v_headers ->> 'cf-connecting-ip',
    split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1),
    ''
  );
  if v_ip = '' then
    v_ip := 'unknown';
  end if;

  v_hash := encode(
    extensions.digest(
      v_ip || ':' || (select value from counters.config where key = 'ip_salt'),
      'sha256'
    ),
    'hex'
  );

  -- Retention, UNCONDITIONAL. Measured 2026-09-22: under the probabilistic gate
  -- this replaces, view_log held 139 rows going back six days, 118 of them past
  -- the 48 hours this line claims. Safe to run every call: the table is bounded
  -- by 48h of views, and neither the 24h cooldown nor the 1h burst cap reads
  -- anything older, so nothing downstream can notice the deletion.
  delete from counters.view_log where last_seen < now() - interval '48 hours';

  select last_seen into v_existing
  from counters.view_log
  where ip_hash = v_hash and slug = v_slug;

  -- Already counted recently: report the current total without incrementing.
  if v_existing is not null and v_existing > now() - c_cooldown then
    return coalesce((select views from counters.page_views where slug = v_slug), 0);
  end if;

  select count(*) into v_recent
  from counters.view_log
  where ip_hash = v_hash and last_seen > now() - interval '1 hour';

  -- Burst cap tripped: still return a number so the UI renders normally.
  if v_recent >= c_hourly_cap then
    return coalesce((select views from counters.page_views where slug = v_slug), 0);
  end if;

  insert into counters.view_log (ip_hash, slug, last_seen)
  values (v_hash, v_slug, now())
  on conflict (ip_hash, slug) do update set last_seen = now();

  insert into counters.page_views (slug, views, updated_at)
  values (v_slug, 1, now())
  on conflict (slug) do update
    set views = counters.page_views.views + 1,
        updated_at = now()
  returning views into v_views;

  return v_views;
end;
$function$;

-- UNDO, per function: re-apply the migration it came from
--   record_arrival      -> 20260917_arrival_source_upgrade.sql
--   record_cta_click    -> 20260905_cta_click_counter.sql
--   increment_page_view -> no earlier file exists; restore the probabilistic
--                          form by wrapping its delete in `if random() < 0.01`.
-- Each restores the previous behaviour exactly and moves no count.
