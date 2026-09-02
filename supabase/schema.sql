-- Im Supabase SQL Editor ausführen, nachdem Auth eingerichtet ist.
create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  login_name text not null unique check (login_name = lower(trim(login_name))),
  display_name text not null,
  role text not null default 'child' check (role in ('adult', 'child')),
  created_at timestamptz not null default now()
);
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  title text not null check (char_length(title) between 1 and 120),
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  assignee_id uuid references public.profiles(id),
  reminder_minutes integer not null default 30 check (reminder_minutes between 0 and 10080),
  updated_at timestamptz not null default now()
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
alter table public.profiles
add column if not exists role text not null default 'child' check (role in ('adult', 'child'));
create table if not exists public.event_recipients (
  event_id uuid not null references public.events(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  primary key (event_id, profile_id)
);
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
alter table public.families enable row level security;
alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.messages enable row level security;
alter table public.event_recipients enable row level security;
alter table public.push_subscriptions enable row level security;
create or replace function public.my_family_id()
returns uuid language sql stable security definer set search_path=public
as $$ select family_id from public.profiles where id=auth.uid() $$;
create or replace function public.is_family_adult()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='adult') $$;
drop policy if exists "family read" on public.families;
drop policy if exists "family profiles" on public.profiles;
drop policy if exists "family events read" on public.events;
drop policy if exists "family events write" on public.events;
drop policy if exists "family messages read" on public.messages;
drop policy if exists "family messages write" on public.messages;
drop policy if exists "adult messages delete" on public.messages;
drop policy if exists "family event recipients" on public.event_recipients;
drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "family read" on public.families for select to authenticated using (id=public.my_family_id());
create policy "family profiles" on public.profiles for select to authenticated using (family_id=public.my_family_id());
create policy "family events read" on public.events for select to authenticated using (family_id=public.my_family_id());
create policy "family events write" on public.events for all to authenticated using (family_id=public.my_family_id()) with check (family_id=public.my_family_id() and created_by=auth.uid());
create policy "family messages read" on public.messages for select to authenticated using (family_id=public.my_family_id());
create policy "family messages write" on public.messages for insert to authenticated with check (family_id=public.my_family_id() and author_id=auth.uid());
create policy "adult messages delete" on public.messages for delete to authenticated using (family_id=public.my_family_id() and public.is_family_adult());
create policy "family event recipients" on public.event_recipients for all to authenticated
using (exists(select 1 from public.events where events.id=event_id and events.family_id=public.my_family_id()))
with check (exists(select 1 from public.events where events.id=event_id and events.family_id=public.my_family_id()) and exists(select 1 from public.profiles where profiles.id=profile_id and profiles.family_id=public.my_family_id()));
create policy "own push subscriptions" on public.push_subscriptions for all to authenticated
using (profile_id=auth.uid()) with check (profile_id=auth.uid());
create index if not exists events_family_starts_idx on public.events(family_id,starts_at);
create index if not exists messages_family_created_idx on public.messages(family_id,created_at desc);
create index if not exists event_recipients_profile_idx on public.event_recipients(profile_id,event_id);
create index if not exists push_subscriptions_profile_idx on public.push_subscriptions(profile_id);

create table if not exists public.reminder_deliveries (
  event_id uuid not null references public.events(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  primary key (event_id, profile_id)
);
alter table public.reminder_deliveries enable row level security;
create or replace function public.claim_due_reminders()
returns table (event_id uuid, profile_id uuid, title text, starts_at timestamptz, location text)
language plpgsql security definer set search_path=public
as $$
begin
  return query
  with candidates as (
    select e.id as event_id, er.profile_id, e.title, e.starts_at, e.location
    from public.events e
    join public.event_recipients er on er.event_id=e.id
    where e.starts_at >= now() - interval '5 minutes'
      and e.starts_at - make_interval(mins => e.reminder_minutes) <= now()
  ), claimed as (
    insert into public.reminder_deliveries as delivery (event_id,profile_id)
    select candidate.event_id,candidate.profile_id from candidates candidate
    on conflict do nothing
    returning delivery.event_id,delivery.profile_id
  )
  select candidate.event_id,candidate.profile_id,candidate.title,candidate.starts_at,candidate.location
  from candidates candidate join claimed
    on claimed.event_id=candidate.event_id and claimed.profile_id=candidate.profile_id;
end;
$$;
revoke all on function public.claim_due_reminders() from public,anon,authenticated;
grant execute on function public.claim_due_reminders() to service_role;
