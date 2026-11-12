'use strict';

// Optional, offline PostgreSQL verification. Supply a local @electric-sql/pglite
// package/module path. This engine is NOT a dependency of setup-free-room.cjs.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

async function verify(PGlite) {
  const db = new PGlite(); // Memory only: never a Supabase URL or on-disk database.
  const UID = '11111111-1111-4111-8111-111111111111';
  const OTHER_UID = '22222222-2222-4222-8222-222222222222';
  let assertions = 0;
  const check = (value, expected) => { assert.deepEqual(value, expected); assertions++; };
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  const scalar = async (sql, params = []) => Object.values((await query(sql, params))[0])[0];
  const fail = async (sql, params, code) => {
    await assert.rejects(db.query(sql, params), error => error.code === code);
    assertions++;
  };
  const as = async (role, uid = '') => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
    await db.exec('set role ' + role); // Only fixed roles in this local test.
  };
  const reserve = (size = 123, name = '照片.jpg', type = 'image/jpeg') =>
    scalar('select public.couple_reserve_media($1,$2,$3)', [name, type, size]);
  const usage = () => scalar('select public.couple_storage_usage()');
  const object = (media, metadata) => db.query(
    'insert into storage.objects(bucket_id,name,metadata) values ($1,$2,$3)',
    ['couple-private', media.path, metadata]);

  try {
    // Local substitutes only for Supabase's platform schemas, JWT function and
    // built-in Storage grants. The production schema below is executed unchanged.
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create schema storage;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
      create table storage.buckets (
        id text primary key, name text, public boolean,
        file_size_limit bigint, allowed_mime_types text[]
      );
      create table storage.objects (
        id uuid primary key default gen_random_uuid(), bucket_id text,
        name text, metadata jsonb, unique(bucket_id,name)
      );
      alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql immutable as
        'select (string_to_array($1,''/''))[1:array_length(string_to_array($1,''/''),1)-1]';
      grant usage on schema auth, storage, public to anon, authenticated, service_role;
      grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
    `);
    await db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    await db.query('insert into auth.users(id) values ($1),($2)', [UID, OTHER_UID]);
    check(await scalar("select count(*)::int from pg_class where relname in ('couple_messages','couple_media','couple_settings') and relrowsecurity"), 3);
    check(await scalar("select count(*)::int from pg_proc where pronamespace='public'::regnamespace and proname like 'couple_%' and prosecdef and proconfig=array['search_path=\"\"']"), 5);
    check(await scalar("select public from storage.buckets where id='couple-private'"), false);
    check(await scalar("select file_size_limit::int from storage.buckets where id='couple-private'"), 50000000);

    await as('anon');
    await fail('select * from public.couple_messages', [], '42501');
    await fail('select public.couple_storage_usage()', [], '42501');
    await fail("insert into storage.objects(bucket_id,name,metadata) values ('couple-private',$1,'{}')", [UID + '/anonymous'], '42501');
    await as('authenticated');
    await fail('select public.couple_storage_usage()', [], '42501');

    await as('authenticated', UID);
    check(await usage(), { usedBytes: 0, pendingBytes: 0, maxBytes: 900000000, maxFileBytes: 50000000 });
    const note = (await query("insert into public.couple_messages(author,text) values ('me',$1) returning *", ['你好，世界']))[0];
    check(note.owner_id, UID);
    await fail("insert into public.couple_messages(owner_id,author,text) values ($1,'me','wrong owner')", [OTHER_UID], '42501');
    await fail("insert into public.couple_messages(author,text) values ('stranger','bad author')", [], '23514');
    await fail("insert into public.couple_messages(author,text) values ('me',$1)", ['你'.repeat(1001)], '23514');
    await db.query("insert into public.couple_messages(author,text) values ('partner',$1)", ['你'.repeat(1000)]);
    assertions++;
    await db.query('insert into public.couple_settings(me,partner,start_date) values ($1,$2,$3)', ['我', '你', '2026-11-12']);
    check(await scalar('select owner_id from public.couple_settings'), UID);
    await fail('update public.couple_settings set owner_id=$1', [OTHER_UID], '42501');

    await as('authenticated', OTHER_UID);
    check(await query('select * from public.couple_messages'), []);
    check(await query('select * from public.couple_settings'), []);
    check((await query('delete from public.couple_messages returning id')).length, 0);
    await as('authenticated', UID);
    for (const size of [0, -1, 50000001, null]) {
      await fail('select public.couple_reserve_media($1,$2,$3)', ['x', 'image/jpeg', size], '22023');
    }
    await fail('select public.couple_reserve_media($1,$2,$3)', ['x', 'application/octet-stream', 1], '22023');
    await fail('select public.couple_reserve_media($1,$2,$3)', ['', 'image/jpeg', 1], '22023');
    const media = await reserve();
    check(media.path, UID + '/' + media.id);
    check(media.partSize, 50000000);
    check(await usage(), { usedBytes: 0, pendingBytes: 123, maxBytes: 900000000, maxFileBytes: 50000000 });
    await fail('update public.couple_media set size=1', [], '42501');
    await fail('delete from public.couple_media', [], '42501');
    await fail('insert into public.couple_media(path,name,type,size) values ($1,$2,$3,$4)', [UID + '/bad', 'x', 'image/jpeg', 1], '42501');
    await fail('select public.couple_complete_media($1)', [media.id], '22023');
    await fail('insert into storage.objects(bucket_id,name,metadata) values ($1,$2,$3)',
      ['couple-private', UID + '/unreserved', { size: 123, mimetype: 'image/jpeg' }], '42501');
    await fail('insert into storage.objects(bucket_id,name,metadata) values ($1,$2,$3)',
      ['other-bucket', media.path, { size: 123, mimetype: 'image/jpeg' }], '42501');
    await fail('insert into storage.objects(bucket_id,name,metadata) values ($1,$2,$3)',
      ['couple-private', media.path, { size: 124, mimetype: 'image/jpeg' }], '42501');
    await fail('insert into storage.objects(bucket_id,name,metadata) values ($1,$2,$3)',
      ['couple-private', media.path, { size: 123, mimetype: 'video/mp4' }], '42501');
    await object(media, { size: 123, mimetype: 'image/jpeg' });
    assertions++;
    await fail('select public.couple_release_media($1)', [media.id], '55000');
    check((await scalar('select public.couple_complete_media($1)', [media.id])).status, 'ready');
    check((await scalar('select public.couple_complete_media($1)', [media.id])).status, 'ready');
    check(await usage(), { usedBytes: 123, pendingBytes: 0, maxBytes: 900000000, maxFileBytes: 50000000 });
    check((await query('update storage.objects set metadata=$1 where name=$2 returning id', [{ size: 124 }, media.path])).length, 0);

    await as('authenticated', OTHER_UID);
    check(await query('select * from public.couple_media'), []);
    check(await query('select * from storage.objects'), []);
    check((await query('delete from storage.objects returning id')).length, 0);
    check(await scalar('select public.couple_release_media($1)', [media.id]), { id: media.id, releasedBytes: 0 });
    await fail('select public.couple_complete_media($1)', [media.id], 'P0002');
    await fail('insert into storage.objects(bucket_id,name,metadata) values ($1,$2,$3)',
      ['couple-private', media.path, { size: 123, mimetype: 'image/jpeg' }], '42501');
    await as('authenticated', UID);
    await db.query('delete from storage.objects where name=$1', [media.path]); // Fake objects only; there are no physical test files.
    check(await scalar('select public.couple_release_media($1)', [media.id]), { id: media.id, releasedBytes: 123 });
    check(await scalar('select public.couple_release_media($1)', [media.id]), { id: media.id, releasedBytes: 0 });
    check((await usage()).usedBytes, 0);

    // A metadata field that LOOKS similar must not satisfy completion.
    const incomplete = await reserve(321);
    await as('postgres');
    await object(incomplete, { contentLength: 321, user_metadata: { size: 321 } });
    await as('authenticated', UID);
    await fail('select public.couple_complete_media($1)', [incomplete.id], '22023');
    await as('postgres');
    await db.query('update storage.objects set metadata=$1 where name=$2', [{ size: 320 }, incomplete.path]);
    await as('authenticated', UID);
    await fail('select public.couple_complete_media($1)', [incomplete.id], '22023');
    await db.query('delete from storage.objects where name=$1', [incomplete.path]);
    await scalar('select public.couple_release_media($1)', [incomplete.id]);

    // Exact quota boundary includes pending reservations; no physical 900MB needed.
    const reservations = [];
    for (let index = 0; index < 18; index++) reservations.push(await reserve(50000000));
    check((await usage()).pendingBytes, 900000000);
    await fail('select public.couple_reserve_media($1,$2,$3)', ['one-more.jpg', 'image/jpeg', 1], 'P0001');
    await scalar('select public.couple_release_media($1)', [reservations[0].id]);
    check((await usage()).pendingBytes, 850000000);
    await reserve(50000000);
    check((await usage()).pendingBytes, 900000000);
    await as('authenticated', OTHER_UID);
    check((await usage()).pendingBytes, 0);
    await reserve(1);
    check((await usage()).pendingBytes, 1);

    console.log(`Local PostgreSQL schema verification passed: ${assertions} assertions.`);
    console.log('No remote resources or physical media created. Concurrent lock contention and the real Storage HTTP service still require integration testing.');
    return assertions;
  } finally { await db.close(); }
}

if (require.main === module) {
  if (!process.argv[2]) {
    console.log('Usage: node verify-schema.cjs <local-pglite-package-or-module-path>');
    process.exitCode = 1;
  } else {
    try {
      const { PGlite } = require(path.resolve(process.argv[2]));
      verify(PGlite).catch(error => { console.error(error.message); process.exitCode = 1; });
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}

module.exports = { verify };
