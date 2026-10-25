const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { startApi } = require('../server/api/api.cjs');

const fakeSolver = path.join(__dirname, 'fixtures', 'fake-solver.cjs');

async function start() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpweft-proxy-'));
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
  return {
    base: 'http://127.0.0.1:' + port,
    dataDir,
    close: async () => {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function headers(clientId, ip) {
  return {
    'Content-Type': 'application/json',
    'X-Client-Id': clientId,
    ...(ip ? { 'X-Forwarded-For': ip } : {}),
  };
}

test('same-host proxy headers are used for client identity and CIDR filtering', async () => {
  const ctx = await start();
  try {
    const first = await fetch(ctx.base + '/api/server/clients', { headers: headers('proxy-one', '203.0.113.9') });
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.clients[0].ip, '203.0.113.9');

    const config = await fetch(ctx.base + '/api/server/config', {
      method: 'PUT',
      headers: headers('admin-local'),
      body: JSON.stringify({ allowedCidrs: ['198.51.100.0/24'] }),
    });
    assert.equal(config.status, 200);

    const allowed = await fetch(ctx.base + '/api/server/clients', { headers: headers('proxy-two', '198.51.100.7') });
    assert.equal(allowed.status, 200);
    const allowedBody = await allowed.json();
    assert.ok(allowedBody.clients.some((client) => client.ip === '198.51.100.7'));

    const blocked = await fetch(ctx.base + '/api/server/clients', { headers: headers('proxy-three', '203.0.113.9') });
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).code, 'IP_NOT_ALLOWED');
  } finally {
    await ctx.close();
  }
});

test('x-real-ip is used when x-forwarded-for is absent', async () => {
  const ctx = await start();
  try {
    const response = await fetch(ctx.base + '/api/server/clients', {
      headers: { 'X-Client-Id': 'proxy-real', 'X-Real-IP': '198.51.100.22' },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.clients.some((client) => client.ip === '198.51.100.22'));
  } finally {
    await ctx.close();
  }
});
