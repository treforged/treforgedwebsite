-- 20260929 - the 48-hour retention promise, kept by the CLOCK instead of by TRAFFIC.
-- Ellis, 2026-09-29, found by the counter-health re-run (ask 41f78f5e).
--
-- 20260922 made each sweep unconditional INSIDE record_arrival,
-- increment_page_view and record_cta_click. That fixed the random() gate but
-- left a second one: a sweep only runs when its function is CALLED. Measured
-- 2026-09-29 05:10 UTC: counters.cta_log held 2 rows, BOTH stale, the oldest
-- 2026-09-26 03:37 (about 75 hours). Nobody had clicked a CTA since, so nothing
-- swept it. The same is true of the other two logs in any quiet stretch.
--
-- The in-function sweeps stay. This job is the floor under them: at worst a
-- row lives 48 hours plus one hour.
--
-- UNDO: select cron.unschedule('counters-retention-48h');

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'counters-retention-48h' limit 1;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end;
$$;

select cron.schedule(
  'counters-retention-48h',
  '7 * * * *',
  $job$
    delete from counters.arrival_log where last_seen < now() - interval '48 hours';
    delete from counters.view_log    where last_seen < now() - interval '48 hours';
    delete from counters.cta_log     where last_seen < now() - interval '48 hours';
  $job$
);
