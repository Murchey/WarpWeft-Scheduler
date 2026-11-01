const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { startFromEnv, readPort, readHost } = require('../linux_server/server.cjs');
const { UserStore } = require('../server/api/auth.cjs');

const root = path.resolve(__dirname, '..');
const fakeSolver = path.join(__dirname, 'fixtures', 'fake-solver.cjs');

async function close(server) {
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

test('Linux entry starts the API from environment variables', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpweft-linux-'));
  new UserStore(path.join(dataDir, 'users.json')).create({ username: 'linux-admin', password: 'linux-admin-pass', role: 'admin' });
  const context = startFromEnv(
    { WARPVEFT_DATA_DIR: dataDir, WARPVEFT_PORT: '0' },
    { rootDir: root, solverCommand: process.execPath, solverArgs: [fakeSolver] },
  );
  try {
    await once(context.server, 'listening');
    const port = context.server.address().port;
    assert.equal(context.dataDir, dataDir);
    assert.ok(fs.existsSync(path.join(dataDir, 'warpweft.json')));

    const health = await fetch('http://127.0.0.1:' + port + '/api/health');
    assert.equal(health.status, 200);
    const body = await health.json();
    assert.equal(body.ok, true);
    assert.ok(body.appVersion);
    assert.ok(body.schemaVersion >= 1);
    assert.equal(body.auth.required, true);
    assert.equal(body.auth.mode, 'linux');

    const unauthorized = await fetch('http://127.0.0.1:' + port + '/api/data');
    assert.equal(unauthorized.status, 401);

    const loginResponse = await fetch('http://127.0.0.1:' + port + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'linux-admin', password: 'linux-admin-pass' }),
    });
    assert.equal(loginResponse.status, 200);
    const session = await loginResponse.json();
    const data = await fetch('http://127.0.0.1:' + port + '/api/data', {
      headers: { Authorization: 'Bearer ' + session.token },
    });
    assert.equal(data.status, 200);
    assert.equal((await data.json()).school.name, '未设置学校');

    // Linux 服务端不提供桌面 UI：根路径重定向到官网，/app/ 必须 404。
    const index = await fetch('http://127.0.0.1:' + port + '/', { redirect: 'manual' });
    assert.equal(index.status, 302);
    assert.equal(index.headers.get('location'), '/site/');
    if (fs.existsSync(path.join(root, 'dist', 'index.html'))) {
      for (const pathname of ['/app/', '/app', '/assets/index.js', '/index.html']) {
        const blocked = await fetch('http://127.0.0.1:' + port + pathname, { redirect: 'manual' });
        assert.notEqual(blocked.status, 200, 'Linux 端不应提供桌面 UI：' + pathname);
      }
    }
  } finally {
    await close(context.server);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Linux entry validates port and recognizes bind aliases', () => {
  assert.equal(readPort('4317'), 4317);
  assert.equal(readPort(0), 0);
  assert.throws(() => readPort('abc'), /WARPVEFT_PORT/);
  assert.throws(() => readPort(70000), /WARPVEFT_PORT/);
  assert.equal(readHost('lan'), '0.0.0.0');
  assert.equal(readHost('loopback'), '127.0.0.1');
  assert.equal(readHost(''), undefined);
});
