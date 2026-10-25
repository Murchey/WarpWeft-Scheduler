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
