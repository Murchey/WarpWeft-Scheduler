const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { startApi } = require('../server/api/api.cjs');
const schema = require('../data-schema.json');

test('API health exposes the schema version and capabilities', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpweft-health-'));
  const server = startApi({
    rootDir: path.resolve(__dirname, '..'),
    dataDir,
    port: 0,
    packaged: false,
    solverCommand: process.execPath,
    solverArgs: [path.join(__dirname, 'fixtures', 'fake-solver.cjs')],
    configFile: path.join(dataDir, 'server-config.json'),
  });
  await once(server, 'listening');
  const { port } = server.address();
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/api/health');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.schemaVersion, schema.version);
    assert.ok(body.appVersion);
    assert.ok(Array.isArray(body.capabilities));
    assert.ok(body.capabilities.includes('homeroom'));
  } finally {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
