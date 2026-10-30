const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { startApi } = require('../server/api/api.cjs');

const root = path.resolve(__dirname, '..');
const fakeSolver = path.join(__dirname, 'fixtures', 'fake-solver.cjs');

async function boot() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpweft-projects-'));
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

async function json(base, method, route, body) {
  const response = await fetch(base + route, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('工程接口：空目录返回空清单与容量上限', async (t) => {
  const ctx = await boot();
  t.after(ctx.close);
  const { status, body } = await json(ctx.base, 'GET', '/api/projects');
  assert.equal(status, 200);
  assert.deepEqual(body.projects, []);
  assert.equal(body.activeId, null);
  assert.equal(body.limit, 30);
  assert.equal(body.active, null);
});

test('工程接口：新建、保存、重命名与切换会换入数据', async (t) => {
  const ctx = await boot();
  t.after(ctx.close);

  const baseline = (await json(ctx.base, 'GET', '/api/data')).body;
  const first = await json(ctx.base, 'POST', '/api/projects', { name: '甲校 2026 秋' });
  assert.equal(first.status, 201);
  assert.equal(first.body.activeId, first.body.project.id);
  assert.ok(fs.existsSync(path.join(ctx.dataDir, 'projects', first.body.project.id + '.json')));

  // 修改当前工作区，再保存回工程，快照体积应随之更新
  const edited = { ...baseline, school: { ...baseline.school, name: '甲校最新' } };
  assert.equal((await json(ctx.base, 'PUT', '/api/data', edited)).status, 200);
  const saved = await json(ctx.base, 'PUT', '/api/projects/' + first.body.project.id, { data: edited });
  assert.equal(saved.status, 200);
  assert.ok(saved.body.project.bytes > 0);

  const second = await json(ctx.base, 'POST', '/api/projects', {
    name: '乙校 2026 秋',
    data: { ...baseline, school: { ...baseline.school, name: '乙校' } },
  });
  assert.equal(second.status, 201);

  // 切回第一个工程：/api/data 必须变成甲校的数据
  const opened = await json(ctx.base, 'POST', '/api/projects/' + first.body.project.id + '/open', {});
  assert.equal(opened.status, 200);
  assert.equal(opened.body.data.school.name, '甲校最新');
  assert.equal((await json(ctx.base, 'GET', '/api/data')).body.school.name, '甲校最新');

  const renamed = await json(ctx.base, 'PATCH', '/api/projects/' + first.body.project.id, { name: '甲校改名' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.project.name, '甲校改名');

  const list = await json(ctx.base, 'GET', '/api/projects');
  assert.equal(list.body.projects.length, 2);
  assert.equal(list.body.activeId, first.body.project.id);
});

test('工程接口：切换冲突返回 409，force 后可继续', async (t) => {
  const ctx = await boot();
  t.after(ctx.close);
  const baseline = (await json(ctx.base, 'GET', '/api/data')).body;
  const a = await json(ctx.base, 'POST', '/api/projects', { name: 'A', data: baseline });
  const b = await json(ctx.base, 'POST', '/api/projects', {
    name: 'B',
    data: { ...baseline, school: { ...baseline.school, name: 'B 校' } },
  });

  const conflict = await json(ctx.base, 'POST', '/api/projects/' + a.body.project.id + '/open', {
    expectedActiveId: 'p_stale_0000',
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'PROJECT_CONFLICT');
  assert.equal(conflict.body.activeId, b.body.activeId);

  const forced = await json(ctx.base, 'POST', '/api/projects/' + a.body.project.id + '/open', { force: true });
  assert.equal(forced.status, 200);
});

test('工程接口：导入校验格式与版本', async (t) => {
  const ctx = await boot();
  t.after(ctx.close);
  const baseline = (await json(ctx.base, 'GET', '/api/data')).body;

  const wrongFormat = await json(ctx.base, 'POST', '/api/projects/import', {
    doc: { format: 'not-a-workspace', version: 1, data: baseline },
  });
  assert.equal(wrongFormat.status, 400);
  assert.equal(wrongFormat.body.code, 'WORKSPACE_FORMAT_INVALID');

  const wrongVersion = await json(ctx.base, 'POST', '/api/projects/import', {
    doc: { format: 'warpweft-workspace', version: 99, name: '未来版本', data: baseline },
  });
  assert.equal(wrongVersion.status, 400);
  assert.equal(wrongVersion.body.code, 'WORKSPACE_VERSION_UNSUPPORTED');

  const ok = await json(ctx.base, 'POST', '/api/projects/import', {
    doc: { format: 'warpweft-workspace', version: 1, name: '导入工程', savedAt: new Date().toISOString(), data: baseline },
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.project.name, '导入工程');
});

test('工程接口：删除工程并清理活动指针，非法 id 返回 404', async (t) => {
  const ctx = await boot();
  t.after(ctx.close);
  const created = await json(ctx.base, 'POST', '/api/projects', { name: '待删除' });
  const id = created.body.project.id;

  const removed = await json(ctx.base, 'DELETE', '/api/projects/' + id);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.activeId, null);
  assert.equal(fs.existsSync(path.join(ctx.dataDir, 'projects', id + '.json')), false);

  const traversal = await json(ctx.base, 'GET', '/api/projects/' + encodeURIComponent('../index'));
  assert.equal(traversal.status, 404);

  const missing = await json(ctx.base, 'POST', '/api/projects/' + id + '/open', {});
  assert.equal(missing.status, 404);
});

test('工程接口：超过单工程体积上限返回 413', async (t) => {
  const ctx = await boot();
  t.after(ctx.close);
  const baseline = (await json(ctx.base, 'GET', '/api/data')).body;
  const huge = {
    ...baseline,
    auditLog: Array.from({ length: 2150 }, (_, index) => ({ id: 'log-' + index, note: 'x'.repeat(2000) })),
  };
  const response = await json(ctx.base, 'POST', '/api/projects', { name: '超大工程', data: huge });
  assert.equal(response.status, 413);
  assert.equal(response.body.code, 'PROJECT_TOO_LARGE');
});
