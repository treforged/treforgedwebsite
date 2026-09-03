-- Landing-page views per arm for the founder reachability test.
-- Applied to the Forgenta Supabase project (mdtosrbfkextcaezuclh) on 2026-09-03.
--
-- THIS FILE IS THE SOURCE OF TRUTH, same arrangement as
-- 20260903_founder_waitlist.sql. If it changes here, tell Ada to re-copy.
--
-- Why it exists: founder_waitlist counts SIGNUPS. On its own it cannot separate
-- "nobody came" from "people came and did not sign up", and those are opposite
-- conclusions - the first means the test never ran, the second is the demand
-- answer. This is the denominator that tells them apart.
--
-- AGGREGATE ONLY, by design. One row per day per source holding a count. No
-- address, no IP, no user agent, no session id - nothing here identifies a
-- person, so this adds no personal data to the system.

create table if not exists public.founder_page_views (
  day     date not null default (now() at time zone 'utc')::date,
  source  text not null,
  views   integer not null default 0,
  primary key (day, source)
);

alter table public.founder_page_views enable row level security;
revoke all on public.founder_page_views from anon, authenticated;

-- Increment is a function because supabase-js cannot express "add one" in an
-- upsert. SECURITY DEFINER with a pinned search_path; EXECUTE is revoked from
-- the public roles, so only the service role (the edge function) can call it.
create or replace function public.bump_founder_view(p_source text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.founder_page_views (day, source, views)
  values ((now() at time zone 'utc')::date, p_source, 1)
  on conflict (day, source) do update set views = founder_page_views.views + 1;
$$;

revoke all on function public.bump_founder_view(text) from public, anon, authenticated;

comment on table public.founder_page_views is
  'Aggregate landing-page views per day per source for treforged.com/founders/. The denominator for the reachability experiment. Counts only - no personal data, deliberately.';
