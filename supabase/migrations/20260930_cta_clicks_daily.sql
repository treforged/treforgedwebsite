-- 20260930 - CTA clicks PER DAY, added beside the all-time totals.
-- Ellis, 2026-09-30, approved by Sam the same day.
--
-- WHY. counters.cta_clicks holds (slug, cta, clicks) with no date, so no
-- funnel question with a window - "clicks in the last 30 days" - could be
-- answered. Ruby's 0-signup funnel ask (ddf14fb9) hit exactly that wall.
-- arrival_sources already counts per day, so this puts clicks on the same key.
--
-- ADDITIVE, AND HOW THAT IS PROVEN:
--  * counters.cta_clicks is NOT touched. Every existing reader keeps working.
--  * record_cta_click gains ONE insert, placed right after the all-time
--    upsert, so it runs on exactly the path that increments the total - never
--    on the cooldown or hourly-cap early returns.
--  * The function is rewritten FROM ITS LIVE DEFINITION, not from a file. The
--    20260922 file's comments already differ from what is deployed, so
--    restating it would silently change the live text. The block below asserts
--    the anchor occurs exactly once, and that the new definition with the
--    inserted text removed equals the old definition byte for byte.
--
-- NOT BACKFILLED. The 5 clicks recorded before today have no date and cannot
-- be split honestly. Per-day counting starts on the day this is applied, so a
-- day before that is an ABSENCE in cta_clicks_daily, never a zero.
--
-- UNDO (run in this order):
--   do $$ declare d text := pg_get_functiondef('public.record_cta_click(text,text)'::regprocedure);
--   begin execute replace(d, <the v_daily block below>, ''); end $$;
--   drop table counters.cta_clicks_daily;
-- Or simply re-run the record_cta_click section of 20260922_counter_retention_fix.sql
-- (behaviourally identical; only its comments differ from the pre-change live text).

create table if not exists counters.cta_clicks_daily (
  day    date   not null,
  slug   text   not null,
  cta    text   not null,
  clicks bigint not null default 0,
  primary key (day, slug, cta)
);
alter table counters.cta_clicks_daily enable row level security;
revoke all on counters.cta_clicks_daily from public, anon, authenticated;

do $$
declare
  v_anchor constant text := E'  returning clicks into v_clicks;\n';
  v_daily  constant text :=
    E'\n  -- Per-day count (20260930). Same path as the all-time total above.\n'
    || E'  insert into counters.cta_clicks_daily (day, slug, cta, clicks)\n'
    || E'  values ((now() at time zone ''utc'')::date, v_slug, v_cta, 1)\n'
    || E'  on conflict (day, slug, cta) do update\n'
    || E'    set clicks = counters.cta_clicks_daily.clicks + 1;\n';
  v_old text := pg_get_functiondef('public.record_cta_click(text,text)'::regprocedure);
  v_new text;
begin
  if position(v_daily in v_old) > 0 then
    raise notice 'record_cta_click already carries the per-day insert; nothing to do';
    return;
  end if;
  if (length(v_old) - length(replace(v_old, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'anchor must occur exactly once in record_cta_click';
  end if;

  v_new := replace(v_old, v_anchor, v_anchor || v_daily);
  if replace(v_new, v_daily, '') <> v_old then
    raise exception 'the rewrite is not purely additive';
  end if;

  execute v_new;

  if position(v_daily in pg_get_functiondef('public.record_cta_click(text,text)'::regprocedure)) = 0 then
    raise exception 'record_cta_click read back without the per-day insert';
  end if;
end;
$$;
