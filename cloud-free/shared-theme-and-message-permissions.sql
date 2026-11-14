-- Incremental and repeatable; no existing photos, letters, messages or accounts change.
begin;
create table if not exists public.couple_theme (
  owner_id uuid primary key default public.couple_room_owner() references auth.users(id) on delete cascade,
  solar_term text not null default '' check (solar_term in ('','立春','雨水','惊蛰','春分','清明','谷雨','立夏','小满','芒种','夏至','小暑','大暑','立秋','处暑','白露','秋分','寒露','霜降','立冬','小雪','大雪','冬至','小寒','大寒'))
);
alter table public.couple_theme enable row level security;
revoke all on public.couple_theme from public,anon,authenticated,service_role;
grant select,insert,update on public.couple_theme to authenticated;
drop policy if exists couple_theme_members on public.couple_theme;
create policy couple_theme_members on public.couple_theme for all to authenticated
  using(owner_id=(select public.couple_room_owner()))
  with check(owner_id=(select public.couple_room_owner()));

drop policy if exists couple_messages_delete on public.couple_messages;
create policy couple_messages_delete on public.couple_messages for delete to authenticated
  using(owner_id=(select public.couple_room_owner()) and author=(select public.couple_author()));
-- Also constrain any additional permissive delete policy that may exist.
drop policy if exists couple_messages_delete_self on public.couple_messages;
create policy couple_messages_delete_self on public.couple_messages as restrictive for delete to authenticated
  using(owner_id=(select public.couple_room_owner()) and author=(select public.couple_author()));
commit;
