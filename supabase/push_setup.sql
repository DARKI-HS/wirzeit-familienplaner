-- Einmal im Supabase SQL Editor ausführen.
-- Ergänzt WirZeit um sichere Geräte-Abonnements und einmalige Terminerinnerungen.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions
for all to authenticated
using (profile_id = auth.uid())
with check (profile_id = auth.uid());

create index if not exists push_subscriptions_profile_idx
on public.push_subscriptions(profile_id);

create table if not exists public.reminder_deliveries (
  event_id uuid not null references public.events(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  primary key (event_id, profile_id)
);

alter table public.reminder_deliveries enable row level security;

create or replace function public.claim_due_reminders()
returns table (
  event_id uuid,
  profile_id uuid,
  title text,
  starts_at timestamptz,
  location text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select
      e.id as event_id,
      er.profile_id,
      e.title,
      e.starts_at,
      e.location
    from public.events e
    join public.event_recipients er on er.event_id = e.id
    where e.starts_at >= now() - interval '5 minutes'
      and e.starts_at - make_interval(mins => e.reminder_minutes) <= now()
  ),
  claimed as (
    insert into public.reminder_deliveries as delivery (event_id, profile_id)
    select candidate.event_id, candidate.profile_id
    from candidates candidate
    on conflict do nothing
    returning delivery.event_id, delivery.profile_id
  )
  select
    candidate.event_id,
    candidate.profile_id,
    candidate.title,
    candidate.starts_at,
    candidate.location
  from candidates candidate
  join claimed
    on claimed.event_id = candidate.event_id
   and claimed.profile_id = candidate.profile_id;
end;
$$;

revoke all on function public.claim_due_reminders() from public, anon, authenticated;
grant execute on function public.claim_due_reminders() to service_role;

