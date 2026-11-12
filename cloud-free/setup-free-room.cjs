'use strict';

// Runtime: Node.js >= 22, Windows PowerShell 5.1, built-in modules only.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');

const MANAGEMENT_ORIGIN = 'https://api.supabase.com';
const INVITATION_BASE = 'https://qiuxinhl.github.io/winter-solstice/';
const BUCKET = 'couple-private';
const REGION = 'ap-southeast-1';
const MAX_BYTES = 900000000;
const MAX_FILE_BYTES = 50000000;
const POLL_MS = 5000;
const READY_TIMEOUT_MS = 10 * 60 * 1000;
const CONFIG_FILE = path.join(__dirname, 'public-config.js');
const STATE_FILE = path.join(__dirname, 'setup-state.json');
const DIALOG_FILE = path.join(__dirname, 'local-secret-dialog.ps1');
const READY_FLAG_FILE = path.join(__dirname, 'frontend-ready.flag');
const activeChildren = new Set();

class SafeSetupError extends Error {
  constructor(message, status = 0, retryable = false) {
    super(message);
    this.name = 'SafeSetupError';
    this.status = Number.isInteger(status) ? status : 0;
    this.retryable = retryable;
  }
}

function invariant(condition, message) {
  if (!condition) throw new SafeSetupError(message);
}

function safeFailure(error) {
  return error instanceof SafeSetupError
    ? error.message + (error.status ? `（HTTP ${error.status}）` : '')
    : '本次操作未完成；为保护凭据，已隐藏底层错误。请查看本地说明与无敏感信息的进度文件。';
}

function makePublicConfig(projectRef, anonKey) {
  invariant(/^[a-z]{20}$/.test(projectRef), '项目编号格式不符合官方定义，已停止。');
  invariant(typeof anonKey === 'string' && anonKey.length > 30, '未取得公开连接密钥。');
  let role;
  try { role = JSON.parse(Buffer.from(anonKey.split('.')[1], 'base64url').toString('utf8')).role; }
  catch { throw new SafeSetupError('公开密钥格式不符，已停止；不会使用管理员密钥代替。'); }
  invariant(role === 'anon', '公开密钥角色不符，已停止；不会公开管理员密钥。');
  return Object.freeze({
    address: `https://${projectRef}.supabase.co`,
    anonKey,
    email: `room-login@${projectRef}.invalid`,
    provider: 'supabase',
    bucket: BUCKET,
  });
}

function makeInvitation(publicConfig, secret) {
  invariant(typeof secret === 'string' && secret.length === 64, '本地口令格式不符。');
  const room = {
    address: publicConfig.address,
    secret,
    provider: 'supabase',
    anonKey: publicConfig.anonKey,
    email: publicConfig.email,
    bucket: publicConfig.bucket,
  };
  return INVITATION_BASE + '#room=' + Buffer.from(JSON.stringify(room), 'utf8').toString('base64url');
}

function serializePublicConfig(config) {
  // Allowlist fields: never serialize the working state or a credentials object.
  const allowed = {
    address: config.address, anonKey: config.anonKey, email: config.email,
    provider: 'supabase', bucket: BUCKET,
  };
  return '// Public connection settings; the room password is intentionally absent.\n'
    + 'window.OUR_WORLD_CLOUD = Object.freeze('
    + JSON.stringify(allowed, null, 2).replace(/</g, '\\u003c') + ');\n';
}

function defaultStore() {
  return {
    ensureFresh() {
      invariant(!fs.existsSync(CONFIG_FILE) && !fs.existsSync(STATE_FILE),
        '发现已有配置或开通记录，已停止，避免重复创建。请先核对说明中的失败恢复步骤。');
    },
    createState(state) {
      try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', { flag: 'wx' }); }
      catch { throw new SafeSetupError('无法建立独占的本地进度文件，未继续开通。'); }
    },
    saveState(state) {
      try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n'); }
      catch { throw new SafeSetupError('无法更新本地进度文件，已停止后续步骤。'); }
    },
    writeConfig(config) {
      try { fs.writeFileSync(CONFIG_FILE, serializePublicConfig(config), { flag: 'wx' }); }
      catch { throw new SafeSetupError('无法安全写入公开配置，已停止；请勿盲目重跑。'); }
    },
  };
}

// No API error body, response text, fetch error, request body, or headers is logged.
// Redirects are rejected so credentials cannot be forwarded to another origin.
async function requestJson({ origin, route, method = 'GET', bearer, apiKey, body, label, timeoutMs = 30000 }) {
  invariant(origin === MANAGEMENT_ORIGIN || /^https:\/\/[a-z]{20}\.supabase\.co$/.test(origin),
    '请求目标不在官方服务范围内。');
  invariant(typeof route === 'string' && route.startsWith('/') && !route.startsWith('//'), '请求路径不合法。');
  const target = new URL(route, origin);
  invariant(target.origin === origin, '请求目标发生变化，已停止。');
  const headers = { Accept: 'application/json', Authorization: `Bearer ${bearer}` };
  if (apiKey) headers.apikey = apiKey;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(target, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error', signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
    });
  } catch { throw new SafeSetupError(label + '未完成，网络可能中断；不会自动重试创建请求。', 0, true); }
  if (!response.ok) {
    try { await response.body?.cancel(); } catch { /* Never print a remote response. */ }
    throw new SafeSetupError(label + '被服务拒绝。', response.status);
  }
  if (response.status === 204) return null;
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch { throw new SafeSetupError(label + '返回了无法识别的数据，已隐藏原文。'); }
}

function runDialog(mode, payload) {
  return new Promise((resolve, reject) => {
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows',
      'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(executable,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-File', DIALOG_FILE, '-Mode', mode],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    activeChildren.add(child);
    let output = '';
    let failed = false;
    const fail = () => {
      if (failed) return;
      failed = true;
      output = '';
      reject(new SafeSetupError('本地口令窗口未完成；未输出任何凭据。'));
    };
    child.on('error', fail);
    child.stdin.on('error', fail);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (failed) return;
      output += chunk;
      if (output.length > 65536) { fail(); child.kill(); }
    });
    // Consume and discard diagnostic output. Never inherit a child output stream.
    child.stderr.on('data', () => {});
    child.on('close', code => {
      activeChildren.delete(child);
      if (failed) return;
      if (code !== 0) { fail(); return; }
      try {
        const result = JSON.parse(output.replace(/^\uFEFF/, '').trim());
        output = '';
        if (!result.ok) { fail(); return; }
        resolve(result);
      } catch { fail(); }
    });
    child.stdin.end(payload === undefined ? '' : JSON.stringify(payload));
  });
}

async function waitForReady({ management, projectRef, organizationSlug, now, delay, log }) {
  const start = now();
  const deadline = start + READY_TIMEOUT_MS;
  while (now() < deadline) {
    try {
      const project = await management(`/v1/projects/${projectRef}`, {
        label: '查询项目状态', timeoutMs: Math.min(15000, deadline - now()),
      });
      invariant(project?.ref === projectRef && project?.organization_slug === organizationSlug,
        '项目归属与新建组织不符，已停止。');
      invariant(project.region === REGION, '项目区域与指定的新加坡区域不符，已停止。');
      invariant(!['INIT_FAILED', 'REMOVED', 'RESTORE_FAILED', 'INACTIVE'].includes(project.status),
        '项目初始化未成功，已停止；请在官方项目列表检查。');
      if (project.status === 'ACTIVE_HEALTHY' && now() < deadline) {
        const services = await management(`/v1/projects/${projectRef}/health?services=auth,db,rest,storage`, {
          label: '查询同步服务状态', timeoutMs: Math.min(15000, deadline - now()),
        });
        if (Array.isArray(services) && ['auth', 'db', 'rest', 'storage'].every(name =>
          services.some(service => service.name === name && service.status === 'ACTIVE_HEALTHY'))) return;
      }
    } catch (error) {
      // Retry only read-only readiness checks. Never retry organization/project POSTs.
      if (!(error instanceof SafeSetupError)
        || (!error.retryable && ![429, 500, 502, 503, 504].includes(error.status))) throw error;
    }
    log(`正在等待免费项目和同步服务就绪，已等待${Math.floor((now() - start) / 1000)}秒。`);
    if (now() >= deadline) break;
    await delay(Math.min(POLL_MS, deadline - now()));
  }
  throw new SafeSetupError('等待就绪已满10分钟，已停止；请先检查已有项目，勿直接重复开通。');
}

function frontendReadyFlagPresent() {
  try {
    return fs.statSync(READY_FLAG_FILE).isFile()
      && fs.readFileSync(READY_FLAG_FILE, 'utf8').replace(/^\uFEFF/, '').trim() === 'ready';
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw new SafeSetupError('无法读取前端准备标志，已停止；没有显示私人邀请。');
  }
}

async function waitForFrontend({ isReady, delay }) {
  while (!isReady()) await delay(1000);
}

async function runSetup(options = {}) {
  const store = options.store || defaultStore();
  const request = options.request || requestJson;
  const dialog = options.dialog || runDialog;
  const log = options.log || (message => process.stdout.write(message + '\n'));
  const now = options.now || Date.now;
  const delay = options.delay || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const isFrontendReady = options.isFrontendReady || frontendReadyFlagPresent;
  const secrets = { pat: '', dbPassword: '', serviceRole: '', password: '', accessToken: '', invitation: '' };
  const state = { version: 1, stage: 'starting', createdAt: new Date(now()).toISOString() };
  const saveStage = stage => { state.stage = stage; store.saveState(state); };
  const management = (route, args = {}) => request({
    origin: MANAGEMENT_ORIGIN, route, bearer: secrets.pat, ...args,
  });
  store.ensureFresh();
  if (options.holdInvite) {
    invariant(!isFrontendReady(), '发现已有前端准备标志，已停止；请先移除旧标志，避免提前显示邀请。');
  }
  try {
    log('请在本地密码框输入 Supabase 管理令牌；内容不会写入文件或日志。');
    const answer = await dialog('token');
    secrets.pat = typeof answer?.value === 'string' ? answer.value.trim() : '';
    if (answer) delete answer.value;
    invariant(secrets.pat.length >= 20 && secrets.pat.length <= 4096 && !/\s/.test(secrets.pat),
      '未提供有效的管理令牌，未开始开通。');
    store.createState(state);

    // A brand-new organization defaults to Free. Never enumerate/reuse an old org,
    // send plan=pro, call a billing endpoint, enable an add-on, or retry a POST.
    log('正在创建全新的默认免费组织。');
    const suffix = new Date(now()).toISOString().replace(/[-:.TZ]/g, '') + '-' + randomBytes(4).toString('hex');
    const org = await management('/v1/organizations', {
      method: 'POST', body: { name: 'Our Little World Free ' + suffix }, label: '创建免费组织',
    });
    invariant(typeof org?.slug === 'string' && /^[\w-]{1,128}$/.test(org.slug), '未取得新组织编号，已停止。');
    state.organizationSlug = org.slug;
    saveStage('organization-created');
    const organization = await management(`/v1/organizations/${org.slug}`, { label: '确认免费组织方案' });
    invariant(organization?.plan === 'free', '无法确认新组织使用免费方案，未创建项目，也不会升级。');
    saveStage('free-plan-confirmed');

    secrets.dbPassword = randomBytes(48).toString('base64url');
    log('已确认免费方案，正在申请新加坡区域最小 nano 项目。');
    saveStage('project-create-requested');
    const project = await management('/v1/projects', {
      method: 'POST', label: '创建免费项目',
      body: {
        name: 'our-little-world-free', organization_slug: org.slug,
        db_pass: secrets.dbPassword, desired_instance_size: 'nano',
        region_selection: { type: 'specific', code: REGION },
        high_availability: false,
      },
    });
    secrets.dbPassword = '';
    invariant(typeof project?.ref === 'string' && /^[a-z]{20}$/.test(project.ref), '未取得有效项目编号，已停止。');
    state.projectRef = project.ref;
    saveStage('project-created');
    log(`新组织：${org.slug}；新项目：${project.ref}。这些编号不含凭据。`);
    await waitForReady({ management, projectRef: project.ref, organizationSlug: org.slug, now, delay, log });
    saveStage('project-ready');
    // Recheck immediately before configuring the project; fail closed if changed.
    const checkedOrg = await management(`/v1/organizations/${org.slug}`, { label: '再次确认免费方案' });
    invariant(checkedOrg?.plan === 'free', '组织已不是可确认的免费方案，已停止后续配置。');

    log('正在关闭公开注册并配置私有同步空间。');
    await management(`/v1/projects/${project.ref}/config/auth`, {
      method: 'PATCH', label: '关闭公开注册', body: {
        disable_signup: true, external_anonymous_users_enabled: false,
        external_email_enabled: true, external_phone_enabled: false,
        site_url: INVITATION_BASE,
      },
    });
    const authConfig = await management(`/v1/projects/${project.ref}/config/auth`, { label: '核验注册设置' });
    invariant(authConfig?.disable_signup === true && authConfig.external_anonymous_users_enabled === false
      && authConfig.external_email_enabled === true && authConfig.external_phone_enabled === false,
    '关闭公开注册的设置未通过核验，已停止。');
    saveStage('signup-disabled');

    const schema = options.schema || fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await management(`/v1/projects/${project.ref}/database/query`, {
      method: 'POST', label: '配置小屋数据库', timeoutMs: 60000, body: { query: schema, read_only: false },
    });
    saveStage('schema-created');

    const keys = await management(`/v1/projects/${project.ref}/api-keys?reveal=true`, { label: '读取项目连接密钥' });
    invariant(Array.isArray(keys), '项目密钥响应格式不符，已停止。');
    const anonKey = keys.find(key => key.name === 'anon')?.api_key;
    secrets.serviceRole = keys.find(key => key.name === 'service_role')?.api_key || '';
    const config = makePublicConfig(project.ref, anonKey);
    invariant(typeof secrets.serviceRole === 'string' && secrets.serviceRole.length > 30,
      '未取得管理员密钥，已停止；不会将它写入公开配置。');
    // Drop response references to privileged keys as soon as they are extracted.
    for (const key of keys) if (key && typeof key === 'object') delete key.api_key;
    const admin = (route, args = {}) => request({
      origin: config.address, route, bearer: secrets.serviceRole, apiKey: secrets.serviceRole, ...args,
    });
    await admin(`/storage/v1/bucket/${BUCKET}`, {
      method: 'PUT', label: '设置私有文件空间', body: {
        name: BUCKET, public: false, file_size_limit: MAX_FILE_BYTES,
        allowed_mime_types: ['image/*', 'video/*'],
      },
    });
    const bucket = await admin(`/storage/v1/bucket/${BUCKET}`, { label: '核验私有文件空间' });
    invariant(bucket?.id === BUCKET && bucket.public === false && Number(bucket.file_size_limit) === MAX_FILE_BYTES
      && Array.isArray(bucket.allowed_mime_types) && bucket.allowed_mime_types.length === 2
      && ['image/*', 'video/*'].every(type => bucket.allowed_mime_types.includes(type)),
    '私有文件空间或文件限制未通过核验，已停止。');
    saveStage('bucket-verified');

    log('正在创建两台设备共用的受保护账号。');
    secrets.password = randomBytes(48).toString('base64url');
    const user = await admin('/auth/v1/admin/users', {
      method: 'POST', label: '创建小屋登录账号', body: {
        email: config.email, password: secrets.password, email_confirm: true,
      },
    });
    invariant(typeof user?.id === 'string' && /^[0-9a-f-]{36}$/i.test(user.id) && user.email === config.email,
      '小屋账号未通过核验，已停止。');
    secrets.serviceRole = '';
    saveStage('room-user-created');

    log('正在核验密码登录、私有读取和空间统计；不会添加测试留言或文件。');
    const session = await request({
      origin: config.address, route: '/auth/v1/token?grant_type=password', method: 'POST',
      bearer: anonKey, apiKey: anonKey, label: '核验小屋登录',
      body: { email: config.email, password: secrets.password },
    });
    invariant(typeof session?.access_token === 'string' && session.user?.id === user.id, '小屋密码登录未通过核验。');
    secrets.accessToken = session.access_token;
    delete session.access_token;
    delete session.refresh_token;
    const authenticated = (route, args = {}) => request({
      origin: config.address, route, bearer: secrets.accessToken, apiKey: anonKey, ...args,
    });
    const usage = await authenticated('/rest/v1/rpc/couple_storage_usage', {
      method: 'POST', body: {}, label: '核验小屋空间统计',
    });
    invariant(usage?.usedBytes === 0 && usage?.pendingBytes === 0 && usage?.maxBytes === MAX_BYTES
      && usage?.maxFileBytes === MAX_FILE_BYTES, '空间统计未通过核验，已停止。');
    const messages = await authenticated('/rest/v1/couple_messages?select=id&limit=1', { label: '核验留言读取' });
    invariant(Array.isArray(messages) && messages.length === 0, '全新小屋的留言读取未通过核验。');
    await authenticated('/auth/v1/logout?scope=local', { method: 'POST', label: '结束开通验证会话' });
    secrets.accessToken = '';
    secrets.pat = '';

    store.writeConfig(config);
    saveStage('ready');
    log('免费小屋已准备好，公开配置已写入本目录 public-config.js。');
    if (options.holdInvite) {
      saveStage('waiting-for-frontend');
      log('正在等待 frontend-ready.flag 中出现 ready；请保持本程序运行，先完成网站发布。');
      await waitForFrontend({ isReady: isFrontendReady, delay });
    }
    log('口令与私人邀请链接只在接下来的本地窗口显示，请自行保存。');
    secrets.invitation = makeInvitation(config, secrets.password);
    await dialog('result', { password: secrets.password, invitation: secrets.invitation });
    saveStage('credentials-shown');
    log('本地口令窗口已关闭。程序没有发布网站，也没有向他人发送链接。');
    return { organizationSlug: org.slug, projectRef: project.ref, configFile: CONFIG_FILE };
  } finally {
    // Best-effort reference clearing; JavaScript/.NET strings are not zeroizable.
    for (const name of Object.keys(secrets)) secrets[name] = '';
  }
}

function preflight() {
  invariant(Number(process.versions.node.split('.')[0]) >= 22, '请使用 Node.js 22 或更新版本。');
  invariant(process.platform === 'win32', '本地密码框需要 Windows，请在当前 Windows 电脑运行。');
  for (const name of ['schema.sql', 'local-secret-dialog.ps1']) {
    invariant(fs.existsSync(path.join(__dirname, name)), '缺少本地配套文件，请使用完整目录。');
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) {
    process.stdout.write('本地免费小屋开通程序\n'
      + '  node setup-free-room.cjs --check         仅检查本地运行条件，不联网、不弹窗\n'
      + '  node setup-free-room.cjs --prepare-only  新建免费组织和项目、配置私有后端、显示私人邀请\n'
      + '  node setup-free-room.cjs --prepare-only --hold-invite  等待前端准备标志后才显示邀请\n'
      + '请仅在已获开通授权后运行 --prepare-only；本程序不会发布 GitHub Pages。\n');
    return;
  }
  const prepare = args.includes('--prepare-only');
  const holdInvite = args.includes('--hold-invite');
  const validPrepare = prepare && args.length === new Set(args).size
    && args.every(arg => ['--prepare-only', '--hold-invite'].includes(arg));
  invariant((args.length === 1 && args[0] === '--check') || validPrepare, '参数不受支持，请使用 --help。');
  preflight();
  if (args[0] === '--check') {
    process.stdout.write('本地运行条件检查通过；尚未联网、创建资源或打开口令窗口。\n');
    return;
  }
  await runSetup({ holdInvite });
}

if (require.main === module) {
  process.on('SIGINT', () => {
    for (const child of activeChildren) child.kill();
    process.stdout.write('\n操作已停止。请先检查进度文件中的已有组织和项目，勿直接重复开通。\n');
    process.exit(130);
  });
  main().catch(error => { process.stderr.write(safeFailure(error) + '\n'); process.exitCode = 1; });
}

module.exports = {
  SafeSetupError, safeFailure, makePublicConfig, makeInvitation, serializePublicConfig,
  requestJson, waitForReady, waitForFrontend, runSetup,
  constants: { MANAGEMENT_ORIGIN, INVITATION_BASE, BUCKET, REGION, MAX_BYTES, MAX_FILE_BYTES, POLL_MS, READY_TIMEOUT_MS },
};
