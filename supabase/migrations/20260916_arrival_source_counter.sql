-- SOURCE OF TRUTH for the site-wide arrival source counter.
-- Applied to the treforged-site project (zyvqoefbgsgkbdoydopt) on 2026-09-16.
-- This is Ellis's database. Never apply it anywhere else without asking that
-- desk first - that lesson is already recorded in this repo's handoff.
--
-- WHY IT EXISTS: on 2026-09-16 the @treforged Instagram bio started pointing at
-- treforged.com with a full UTM string (utm_source=instagram&utm_medium=bio),
-- measured live from the Graph API by Ruby with the query string intact. That
-- account has 12,845 followers, and until that day NEITHER bio had ever pointed
-- at this site - so the first genuinely attributed traffic this site has ever
-- had is arriving now.
--
-- AND NOTHING HERE COULD SEE IT. Measured before building this: the only code
-- on treforged.com that reads utm_source is wlSource() in main.js, which lives
-- inside `if (wlForm)` and therefore exists ONLY on /founders/. The bio link
-- lands on the HOMEPAGE. increment_page_view(p_slug) and
-- record_cta_click(p_slug, p_cta) take no source argument at all - confirmed
-- against pg_proc, not from memory. So a zero from utm_medium=bio would have
-- been an ABSENCE, not a result: exactly the artefact that made "0 CTA clicks"
-- look like a finding for nine days while the homepage was unwired.
--
-- AGGREGATE ONLY, by design. One row per day per source label holding a count.
-- No address, no IP, no user agent, no session id, no page, no path. Nothing in
-- arrival_sources identifies a person. arrival_log holds a SALTED HASH of the
-- IP and nothing else, purely to dedupe, and is swept after 48 hours.
--
-- WHAT IT MEASURES, STATED PLAINLY SO NOBODY OVER-READS IT: distinct IPs per
-- day per arrival source. That is not people. An office, a campus or a mobile
-- carrier behind CGNAT shares one IP, so a busy shared network reads as one
-- arrival - this UNDERCOUNTS, and it undercounts most exactly where a campaign
-- is working. Treat it as a floor and a shape, never as a headcount.
--
-- FIRST ARRIVAL OF THE DAY WINS, and that is deliberate rather than a
-- limitation nobody noticed. A visitor's second page view carries no query
-- string, so a per-source dedupe would record BOTH the real campaign AND a
-- spurious `direct` for the same person - inflating direct and making the
-- attribution worthless. The consequence is the honest one: if somebody visits
-- directly in the morning and follows the Instagram link that afternoon, the
-- afternoon arrival is not counted.
--
-- NO BURST CAP, ON PURPOSE. record_cta_click carries a 60-per-hour cap. Here
-- the dedupe ledger's primary key is (ip_hash, day), so one IP can produce AT
-- MOST ONE arrival per day - which is a far tighter bound than any hourly cap
-- and makes one structurally unreachable. A cap that cannot bind reads as a
-- guarantee while protecting nothing, so it is absent rather than decorative.

create table if not exists counters.arrival_sources (
  day      date   not null default (now() at time zone 'utc')::date,
  source   text   not null,
  arrivals bigint not null default 0,
  primary key (day, source)
);
-- RLS on with zero policies is the second layer. The first is that the counters
-- schema is not in PostgREST's exposed list, so the table is unreachable over
-- REST whatever the grants say.
alter table counters.arrival_sources enable row level security;

create table if not exists counters.arrival_log (
  ip_hash   text        not null,
  day       date        not null default (now() at time zone 'utc')::date,
  last_seen timestamptz not null default now(),
  primary key (ip_hash, day)
);
alter table counters.arrival_log enable row level security;

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
  v_exists   boolean;
  v_arrivals bigint;
begin
  -- Normalise source label
  v_source := lower(trim(p_source));
  if v_source is null or v_source = '' then
    v_source := 'unknown';
  elsif v_source !~ '^[a-z0-9][a-z0-9._/-]{0,63}$' then
    raise exception 'invalid source';
  end if;

  v_headers := coalesce(current_setting('request.headers', true), '{}')::jsonb;

  -- Resolve client IP
  v_ip := coalesce(
    v_headers ->> 'cf-connecting-ip',
    split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1),
    ''
  );
  if v_ip = '' then
    v_ip := 'unknown';
  end if;

  -- Hash IP with project-wide salt
  v_hash := encode(
    extensions.digest(
      v_ip || ':' || (select value from counters.config where key = 'ip_salt'),
      'sha256'
    ),
    'hex'
  );

  -- Opportunistic cleanup of stale log rows
  if random() < 0.01 then
    delete from counters.arrival_log where last_seen < now() - interval '48 hours';
  end if;

  -- Dedupe: one arrival per visitor per day, site-wide
  select true into v_exists
  from counters.arrival_log
  where ip_hash = v_hash and day = v_day
  limit 1;

  if v_exists is true then
    return coalesce(
      (select arrivals from counters.arrival_sources
       where day = v_day and source = v_source), 0);
  end if;

  -- Record the visitor in the dedupe ledger
  insert into counters.arrival_log (ip_hash, day, last_seen)
  values (v_hash, v_day, now())
  on conflict (ip_hash, day) do update set last_seen = now();

  -- Increment aggregate counter for the source
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

-- UNDO
-- drop function if exists public.record_arrival(text);
-- drop table if exists counters.arrival_log;
-- drop table if exists counters.arrival_sources;

comment on table counters.arrival_sources is
  'Aggregate arrivals per day per source label for treforged.com. Distinct IPs, not people - shared networks undercount. Counts only, no personal data, deliberately.';

-- UNDO, in this order:
--   drop function if exists public.record_arrival(text);
--   drop table if exists counters.arrival_log;
--   drop table if exists counters.arrival_sources;
