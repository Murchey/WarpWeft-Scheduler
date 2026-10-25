const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const verifier = path.join(root, 'linux_server', 'verify-manifest.cjs');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

test('Linux build manifest verifier catches a partially updated package', () => {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpweft-manifest-'));
  const files = {
    rendererIndex: path.join(appDir, 'dist', 'index.html'),
    serverApi: path.join(appDir, 'server', 'api', 'api.cjs'),
    serverEntry: path.join(appDir, 'linux_server', 'server.cjs'),
    dataSchema: path.join(appDir, 'data-schema.json'),
    solverJar: path.join(appDir, 'resources', 'solver', 'warpweft-solver.jar'),
  };
  write(files.rendererIndex, '<div id="root"></div>');
  const assetFile = path.join(appDir, 'dist', 'assets', 'app.js');
  write(assetFile, 'console.log(1);');
  write(files.serverApi, 'module.exports = {};');
  write(files.serverEntry, 'require("./server/api/api.cjs");');
  write(files.dataSchema, JSON.stringify({ version: 4, solverProtocol: '1.0', features: ['homeroom'] }));
  write(files.solverJar, 'jar');
  const manifest = {
    appVersion: '0.1.0',
    schemaVersion: 4,
    solverProtocol: '1.0',
    capabilities: ['homeroom'],
    assetHashes: { './assets/app.js': sha256(assetFile) },
    hashes: Object.fromEntries(Object.entries(files).map(([key, file]) => [key, sha256(file)])),
  };
  write(path.join(appDir, 'warpweft-build.json'), JSON.stringify(manifest));
  const healthFile = path.join(appDir, 'health.json');
  write(healthFile, JSON.stringify({
    appVersion: '0.1.0',
    schemaVersion: 4,
    solverProtocol: '1.0',
    capabilities: ['homeroom'],
  }));

  try {
    const ok = spawnSync(process.execPath, [verifier, healthFile, appDir], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);

    write(files.serverApi, 'module.exports = { changed: true };');
    const broken = spawnSync(process.execPath, [verifier, healthFile, appDir], { encoding: 'utf8' });
    assert.notEqual(broken.status, 0, 'a partial update must fail verification');
    assert.match(broken.stdout + broken.stderr, /serverApi/);

    write(files.serverApi, 'module.exports = {};');
    write(assetFile, 'console.log(2);');
    const staleAsset = spawnSync(process.execPath, [verifier, healthFile, appDir], { encoding: 'utf8' });
    assert.notEqual(staleAsset.status, 0, 'a stale renderer asset must fail verification');
    assert.match(staleAsset.stdout + staleAsset.stderr, /app\.js/);
  } finally {
    fs.rmSync(appDir, { recursive: true, force: true });
  }
});
