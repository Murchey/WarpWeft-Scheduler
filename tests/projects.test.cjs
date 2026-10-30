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
  assert.ok(fs.existsSync(path.join(ctx.dataDir, 'projects', first.body.project.id + '.zip')));

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
  assert.equal(fs.existsSync(path.join(ctx.dataDir, 'projects', id + '.zip')), false);

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

test('工程接口：分片 ZIP 快照可读且压缩后体积更小', async (t) => {
  const ctx = await boot();
  t.after(ctx.close);
  const baseline = (await json(ctx.base, 'GET', '/api/data')).body;
  // 造一份超过分片阈值的数据，验证压缩收益
  const bulk = {
    ...baseline,
    classes: Array.from({ length: 200 }, (_, i) => ({
      id: 'c' + i,
      name: '测试班' + i,
      size: 40,
      grade: '一年级',
    })),
  };
  const created = await json(ctx.base, 'POST', '/api/projects', { name: 'ZIP 工程', data: bulk });
  assert.equal(created.status, 201);

  const file = path.join(ctx.dataDir, 'projects', created.body.project.id + '.zip');
  const zip = fs.readFileSync(file);
  // ZIP 魔数 PK\x03\x04
  assert.equal(zip[0], 0x50);
  assert.equal(zip[1], 0x4b);
  const rawBytes = Buffer.byteLength(JSON.stringify(bulk), 'utf8');
  assert.ok(zip.length < rawBytes, '压缩包应小于原始 JSON：' + zip.length + ' vs ' + rawBytes);
  // 清单里记录的是压缩后体积
  assert.equal(created.body.project.bytes, zip.length);
  assert.ok(created.body.project.rawBytes > zip.length);

  const read = await json(ctx.base, 'GET', '/api/projects/' + created.body.project.id);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.doc.data.classes, bulk.classes);
  assert.deepEqual(read.body.doc.data.coursePlans, bulk.coursePlans);
});

test('工程接口：v1 单文件快照在首次读取时自动迁移为 ZIP', async (t) => {
  const ctx = await boot();
  t.after(ctx.close);
  const baseline = (await json(ctx.base, 'GET', '/api/data')).body;

  const id = 'p_legacy_0001';
  const projectsDir = path.join(ctx.dataDir, 'projects');
  fs.mkdirSync(projectsDir, { recursive: true });
  const now = new Date().toISOString();
  // 手工构造 v1 布局：index.json 指向一个单文件 .json 快照
  fs.writeFileSync(
    path.join(projectsDir, 'index.json'),
    JSON.stringify({
      version: 1,
      activeId: null,
      activeClientId: null,
      activeAt: null,
      projects: [
        {
          id,
          name: '旧版工程',
          createdAt: now,
          updatedAt: now,
          syncedAt: null,
          bytes: 100,
          schoolName: baseline.school.name,
          counts: { classes: baseline.classes.length, teachers: baseline.teachers.length, coursePlans: baseline.coursePlans.length },
        },
      ],
    }),
    'utf8',
  );
  fs.writeFileSync(
    path.join(projectsDir, id + '.json'),
    JSON.stringify({ format: 'warpweft-workspace', version: 1, name: '旧版工程', savedAt: now, data: baseline }),
    'utf8',
  );

  const read = await json(ctx.base, 'GET', '/api/projects/' + id);
  assert.equal(read.status, 200);
  assert.equal(read.body.doc.name, '旧版工程');
  assert.deepEqual(read.body.doc.data.coursePlans, baseline.coursePlans);

  // 迁移结果：.zip 生成，旧文件被改名保留
  assert.equal(fs.existsSync(path.join(projectsDir, id + '.zip')), true);
  assert.equal(fs.existsSync(path.join(projectsDir, id + '.json')), false);
  assert.equal(fs.existsSync(path.join(projectsDir, id + '.json.migrated')), true);

  // 再次读取应走 ZIP，且内容一致
  const again = await json(ctx.base, 'GET', '/api/projects/' + id);
  assert.equal(again.status, 200);
  assert.deepEqual(again.body.doc.data.classes, baseline.classes);

  // 删除工程时，迁移残留也要一并清理
  const removed = await json(ctx.base, 'DELETE', '/api/projects/' + id);
  assert.equal(removed.status, 200);
  assert.equal(fs.existsSync(path.join(projectsDir, id + '.zip')), false);
  assert.equal(fs.existsSync(path.join(projectsDir, id + '.json.migrated')), false);
});
