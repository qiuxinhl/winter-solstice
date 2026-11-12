-- Fresh Supabase project only. Run once through the SQL editor/Management API.
-- No public room password, management token, API secret, or sample business data.
begin;

create table public.couple_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author text not null check (author in ('me', 'partner')),
  text text not null check (char_length(text) between 1 and 1000 and btrim(text) <> ''),
  created_at timestamptz not null default now()
);
create index couple_messages_owner_created_idx
  on public.couple_messages (owner_id, created_at desc);

create table public.couple_media (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  path text not null unique,
  name text not null check (char_length(name) between 1 and 255),
  type text not null check (char_length(type) <= 127 and type ~ '^(image|video)/[A-Za-z0-9.+-]+$'),
  size bigint not null check (size between 1 and 50000000),
  status text not null default 'uploading' check (status in ('uploading', 'ready')),
  created_at timestamptz not null default now(),
  constraint couple_media_owned_path check (path = owner_id::text || '/' || id::text)
);
create index couple_media_owner_status_created_idx
  on public.couple_media (owner_id, status, created_at desc);

create table public.couple_settings (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  me text not null default '我' check (char_length(me) between 1 and 12 and btrim(me) <> ''),
  partner text not null default '你' check (char_length(partner) between 1 and 12 and btrim(partner) <> ''),
  start_date text not null default '' check (start_date = '' or start_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);

alter table public.couple_messages enable row level security;
alter table public.couple_media enable row level security;
alter table public.couple_settings enable row level security;

create policy couple_messages_owner on public.couple_messages
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy couple_media_owner on public.couple_media
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy couple_settings_owner on public.couple_settings
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- In particular, direct media INSERT/UPDATE/DELETE cannot bypass reservations.
revoke all on table public.couple_messages, public.couple_media, public.couple_settings
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.couple_messages, public.couple_settings
  to authenticated;
grant select on public.couple_media to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('couple-private', 'couple-private', false, 50000000, array['image/*', 'video/*']);

-- Storage owns and already enables RLS on this managed table. Do not change its owner.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity
  ) then
    raise exception 'Storage RLS must already be enabled';
  end if;
end;
$$;

create function public.couple_reserve_media(p_name text, p_type text, p_size bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid := gen_random_uuid();
  v_total bigint;
  v_path text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = '请先登录小屋。';
  end if;
  if p_name is null or char_length(p_name) not between 1 and 255
     or p_type is null or char_length(p_type) > 127
     or p_type !~ '^(image|video)/[A-Za-z0-9.+-]+$'
     or p_size is null or p_size < 1 or p_size > 50000000 then
    raise exception using errcode = '22023', message = '请选择不超过50MB的照片或视频。';
  end if;
  -- Same key in reserve, completion, release, and the Storage INSERT guard.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  select coalesce(sum(m.size), 0) into v_total
    from public.couple_media m where m.owner_id = v_uid;
  if v_total + p_size > 900000000 then
    raise exception using errcode = 'P0001', message = '小屋免费空间不足，请先删除一些照片或视频。';
  end if;
  v_path := v_uid::text || '/' || v_id::text;
  insert into public.couple_media (id, owner_id, path, name, type, size, status)
    values (v_id, v_uid, v_path, p_name, p_type, p_size, 'uploading');
  return jsonb_build_object('id', v_id, 'path', v_path, 'partSize', 50000000);
end;
$$;

-- Storage may run a pre-upload permission probe with contentLength, or without
-- metadata. Its final insert supplies trusted metadata.size. Reject mismatches
-- whenever a size is available; never trust user_metadata for capacity checks.
create function public.couple_upload_allowed(p_path text, p_metadata jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_media public.couple_media%rowtype;
  v_size text;
begin
  if v_uid is null or split_part(p_path, '/', 1) <> v_uid::text then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  select * into v_media from public.couple_media m
    where m.owner_id = v_uid and m.path = p_path and m.status = 'uploading';
  if not found then return false; end if;
  v_size := coalesce(p_metadata->>'size', p_metadata->>'contentLength');
  if v_size is not null then
    if v_size !~ '^[0-9]{1,12}$' then return false; end if;
    if v_size::bigint <> v_media.size then return false; end if;
  end if;
  if p_metadata->>'mimetype' is not null
     and p_metadata->>'mimetype' <> v_media.type then
    return false;
  end if;
  return true;
end;
$$;

create policy couple_private_select on storage.objects
  for select to authenticated
  using (bucket_id = 'couple-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy couple_private_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'couple-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.couple_upload_allowed(name, metadata));
create policy couple_private_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'couple-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text);
-- No UPDATE policy: upload with upsert=false, and reserve a new path to replace a file.

create function public.couple_storage_usage()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_used bigint;
  v_pending bigint;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = '请先登录小屋。';
  end if;
  select coalesce(sum(m.size) filter (where m.status = 'ready'), 0),
         coalesce(sum(m.size) filter (where m.status = 'uploading'), 0)
    into v_used, v_pending from public.couple_media m where m.owner_id = v_uid;
  return jsonb_build_object('usedBytes', v_used, 'pendingBytes', v_pending,
    'maxBytes', 900000000, 'maxFileBytes', 50000000);
end;
$$;

create function public.couple_complete_media(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_media public.couple_media%rowtype;
  v_size text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = '请先登录小屋。';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  select * into v_media from public.couple_media m
    where m.id = p_id and m.owner_id = v_uid for update;
  if not found then
    raise exception using errcode = 'P0002', message = '未找到这次上传预约。';
  end if;
  -- Supabase Storage uses metadata.size, NOT contentLength or user_metadata.size.
  select o.metadata->>'size' into v_size from storage.objects o
    where o.bucket_id = 'couple-private' and o.name = v_media.path;
  if v_size is null or v_size !~ '^[0-9]{1,12}$' then
    raise exception using errcode = '22023', message = '文件尚未完整上传，请重试。';
  end if;
  if v_size::bigint <> v_media.size then
    raise exception using errcode = '22023', message = '上传文件大小与预约不一致，请删除后重试。';
  end if;
  update public.couple_media set status = 'ready'
    where id = p_id and owner_id = v_uid returning * into v_media;
  return to_jsonb(v_media);
end;
$$;

-- First delete the physical file through the Storage API; then release its row.
-- Never DELETE FROM storage.objects in SQL: that would leave billable file bytes.
create function public.couple_release_media(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_media public.couple_media%rowtype;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = '请先登录小屋。';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  select * into v_media from public.couple_media m
    where m.id = p_id and m.owner_id = v_uid for update;
  if not found then
    return jsonb_build_object('id', p_id, 'releasedBytes', 0);
  end if;
  if exists (select 1 from storage.objects o
    where o.bucket_id = 'couple-private' and o.name = v_media.path) then
    raise exception using errcode = '55000', message = '请先删除云端文件，再释放小屋空间。';
  end if;
  delete from public.couple_media where id = p_id and owner_id = v_uid;
  return jsonb_build_object('id', p_id, 'releasedBytes', v_media.size);
end;
$$;

revoke all on function public.couple_reserve_media(text, text, bigint),
  public.couple_upload_allowed(text, jsonb), public.couple_storage_usage(),
  public.couple_complete_media(uuid), public.couple_release_media(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.couple_reserve_media(text, text, bigint),
  public.couple_upload_allowed(text, jsonb), public.couple_storage_usage(),
  public.couple_complete_media(uuid), public.couple_release_media(uuid)
  to authenticated;

notify pgrst, 'reload schema';
commit;
