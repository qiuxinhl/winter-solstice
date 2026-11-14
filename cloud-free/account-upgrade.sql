-- Incremental migration: preserves existing owner IDs, media paths and messages.
-- Membership is provisioned by the local account setup tool, never by the browser.
begin;
create table if not exists public.couple_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  room_owner_id uuid not null references auth.users(id) on delete restrict,
  author text not null check (author in ('me','partner')),
  unique(room_owner_id,author)
);
alter table public.couple_members enable row level security;
revoke all on public.couple_members from public,anon,authenticated,service_role;
grant select on public.couple_members to authenticated;
drop policy if exists couple_members_self on public.couple_members;
create policy couple_members_self on public.couple_members for select to authenticated
  using (user_id=(select auth.uid()));

create or replace function public.couple_room_owner()
returns uuid language sql stable security definer set search_path='' as $$
  select room_owner_id from public.couple_members where user_id=(select auth.uid())
$$;
create or replace function public.couple_author()
returns text language sql stable security definer set search_path='' as $$
  select author from public.couple_members where user_id=(select auth.uid())
$$;
create or replace function public.couple_current_member()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_member public.couple_members%rowtype;
begin
  select * into v_member from public.couple_members where user_id=(select auth.uid());
  if not found then raise exception using errcode='42501',message='这个账号尚未加入小屋。'; end if;
  return jsonb_build_object('ownerId',v_member.room_owner_id,'identity',v_member.author);
end;
$$;
revoke all on function public.couple_room_owner(),public.couple_author(),public.couple_current_member()
  from public,anon,authenticated,service_role;
grant execute on function public.couple_room_owner(),public.couple_author(),public.couple_current_member() to authenticated;

-- Keep the room's original owner/path. Both personal accounts share its quota.
do $$
declare f record;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
      ('couple_reserve_media','couple_upload_allowed','couple_storage_usage','couple_complete_media','couple_release_media')
  loop
    execute replace(pg_get_functiondef(f.oid),'auth.uid()','public.couple_room_owner()');
  end loop;
end;
$$;
alter table public.couple_messages alter column owner_id set default public.couple_room_owner();
alter table public.couple_settings alter column owner_id set default public.couple_room_owner();
alter table public.couple_media alter column owner_id set default public.couple_room_owner();
alter table public.couple_settings add column if not exists anniversaries jsonb not null default '[]'::jsonb;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.couple_settings'::regclass and conname='couple_settings_anniversaries') then
    alter table public.couple_settings add constraint couple_settings_anniversaries
      check(jsonb_typeof(anniversaries)='array' and jsonb_array_length(anniversaries)<=100 and octet_length(anniversaries::text)<=40000);
  end if;
end; $$;

drop policy if exists couple_messages_owner on public.couple_messages;
drop policy if exists couple_messages_read on public.couple_messages;
drop policy if exists couple_messages_insert on public.couple_messages;
drop policy if exists couple_messages_delete on public.couple_messages;
create policy couple_messages_read on public.couple_messages for select to authenticated
  using(owner_id=(select public.couple_room_owner()));
create policy couple_messages_insert on public.couple_messages for insert to authenticated
  with check(owner_id=(select public.couple_room_owner()) and author=(select public.couple_author()));
create policy couple_messages_delete on public.couple_messages for delete to authenticated
  using(owner_id=(select public.couple_room_owner()) and author=(select public.couple_author()));
revoke update on public.couple_messages from authenticated;
drop policy if exists couple_media_owner on public.couple_media;
create policy couple_media_owner on public.couple_media for select to authenticated
  using(owner_id=(select public.couple_room_owner()));
drop policy if exists couple_settings_owner on public.couple_settings;
create policy couple_settings_owner on public.couple_settings for all to authenticated
  using(owner_id=(select public.couple_room_owner()))
  with check(owner_id=(select public.couple_room_owner()));

-- The browser cannot write a message under the other person's name.
create or replace function public.couple_stamp_message_author()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.author := public.couple_author();
  new.owner_id := public.couple_room_owner();
  if new.author is null or new.owner_id is null then
    raise exception using errcode='42501',message='请使用自己的账号登录。';
  end if;
  return new;
end;
$$;
revoke all on function public.couple_stamp_message_author() from public,anon,authenticated,service_role;
drop trigger if exists couple_message_author on public.couple_messages;
create trigger couple_message_author before insert on public.couple_messages
  for each row execute function public.couple_stamp_message_author();

drop policy if exists couple_private_select on storage.objects;
drop policy if exists couple_private_insert on storage.objects;
drop policy if exists couple_private_delete on storage.objects;
create policy couple_private_select on storage.objects for select to authenticated
  using(bucket_id='couple-private' and (storage.foldername(name))[1]=(select public.couple_room_owner())::text);
create policy couple_private_insert on storage.objects for insert to authenticated
  with check(bucket_id='couple-private' and (storage.foldername(name))[1]=(select public.couple_room_owner())::text
    and public.couple_upload_allowed(name,metadata));
create policy couple_private_delete on storage.objects for delete to authenticated
  using(bucket_id='couple-private' and (storage.foldername(name))[1]=(select public.couple_room_owner())::text);
notify pgrst,'reload schema';
commit;
