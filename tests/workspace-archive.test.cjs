const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { startApi } = require('../server/api/api.cjs');
const { decodeSnapshot } = require('../server/api/projectSnapshot.cjs');
const { writeZip } = require('../server/api/zip.cjs');

const root = path.resolve(__dirname, '..');
const fakeSolver = path.join(__dirname, 'fixtures', 'fake-solver.cjs');

async function boot() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpweft-archive-'));
  const server = startApi({
    rootDir: root,
    dataDir,
    port: 0,
    packaged: false,
    solverCommand: process.execPath,
    solverArgs: [fakeSolver],
    configFile: path.join(dataDir, 'server-config.json'),
  });
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const close = async () => {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
  return { base, dataDir, close };
}

test('导出：返回工程包 ZIP，内容与当前工作区一致', async (t) => {
  const ctx = await boot();
  t.after(ctx.close);
  const baseline = await (await fetch(ctx.base + '/api/data')).json();

  const response = await fetch(ctx.base + '/api/workspace/export?name=' + encodeURIComponent('导出测试'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/zip');
  assert.match(response.headers.get('content-disposition') || '', /attachment/);
  assert.match(response.headers.get('content-disposition') || '', /filename\*=UTF-8''/);

  const buffer = Buffer.from(await response.arrayBuffer());
  assert.equal(buffer[0], 0x50, 'ZIP 魔数 PK');
  assert.equal(buffer[1], 0x4b);

  const doc = decodeSnapshot(buffer);
  assert.equal(doc.name, '导出测试');
  assert.deepEqual(doc.data.classes, baseline.classes);
  assert.deepEqual(doc.data.coursePlans, baseline.coursePlans);
  assert.deepEqual(doc.data.candidate, baseline.candidate);
});

test('导出：未指定名称时回退到学校名', async (t) => {
  const ctx = await boot();
  t.after(ctx.close);
  const baseline = await (await fetch(ctx.base + '/api/data')).json();
  const response = await fetch(ctx.base + '/api/workspace/export');
  assert.equal(response.status, 200);
  const doc = decodeSnapshot(Buffer.from(await response.arrayBuffer()));
  assert.equal(doc.name, baseline.school.name);
});

test('导出 → 导入：往返后工程内容一致且自动激活', async (t) => {
  const ctx = await boot();
  t.after(ctx.close);
  const baseline = await (await fetch(ctx.base + '/api/data')).json();

  const exported = await fetch(ctx.base + '/api/workspace/export?name=' + encodeURIComponent('往返测试'));
  const buffer = Buffer.from(await exported.arrayBuffer());

  const imported = await fetch(ctx.base + '/api/projects/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: new Uint8Array(buffer),
  });
  assert.equal(imported.status, 201);
  const created = await imported.json();
  assert.equal(created.project.name, '往返测试');
  assert.equal(created.activeId, created.project.id);
  assert.equal(created.project.counts.classes, baseline.classes.length);

  const stored = await (await fetch(ctx.base + '/api/projects/' + created.project.id)).json();
  assert.deepEqual(stored.doc.data.coursePlans, baseline.coursePlans);

  // 服务端落的是 .zip
  assert.equal(fs.existsSync(path.join(ctx.dataDir, 'projects', created.project.id + '.zip')), true);
});

test('导入：合法 ZIP 但不是工程包时返回 400', async (t) => {
  const ctx = await boot();
  t.after(ctx.close);
  const notWorkspace = writeZip({ 'a.json': '{"x":1}' });
  const response = await fetch(ctx.base + '/api/projects/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: new Uint8Array(notWorkspace),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'WORKSPACE_ARCHIVE_INVALID');
});

test('导入：根本不是 ZIP 时返回 400', async (t) => {
  const ctx = await boot();
  t.after(ctx.close);
  const response = await fetch(ctx.base + '/api/projects/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(Buffer.from('plain text, not a zip')),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'WORKSPACE_ARCHIVE_INVALID');
});
