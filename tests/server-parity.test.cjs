const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { startApi } = require('../server/api/api.cjs');
const { startFromEnv } = require('../linux_server/server.cjs');

const root = path.resolve(__dirname, '..');
const fakeSolver = path.join(__dirname, 'fixtures', 'fake-solver.cjs');

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warpweft-parity-' + label + '-'));
}

async function close(server) {
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

function normalizedHealth(health) {
  return {
    ok: health.ok,
    dataSource: health.dataSource,
    solver: health.solver,
    appVersion: health.appVersion,
    schemaVersion: health.schemaVersion,
    solverProtocol: health.solverProtocol,
    capabilities: health.capabilities,
    auth: health.auth,
    config: {
      maxClients: health.server?.config?.maxClients,
      queueCapacity: health.server?.config?.queueCapacity,
      jobTimeoutSeconds: health.server?.config?.jobTimeoutSeconds,
      bindAddress: health.server?.config?.bindAddress,
    },
  };
}

test('desktop and Linux entry points expose the same server capabilities', async () => {
  const desktopDir = tempDir('desktop');
  const linuxDir = tempDir('linux');
  const desktop = startApi({
    rootDir: root,
    dataDir: desktopDir,
    port: 0,
    packaged: false,
    solverCommand: process.execPath,
    solverArgs: [fakeSolver],
    configFile: path.join(desktopDir, 'server-config.json'),
  });
  const linuxContext = startFromEnv(
    { WARPVEFT_DATA_DIR: linuxDir, WARPVEFT_PORT: '0', WARPVEFT_AUTH: '0' },
    { rootDir: root, solverCommand: process.execPath, solverArgs: [fakeSolver] },
  );
  const linux = linuxContext.server;
  try {
    await Promise.all([once(desktop, 'listening'), once(linux, 'listening')]);
    const desktopPort = desktop.address().port;
    const linuxPort = linux.address().port;
    const desktopHealth = await (await fetch('http://127.0.0.1:' + desktopPort + '/api/health')).json();
    const linuxHealth = await (await fetch('http://127.0.0.1:' + linuxPort + '/api/health')).json();

    // Authentication is an intentional deployment difference; with it disabled
    // both entry points must expose exactly the same schema, solver protocol,
    // capabilities and limits.
    assert.deepEqual(normalizedHealth(linuxHealth), normalizedHealth(desktopHealth));

    const desktopIndex = await (await fetch('http://127.0.0.1:' + desktopPort + '/')).text();
    const linuxIndex = await (await fetch('http://127.0.0.1:' + linuxPort + '/')).text();
    assert.equal(linuxIndex, desktopIndex, 'both entries must serve the same built renderer');

    const desktopData = await (await fetch('http://127.0.0.1:' + desktopPort + '/api/data')).json();
    const linuxData = await (await fetch('http://127.0.0.1:' + linuxPort + '/api/data')).json();
    assert.deepEqual(linuxData.school, desktopData.school);
    assert.deepEqual(linuxData.classes, desktopData.classes);
    assert.deepEqual(linuxData.coursePlans, desktopData.coursePlans);
  } finally {
    await close(desktop);
    await close(linux);
    fs.rmSync(desktopDir, { recursive: true, force: true });
    fs.rmSync(linuxDir, { recursive: true, force: true });
  }
});
