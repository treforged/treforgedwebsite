-- Lets a NAMED campaign claim a visitor already recorded as an unnamed arrival.
-- Applied to the treforged-site project (zyvqoefbgsgkbdoydopt) on 2026-09-17.
-- Extends 20260916_arrival_source_counter.sql. This is Ellis's database.
--
-- THE DEFECT, raised by Ruby (ask d6f9315a) against a decision this desk had
-- deliberately made and written down. Both halves were right, which is why the
-- fix is neither of the two obvious ones.
--
-- As built, counters.arrival_log keys on (ip_hash, day) with NO source column,
-- so a visitor is attributed ONCE PER DAY to whichever route they arrived by
-- FIRST. Somebody who lands direct in the morning and follows a tagged campaign
-- link that afternoon is recorded as `direct` for ever, and the campaign gets
-- no credit. THAT IS EXACTLY THE CASE WHERE A CAMPAIGN IS WORKING. It also
-- means a TEST of a new link from an IP that already hit the site that day
-- writes nothing at all - so the instrument is silent precisely when somebody
-- is checking whether it works.
--
-- AND THE ORIGINAL REASON WAS NOT WRONG. Keying on (ip_hash, day, source) would
-- record the real campaign AND a spurious `direct` for the same person, because
-- page two of a visit carries no query string. That inflates `direct`, which is
-- the bucket that already absorbs everything unexplained.
--
-- SO: AN UPGRADE, NEVER A SECOND COUNT. An arrival stored as `direct` or
-- `on-site` may be REPLACED by a named source. A named source is never replaced
-- - not by `direct`, not by `on-site`, not by another campaign. The count MOVES
-- between buckets; it is never added. The invariant that must hold, and which
-- the gate asserts: for any day, the sum of arrivals across all sources equals
-- the number of distinct ip_hash rows for that day.
--
-- WHY FIRST-NAMED-WINS RATHER THAN LAST: a visitor who arrives by one campaign
-- and later by another is a real ambiguity with no correct answer, and first
-- touch is the one that can be defended - it is the route that actually brought
-- them to the site that day. Last touch would let an on-site link rewrite a
-- campaign's credit the moment the query string reappears.
--
-- A NULL STORED SOURCE NEVER UPGRADES. Rows written before this migration have
-- no recorded source, so there is no bucket to decrement and an upgrade would
-- invent a count. Those visitors keep their original attribution for the rest
-- of their day. At most 48 hours of rows are affected, because arrival_log is
-- swept on that window - stated rather than left to be discovered.

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

  if random() < 0.01 then
    delete from counters.arrival_log where last_seen < now() - interval '48 hours';
  end if;

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
