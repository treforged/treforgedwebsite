-- SOURCE OF TRUTH for the Forgenta CTA click counter.
-- Applied to the treforged-site project (zyvqoefbgsgkbdoydopt) on 2026-09-05.
-- This is Ellis's database. Never apply it anywhere else without asking that
-- desk first - that lesson is already recorded in this repo's handoff.
--
-- WHY IT EXISTS: the blog carried a Forgenta CTA on every post from the first
-- day and nobody could tell whether one reader had ever pressed it. "The blog
-- gets views" and "the blog sends people to the app" were the same unanswered
-- question, so more traffic and a better CTA looked like the same fix.
--
-- It mirrors increment_page_view deliberately: same salt, same 24h per-visitor
-- cooldown, same shape of burst cap. Both sides count DISTINCT VISITORS per 24h,
-- so views and clicks share a denominator. A ratio built from two different
-- denominators would be worse than no ratio at all - it would read as a
-- measurement while being an artefact.

create table if not exists counters.cta_clicks (
  slug       text        not null,
  cta        text        not null,
  clicks     bigint      not null default 0,
  updated_at timestamptz not null default now(),
  primary key (slug, cta)
);
-- RLS on with zero policies is the second layer. The first is that the counters
-- schema is not in PostgREST's exposed list, so the table is unreachable over
-- REST whatever the grants say (verified: PGRST205).
alter table counters.cta_clicks enable row level security;

create table if not exists counters.cta_log (
  ip_hash   text        not null,
  slug      text        not null,
  cta       text        not null,
  last_seen timestamptz not null default now(),
  primary key (ip_hash, slug, cta)
);
alter table counters.cta_log enable row level security;

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
  if random() < 0.01 then
    delete from counters.cta_log where last_seen < now() - interval '48 hours';
  end if;

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

revoke all on function public.record_cta_click(text, text) from public;
grant execute on function public.record_cta_click(text, text) to anon;
