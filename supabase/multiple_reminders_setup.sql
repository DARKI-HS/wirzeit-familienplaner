-- Einmal im Supabase SQL Editor ausführen.
-- Ermöglicht Terminbearbeitung, Löschen und mehrere Erinnerungen pro Termin.

alter table public.events add column if not exists reminder_offsets integer[];
update public.events
set reminder_offsets = array[reminder_minutes]
where reminder_offsets is null or cardinality(reminder_offsets) = 0;
alter table public.events alter column reminder_offsets set default array[30];
alter table public.events alter column reminder_offsets set not null;
alter table public.events drop constraint if exists events_reminder_offsets_check;
alter table public.events add constraint events_reminder_offsets_check check (
  cardinality(reminder_offsets) between 1 and 6
  and reminder_offsets <@ array[0,5,15,30,60,1440]
);

alter table public.reminder_deliveries
add column if not exists reminder_minutes integer not null default 30;
alter table public.reminder_deliveries drop constraint if exists reminder_deliveries_pkey;
alter table public.reminder_deliveries
add primary key (event_id, profile_id, reminder_minutes);

drop policy if exists "family events write" on public.events;
drop policy if exists "family events insert" on public.events;
drop policy if exists "family events update" on public.events;
drop policy if exists "family events delete" on public.events;
create policy "family events insert" on public.events for insert to authenticated
with check (family_id=public.my_family_id() and created_by=auth.uid());
create policy "family events update" on public.events for update to authenticated
using (family_id=public.my_family_id()) with check (family_id=public.my_family_id());
create policy "family events delete" on public.events for delete to authenticated
using (family_id=public.my_family_id());

create or replace function public.reset_event_reminder_deliveries()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  delete from public.reminder_deliveries where event_id = new.id;
  return new;
end;
$$;
drop trigger if exists reset_event_reminders_after_update on public.events;
create trigger reset_event_reminders_after_update
after update of starts_at, reminder_offsets on public.events
for each row execute function public.reset_event_reminder_deliveries();

drop function if exists public.claim_due_reminders();
create function public.claim_due_reminders()
returns table (
  event_id uuid,
  profile_id uuid,
  reminder_minutes integer,
  title text,
  starts_at timestamptz,
  location text
)
language plpgsql security definer set search_path=public as $$
begin
  return query
  with candidates as (
    select e.id as event_id, er.profile_id, reminder.minutes as reminder_minutes,
           e.title, e.starts_at, e.location
    from public.events e
    join public.event_recipients er on er.event_id=e.id
    cross join lateral unnest(e.reminder_offsets) as reminder(minutes)
    where e.starts_at >= now() - interval '5 minutes'
      and e.starts_at - make_interval(mins => reminder.minutes) <= now()
  ), claimed as (
    insert into public.reminder_deliveries as delivery
      (event_id, profile_id, reminder_minutes)
    select candidate.event_id, candidate.profile_id, candidate.reminder_minutes
    from candidates candidate
    on conflict do nothing
    returning delivery.event_id, delivery.profile_id, delivery.reminder_minutes
  )
  select candidate.event_id, candidate.profile_id, candidate.reminder_minutes,
         candidate.title, candidate.starts_at, candidate.location
  from candidates candidate join claimed
    on claimed.event_id=candidate.event_id
   and claimed.profile_id=candidate.profile_id
   and claimed.reminder_minutes=candidate.reminder_minutes;
end;
$$;
revoke all on function public.claim_due_reminders() from public,anon,authenticated;
grant execute on function public.claim_due_reminders() to service_role;
