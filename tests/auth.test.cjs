const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { startApi } = require('../server/api/api.cjs');
const { UserStore, hashPassword, verifyPassword } = require('../server/api/auth.cjs');

const fakeSolver = path.join(__dirname, 'fixtures', 'fake-solver.cjs');

async function start() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpweft-auth-'));
  const usersFile = path.join(dataDir, 'users.json');
  const store = new UserStore(usersFile);
  store.create({ username: 'admin', password: 'admin-pass-123', role: 'admin', displayName: '管理员' });
  const server = startApi({
    rootDir: path.resolve(__dirname, '..'),
    dataDir,
    port: 0,
    packaged: false,
    solverCommand: process.execPath,
    solverArgs: [fakeSolver],
    configFile: path.join(dataDir, 'server-config.json'),
    authEnabled: true,
  });
  await once(server, 'listening');
  const { port } = server.address();
  return {
    base: 'http://127.0.0.1:' + port,
    dataDir,
    usersFile,
    close: async () => {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function headers(token, clientId = 'auth-test') {
  return {
    'Content-Type': 'application/json',
    'X-Client-Id': clientId,
    ...(token ? { Authorization: 'Bearer ' + token } : {}),
  };
}

async function request(ctx, pathname, options = {}, token = '', clientId = 'auth-test') {
  const response = await fetch(ctx.base + pathname, {
    ...options,
    headers: { ...headers(token, clientId), ...(options.headers || {}) },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body };
}

test('monitoring is readable by any signed-in account, but redacted for non-admins', async () => {
  const ctx = await start();
  try {
    const adminLogin = await login(ctx, 'admin', 'admin-pass-123');
    const adminToken = adminLogin.body.token;
    const teacher = await request(ctx, '/api/users', {
      method: 'POST',
      body: JSON.stringify({ username: 'monitor-user', password: 'monitor-pass-123', role: 'user' }),
    }, adminToken);
    assert.equal(teacher.response.status, 201);
    const teacherLogin = await login(ctx, 'monitor-user', 'monitor-pass-123', 'monitor-client');
    const teacherToken = teacherLogin.body.token;

    // 教师账号也能看到负载与任务 —— 这是产品要求，不是回归。
    for (const pathname of ['/api/server/overview', '/api/server/stats', '/api/server/logs', '/api/server/clients']) {
      const result = await request(ctx, pathname, {}, teacherToken, 'monitor-client');
      assert.equal(result.response.status, 200, pathname + ' must be readable by a signed-in user');
    }

    const teacherOverview = await request(ctx, '/api/server/overview', {}, teacherToken, 'monitor-client');
    const tStats = teacherOverview.body.stats;
    // 能拿到运行指标
    assert.equal(typeof tStats.cpu.usage, 'number');
    assert.equal(typeof tStats.uptimeSeconds, 'number');
    assert.ok(tStats.queue);
    assert.ok(Array.isArray(teacherOverview.body.jobs));
    // 但拿不到内网拓扑
    assert.equal(tStats.host, '·');
    assert.deepEqual(tStats.addresses, []);
    assert.equal(tStats.solver.jar, '·');
    assert.equal(tStats.java.command, '·');
    assert.deepEqual(tStats.config.allowedCidrs, []);
    for (const client of teacherOverview.body.clients) assert.equal(client.ip, '·');
    // 日志在服务端就已脱敏（不依赖前端正则）
    for (const item of teacherOverview.body.logs.items) {
      assert.doesNotMatch(String(item.message), /\b\d{1,3}(?:\.\d{1,3}){3}\b/, 'log must not contain raw IP');
    }

    // 管理员看到完整拓扑
    const adminOverview = await request(ctx, '/api/server/overview', {}, adminToken);
    assert.equal(adminOverview.response.status, 200);
    assert.notEqual(adminOverview.body.stats.host, '·');
    assert.notEqual(adminOverview.body.stats.solver.jar, '·');

    // 写操作仍然只限管理员
    const configByUser = await request(ctx, '/api/server/config', { method: 'PUT', body: JSON.stringify({ queueCapacity: 30 }) }, teacherToken, 'monitor-client');
    assert.equal(configByUser.response.status, 403);
    assert.equal(configByUser.body.code, 'FORBIDDEN');
    const configByAdmin = await request(ctx, '/api/server/config', { method: 'PUT', body: JSON.stringify({ queueCapacity: 24 }) }, adminToken);
    assert.equal(configByAdmin.response.status, 200);
  } finally {
    await ctx.close();
    fs.rmSync(ctx.dataDir, { recursive: true, force: true });
  }
});

function login(ctx, username, password, clientId = 'auth-test') {
  return request(ctx, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  }, '', clientId);
}

test('password hashes are one-way and verify correctly', () => {
  const encoded = hashPassword('correct horse battery');
  assert.notEqual(encoded, 'correct horse battery');
  assert.equal(verifyPassword('correct horse battery', encoded), true);
  assert.equal(verifyPassword('wrong password', encoded), false);
});

test('Linux auth requires login and exposes user management to admins', async () => {
  const ctx = await start();
  try {
    const health = await request(ctx, '/api/health');
    assert.equal(health.body.auth.required, true);
    assert.equal(health.body.auth.mode, 'linux');
    assert.equal(health.body.auth.needsSetup, false);

    const noAuth = await request(ctx, '/api/data');
    assert.equal(noAuth.response.status, 401);
    assert.equal(noAuth.body.code, 'AUTH_REQUIRED');

    const adminLogin = await login(ctx, 'admin', 'admin-pass-123');
    assert.equal(adminLogin.response.status, 200);
    const adminToken = adminLogin.body.token;
    assert.ok(adminToken);
    assert.equal(adminLogin.body.user.role, 'admin');
    assert.equal((await request(ctx, '/api/data', {}, adminToken)).response.status, 200);

    const users = await request(ctx, '/api/users', {}, adminToken);
    assert.equal(users.response.status, 200);
    assert.equal(users.body.users[0].username, 'admin');
    assert.equal(Object.hasOwn(users.body.users[0], 'passwordHash'), false);

    const created = await request(ctx, '/api/users', {
      method: 'POST',
      body: JSON.stringify({ username: 'teacher', password: 'teacher-pass-123', role: 'user', displayName: '教师甲' }),
    }, adminToken);
    assert.equal(created.response.status, 201);
    assert.equal(created.body.user.role, 'user');

    const auditFile = path.join(ctx.dataDir, 'audit.log');
    const auditText = fs.readFileSync(auditFile, 'utf8');
    assert.match(auditText, /"action":"login"/);
    assert.match(auditText, /"action":"user_create"/);
    assert.match(auditText, /"target":"teacher"/);

    const teacherLogin = await login(ctx, 'teacher', 'teacher-pass-123', 'teacher-client');
    assert.equal(teacherLogin.response.status, 200);
    const teacherToken = teacherLogin.body.token;

    const forbidden = await request(ctx, '/api/users', {}, teacherToken, 'teacher-client');
    assert.equal(forbidden.response.status, 403);
    assert.equal(forbidden.body.code, 'FORBIDDEN');

    const teacherData = await request(ctx, '/api/data', {}, teacherToken, 'teacher-client');
    assert.equal(teacherData.response.status, 200);

    const lastAdmin = await request(ctx, '/api/users/' + adminLogin.body.user.id, { method: 'DELETE' }, adminToken);
    assert.equal(lastAdmin.response.status, 409);
    assert.equal(lastAdmin.body.code, 'LAST_ADMIN');

    const logout = await request(ctx, '/api/auth/logout', { method: 'POST' }, adminToken);
    assert.equal(logout.response.status, 200);
    assert.equal((await request(ctx, '/api/data', {}, adminToken)).response.status, 401);
  } finally {
    await ctx.close();
    fs.rmSync(ctx.dataDir, { recursive: true, force: true });
  }
});

test('a user created by the CLI becomes usable without restarting the server', async () => {
  const ctx = await start();
  try {
    const second = new UserStore(ctx.usersFile);
    second.create({ username: 'late-user', password: 'late-user-pass-123', role: 'user' });
    const result = await login(ctx, 'late-user', 'late-user-pass-123', 'late-client');
    assert.equal(result.response.status, 200);
  } finally {
    await ctx.close();
    fs.rmSync(ctx.dataDir, { recursive: true, force: true });
  }
});

test('desktop mode has no login and no user API', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpweft-noauth-'));
  const server = startApi({
    rootDir: path.resolve(__dirname, '..'),
    dataDir,
    port: 0,
    packaged: false,
    solverCommand: process.execPath,
    solverArgs: [fakeSolver],
    configFile: path.join(dataDir, 'server-config.json'),
  });
  await once(server, 'listening');
  const { port } = server.address();
  try {
    const base = 'http://127.0.0.1:' + port;
    const health = await fetch(base + '/api/health').then((response) => response.json());
    assert.equal(health.auth.required, false);
    assert.equal((await fetch(base + '/api/auth/login', { method: 'POST', headers: headers(), body: '{}' })).status, 404);
    assert.equal((await fetch(base + '/api/users', { headers: headers() })).status, 404);
  } finally {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
