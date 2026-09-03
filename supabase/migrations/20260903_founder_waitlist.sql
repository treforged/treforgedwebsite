-- Founder waitlist for the startup-OS product test (treforged.com/founders/).
-- Applied to the Forgenta Supabase project (mdtosrbfkextcaezuclh) on 2026-09-03.
--
-- Deliberately separate from newsletter_subscribers: different audience, different
-- list, and the experiment's result is this table's row count on its own.
-- No anon policies and no anon grants. The founder-waitlist edge function writes
-- with the service role, so an address can never be read back over PostgREST.

create table if not exists public.founder_waitlist (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null,
  source             text not null default 'treforged.com/founders',
  created_at         timestamptz not null default now(),
  unsubscribed_at    timestamptz,
  unsubscribe_token  text not null default encode(extensions.gen_random_bytes(24), 'hex')
);

create unique index if not exists founder_waitlist_email_key
  on public.founder_waitlist (lower(email));

create unique index if not exists founder_waitlist_token_key
  on public.founder_waitlist (unsubscribe_token);

alter table public.founder_waitlist enable row level security;

-- Defence in depth. RLS with no policies already returns nothing, but leaving the
-- table reachable over PostgREST at all is surface we do not need.
revoke all on public.founder_waitlist from anon, authenticated;

comment on table public.founder_waitlist is
  'Startup-OS waitlist signups from treforged.com/founders/. RLS on with NO policies: only the service role (founder-waitlist edge function) may read or write. Addresses are personal data - never log them.';
