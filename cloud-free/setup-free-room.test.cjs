'use strict';

// Entirely offline. Synthetic credentials and memory-only API/store/dialog doubles.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {
  SafeSetupError, safeFailure, makePublicConfig, makeInvitation, serializePublicConfig,
  requestJson, waitForReady, runSetup, constants,
} = require('./setup-free-room.cjs');

const REF = 'abcdefghijklmnopqrst';
const UID = '11111111-1111-4111-8111-111111111111';
const ORG = 'offline-test-organization';
const jwt = role => 'eyJhbGciOiJIUzI1NiJ9.'
  + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.offline-test-signature';
const ANON = jwt('anon');
const SERVICE = jwt('service_role');
const PAT = 'offline-test-pat-never-a-real-credential';

function harness(changes = {}) {
  const calls = [];
  const logs = [];
  const states = [];
  const dialogs = [];
  let config;
  const options = {
    schema: 'offline-schema-placeholder', log: value => logs.push(value),
    store: {
      ensureFresh() {},
      createState(state) { states.push(structuredClone(state)); },
      saveState(state) { states.push(structuredClone(state)); },
      writeConfig(value) { config = serializePublicConfig(value); },
    },
    async dialog(mode, payload) {
      dialogs.push({ mode, payload });
      return mode === 'token' ? { ok: true, value: PAT } : { ok: true };
    },
    async request(call) {
      calls.push(call);
      const { route, method = 'GET', body } = call;
      if (changes.request) {
        const answer = await changes.request(call);
        if (answer !== undefined) return answer;
      }
      if (route === '/v1/organizations' && method === 'POST') return { slug: ORG };
      if (route === '/v1/organizations/' + ORG) return { plan: 'free' };
      if (route === '/v1/projects' && method === 'POST') return { ref: REF };
      if (route === '/v1/projects/' + REF) return {
        ref: REF, organization_slug: ORG, region: constants.REGION, status: 'ACTIVE_HEALTHY',
      };
      if (route.includes('/health?')) return ['auth', 'db', 'rest', 'storage'].map(name => ({ name, status: 'ACTIVE_HEALTHY' }));
      if (route.endsWith('/config/auth')) return {
        disable_signup: true, external_anonymous_users_enabled: false,
        external_email_enabled: true, external_phone_enabled: false,
      };
      if (route.endsWith('/database/query')) return [];
      if (route.endsWith('/api-keys?reveal=true')) return [
        { name: 'anon', api_key: ANON }, { name: 'service_role', api_key: SERVICE },
      ];
      if (route === '/storage/v1/bucket/' + constants.BUCKET) return method === 'PUT' ? {} : {
        id: constants.BUCKET, public: false, file_size_limit: constants.MAX_FILE_BYTES,
        allowed_mime_types: ['image/*', 'video/*'],
      };
      if (route === '/auth/v1/admin/users') return { id: UID, email: body.email };
      if (route.startsWith('/auth/v1/token?')) return {
        access_token: 'offline-test-session-access', refresh_token: 'offline-test-session-refresh', user: { id: UID },
      };
      if (route === '/rest/v1/rpc/couple_storage_usage') return {
        usedBytes: 0, pendingBytes: 0, maxBytes: constants.MAX_BYTES, maxFileBytes: constants.MAX_FILE_BYTES,
      };
      if (route.startsWith('/rest/v1/couple_messages?')) return [];
      if (route.startsWith('/auth/v1/logout?')) return null;
      assert.fail('Unexpected offline endpoint');
    },
  };
  return { options, calls, logs, states, dialogs, config: () => config };
}

test('prepare flow uses only a new confirmed-Free organization and fixed nano region', async () => {
  const h = harness();
  const result = await runSetup(h.options);
  const creates = h.calls.filter(call => call.method === 'POST' && ['/v1/organizations', '/v1/projects'].includes(call.route));
  assert.equal(creates.length, 2);
  assert.deepEqual(Object.keys(creates[0].body), ['name']);
  assert.equal(creates[1].body.organization_slug, ORG);
  assert.equal(creates[1].body.desired_instance_size, 'nano');
  assert.deepEqual(creates[1].body.region_selection, { type: 'specific', code: 'ap-southeast-1' });
  assert.equal(creates[1].body.high_availability, false);
  assert.equal(creates[1].body.db_pass.length, 64);
  assert.equal('plan' in creates[1].body, false);
  assert.equal(h.calls.some(call => /billing|addon|upgrade/.test(call.route)), false);
  assert.equal(h.calls.some(call => call.route === '/v1/organizations' && !call.method), false);
  const signup = h.calls.find(call => call.route.endsWith('/config/auth') && call.method === 'PATCH');
  assert.equal(signup.body.disable_signup, true);
  const authUser = h.calls.find(call => call.route === '/auth/v1/admin/users');
  assert.equal(authUser.body.email, `room-login@${REF}.invalid`);
  assert.equal(authUser.body.email_confirm, true);
  assert.equal(authUser.body.password.length, 64);
  assert.equal(result.projectRef, REF);
  assert.equal(h.states.at(-1).stage, 'credentials-shown');
});

test('files, logs, state and return value exclude all privileged secrets', async () => {
  const h = harness();
  const result = await runSetup(h.options);
  const creation = h.calls.find(call => call.route === '/v1/projects' && call.method === 'POST');
  const account = h.calls.find(call => call.route === '/auth/v1/admin/users');
  const resultDialog = h.dialogs.find(dialog => dialog.mode === 'result').payload;
  const safeOutput = JSON.stringify({ logs: h.logs, states: h.states, config: h.config(), result });
  for (const secret of [PAT, SERVICE, creation.body.db_pass, account.body.password,
    resultDialog.invitation, 'offline-test-session-access', 'offline-test-session-refresh']) {
    assert.equal(safeOutput.includes(secret), false);
  }
  const context = { window: {} };
  vm.runInNewContext(h.config(), context);
  assert.deepEqual(Object.keys(context.window.OUR_WORLD_CLOUD).sort(), ['address', 'anonKey', 'bucket', 'email', 'provider']);
  assert.equal(context.window.OUR_WORLD_CLOUD.anonKey, ANON);
  assert.equal(Object.isFrozen(context.window.OUR_WORLD_CLOUD), true);
  const decoded = JSON.parse(Buffer.from(resultDialog.invitation.split('#room=')[1], 'base64url').toString('utf8'));
  assert.equal(decoded.secret, account.body.password);
  assert.equal(decoded.provider, 'supabase');
  assert.equal(decoded.address, `https://${REF}.supabase.co`);
  assert.deepEqual(Object.keys(decoded).sort(), ['address', 'anonKey', 'bucket', 'email', 'provider', 'secret']);
});

for (const plan of ['pro', undefined]) {
  test(`unconfirmed free plan (${plan}) stops before project creation`, async () => {
    const h = harness({ request: call => call.route === '/v1/organizations/' + ORG ? { plan } : undefined });
    await assert.rejects(runSetup(h.options), /免费方案/);
    assert.equal(h.calls.some(call => call.route === '/v1/projects'), false);
    assert.equal(h.config(), undefined);
  });
}

test('uncertain project creation is never retried and leaves a safe progress marker', async () => {
  const h = harness({ request: call => {
    if (call.route === '/v1/projects') throw new SafeSetupError('创建未完成。', 0, true);
  } });
  await assert.rejects(runSetup(h.options), /创建未完成/);
  assert.equal(h.calls.filter(call => call.route === '/v1/projects').length, 1);
  assert.equal(h.states.at(-1).stage, 'project-create-requested');
  assert.equal(h.states.at(-1).organizationSlug, ORG);
});

test('existing local setup record prevents dialogs and API calls', async () => {
  const h = harness();
  h.options.store.ensureFresh = () => { throw new SafeSetupError('已有配置。'); };
  await assert.rejects(runSetup(h.options), /已有配置/);
  assert.equal(h.dialogs.length, 0);
  assert.equal(h.calls.length, 0);
});

test('hold-invite publishes only public config, then waits for a fresh nonsecret flag before showing secrets', async () => {
  const h = harness();
  let ready = false;
  let waited = 0;
  h.options.holdInvite = true;
  h.options.isFrontendReady = () => ready;
  h.options.delay = async ms => {
    waited += ms;
    assert.equal(h.states.at(-1).stage, 'waiting-for-frontend');
    assert.equal(typeof h.config(), 'string');
    assert.equal(h.dialogs.some(dialog => dialog.mode === 'result'), false);
    if (waited >= 3000) ready = true;
  };
  await runSetup(h.options);
  assert.equal(waited, 3000);
  assert.equal(h.dialogs.at(-1).mode, 'result');
  assert.equal(h.states.at(-1).stage, 'credentials-shown');
});

test('a stale frontend ready flag is rejected before token input and remote creation', async () => {
  const h = harness();
  h.options.holdInvite = true;
  h.options.isFrontendReady = () => true;
  await assert.rejects(runSetup(h.options), /已有前端准备标志/);
  assert.equal(h.dialogs.length, 0);
  assert.equal(h.calls.length, 0);
});

test('private bucket and disabled signup are verified before creating a room account', async () => {
  for (const kind of ['bucket', 'signup']) {
    const h = harness({ request: call => {
      if (kind === 'bucket' && call.route.startsWith('/storage/v1/bucket/') && call.method !== 'PUT') {
        return { id: constants.BUCKET, public: true, file_size_limit: constants.MAX_FILE_BYTES };
      }
      if (kind === 'signup' && call.route.endsWith('/config/auth') && call.method !== 'PATCH') {
        return { disable_signup: false };
      }
    } });
    await assert.rejects(runSetup(h.options), /未通过核验/);
    assert.equal(h.calls.some(call => call.route === '/auth/v1/admin/users'), false);
  }
});

test('privileged key cannot be serialized as an anon key', () => {
  assert.throws(() => makePublicConfig(REF, SERVICE), /角色不符/);
  assert.throws(() => makePublicConfig(REF, 'sb_secret_' + 'x'.repeat(40)), /密钥格式不符/);
  const config = makePublicConfig(REF, ANON);
  assert.equal(makeInvitation(config, 'x'.repeat(64)).startsWith(constants.INVITATION_BASE + '#room='), true);
});

test('readiness polling uses five second steps, retries reads, and stops at ten minutes', async () => {
  let elapsed = 0;
  let calls = 0;
  const waits = [];
  await assert.rejects(waitForReady({
    projectRef: REF, organizationSlug: ORG,
    now: () => elapsed, delay: async ms => { waits.push(ms); elapsed += ms; }, log() {},
    management: async () => {
      calls++;
      if (calls === 1) throw new SafeSetupError('网络中断。', 0, true);
      return { ref: REF, organization_slug: ORG, region: constants.REGION, status: 'COMING_UP' };
    },
  }), /10分钟/);
  assert.equal(elapsed, 600000);
  assert.equal(calls, 120);
  assert.equal(waits.every(ms => ms === 5000), true);
});

test('readiness rejects an unexpected project organization immediately', async () => {
  await assert.rejects(waitForReady({
    projectRef: REF, organizationSlug: ORG, now: () => 0, delay: async () => assert.fail('Must not poll'), log() {},
    management: async () => ({ ref: REF, organization_slug: 'other', region: constants.REGION, status: 'ACTIVE_HEALTHY' }),
  }), /归属/);
});

test('HTTP errors discard bodies and network failures hide underlying exception details', async () => {
  const originalFetch = global.fetch;
  const request = { origin: constants.MANAGEMENT_ORIGIN, route: '/v1/organizations', bearer: PAT, label: '查询' };
  try {
    let canceled = false;
    global.fetch = async (_url, options) => {
      assert.equal(options.redirect, 'error');
      return {
        ok: false, status: 403, body: { async cancel() { canceled = true; } },
        text() { assert.fail('Raw error response must never be read'); },
      };
    };
    await assert.rejects(requestJson(request), error => safeFailure(error) === '查询被服务拒绝。（HTTP 403）');
    assert.equal(canceled, true);
    global.fetch = async () => { throw new Error('Sensitive unexpected transport details: ' + PAT); };
    await assert.rejects(requestJson(request), error => !safeFailure(error).includes(PAT));
    assert.equal(safeFailure(new Error(PAT)).includes(PAT), false);
  } finally { global.fetch = originalFetch; }
});

test('request allowlist rejects off-site origins and routes before sending credentials', async () => {
  for (const bad of [
    { origin: 'https://example.invalid', route: '/' },
    { origin: constants.MANAGEMENT_ORIGIN, route: '//example.invalid/path' },
    { origin: constants.MANAGEMENT_ORIGIN, route: '/\\example.invalid/path' },
  ]) {
    await assert.rejects(requestJson({ ...bad, bearer: PAT, label: '检查' }), SafeSetupError);
  }
});
