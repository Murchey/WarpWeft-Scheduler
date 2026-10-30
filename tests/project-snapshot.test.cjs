const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeZip, readZip, readZipJson, crc32 } = require('../server/api/zip.cjs');
const {
  encodeSnapshot,
  decodeSnapshot,
  isZipBuffer,
} = require('../server/api/projectSnapshot.cjs');

function workspace(overrides = {}) {
  return {
    school: { id: 's1', name: '实验中学' },
    roomMode: 'full',
    dataSchemaVersion: 4,
    classes: [{ id: 'c1', name: '一年级1班', size: 40, grade: '一年级' }],
    teachers: [{ id: 't1', name: '张老师' }],
    subjects: [{ id: 'sub1', name: '语文' }],
    rooms: [{ id: 'r1', name: '101', capacity: 45, type: '普通' }],
    timeSlots: [{ id: 'slot1', day: 1, period: 1, label: '周一第1节' }],
    coursePlans: [{ id: 'p1', classId: 'c1', subjectId: 'sub1', teacherId: 't1', weeklyPeriods: 5 }],
    unavailableSlots: [],
    rules: [],
    softConstraints: [{ kind: 'CLASS_GAPS', weight: 2 }],
    candidate: null,
    published: null,
    adjustments: [],
    lessonLogs: [],
    auditLog: [],
    ...overrides,
  };
}

test('ZIP：往返保持内容与 CRC', () => {
  const zip = writeZip({ 'a.json': '{"x":1}', 'dir/b.txt': 'hello world', 'raw.json': JSON.stringify({ list: [1, 2, 3] }) });
  const entries = readZip(zip);
  assert.equal(entries.size, 3);
  assert.equal(entries.get('a.json').toString('utf8'), '{"x":1}');
  assert.equal(entries.get('dir/b.txt').toString('utf8'), 'hello world');
  assert.deepEqual(readZipJson(zip)['raw.json'], { list: [1, 2, 3] });
});

test('ZIP：CRC 被篡改时拒绝读取', () => {
  const zip = writeZip({ 'a.json': JSON.stringify({ big: 'x'.repeat(200) }) });
  const copy = Buffer.from(zip);
  // 破坏 deflate 数据区（本地头 30 + 文件名 6 之后）
  copy[40] = copy[40] ^ 0xff;
  assert.throws(() => readZip(copy), /ZIP/);
});

test('ZIP：crc32 与已知值一致', () => {
  // "123456789" 的 CRC32 标准测试向量为 0xCBF43926
  assert.equal(crc32(Buffer.from('123456789', 'utf8')), 0xcbf43926);
});

/** 造一份足够大、会触发分片的工作区（超过 32 KB 阈值）。 */
function largeWorkspace() {
  return workspace({
    classes: Array.from({ length: 60 }, (_, i) => ({
      id: 'c' + i,
      name: '一年级' + i + '班',
      size: 40,
      grade: '一年级',
    })),
    coursePlans: Array.from({ length: 600 }, (_, i) => ({
      id: 'p' + i,
      classId: 'c' + (i % 60),
      subjectId: 'sub1',
      teacherId: 't1',
      weeklyPeriods: 2,
    })),
  });
}

test('快照：小工程用单条目布局，避免分片的固定开销', () => {
  const data = workspace();
  const { buffer, manifest } = encodeSnapshot(data, { name: '空工程' });
  assert.equal(manifest.layout, 'single');
  assert.deepEqual([...readZip(buffer).keys()], ['manifest.json', 'data.json']);
  // 空工作区约 500 字节，ZIP 固定开销必须控制在 1 KB 内
  assert.ok(buffer.length < Buffer.byteLength(JSON.stringify(data), 'utf8') + 1024);
  assert.deepEqual(decodeSnapshot(buffer).data.classes, data.classes);
});

test('快照：大工程按 core/results/history 分片并可无损还原', () => {
  const data = largeWorkspace();
  data.candidate = { status: 'COMPLETED', entries: [{ id: 'e1' }] };
  const { buffer, manifest } = encodeSnapshot(data, { name: '甲校 2026 秋' });
  assert.ok(isZipBuffer(buffer));
  assert.equal(manifest.name, '甲校 2026 秋');
  assert.equal(manifest.format, 'warpweft-workspace');
  assert.equal(manifest.layout, 'sharded');

  const names = [...readZip(buffer).keys()];
  // 分片按 core/results/history 归类，manifest 排在最前
  assert.equal(names[0], 'manifest.json');
  assert.ok(names.includes('core/classes.json'));
  assert.ok(names.includes('core/coursePlans.json'));
  assert.ok(names.includes('results/candidate.json'));
  assert.ok(names.includes('history/auditLog.json'));

  const doc = decodeSnapshot(buffer);
  assert.equal(doc.name, '甲校 2026 秋');
  assert.equal(doc.format, 'warpweft-workspace');
  assert.equal(doc.data.roomMode, 'full');
  assert.equal(doc.data.dataSchemaVersion, 4);
  assert.deepEqual(doc.data.classes, data.classes);
  assert.deepEqual(doc.data.coursePlans, data.coursePlans);
  assert.deepEqual(doc.data.candidate, data.candidate);
  // 标量字段不应重复写进分片
  assert.equal(names.includes('core/roomMode.json'), false);
});

test('快照：null 结果字段与未知字段都能保留', () => {
  const data = workspace({ candidate: null, published: null, futureField: { a: 1 } });
  const doc = decodeSnapshot(encodeSnapshot(data, { name: 'x' }).buffer);
  assert.equal(doc.data.candidate, null);
  assert.equal(doc.data.published, null);
  assert.deepEqual(doc.data.futureField, { a: 1 }, '未知字段应通过 extra.json 兜底保留');
});

test('快照：损坏的包给出可读错误而不是抛出底层异常', () => {
  assert.throws(() => decodeSnapshot(Buffer.from('not a zip at all')), /ZIP|zip/);
  const emptyZip = writeZip({ 'core/classes.json': '[]' });
  assert.throws(() => decodeSnapshot(emptyZip), /manifest/);
});

test('快照：压缩后体积显著小于原始 JSON', () => {
  const data = workspace({
    classes: Array.from({ length: 60 }, (_, i) => ({ id: 'c' + i, name: '班级' + i, size: 40, grade: '一年级' })),
    coursePlans: Array.from({ length: 600 }, (_, i) => ({
      id: 'p' + i,
      classId: 'c' + (i % 60),
      subjectId: 'sub1',
      teacherId: 't1',
      weeklyPeriods: 2,
    })),
  });
  const raw = Buffer.byteLength(JSON.stringify(data), 'utf8');
  const { buffer } = encodeSnapshot(data, { name: '体积' });
  assert.ok(buffer.length < raw / 3, '压缩后应至少缩小到三分之一，实际 ' + buffer.length + '/' + raw);
});

test('快照：真实工作区文件可被编码并还原（存在时）', () => {
  const file = path.join(__dirname, '..', 'data', 'warpweft.json');
  if (!fs.existsSync(file)) return;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const started = process.hrtime.bigint();
  const { buffer } = encodeSnapshot(data, { name: '真实数据' });
  const encodeMs = Number(process.hrtime.bigint() - started) / 1e6;
  const decodeStarted = process.hrtime.bigint();
  const doc = decodeSnapshot(buffer);
  const decodeMs = Number(process.hrtime.bigint() - decodeStarted) / 1e6;

  assert.deepEqual(doc.data.coursePlans, data.coursePlans);
  assert.deepEqual(doc.data.candidate, data.candidate);
  assert.ok(buffer.length < Buffer.byteLength(JSON.stringify(data), 'utf8'));
  console.log(
    '    真实数据：原始 ' +
      Math.round(Buffer.byteLength(JSON.stringify(data), 'utf8') / 1024) +
      ' KB → 包 ' +
      Math.round(buffer.length / 1024) +
      ' KB，编码 ' +
      encodeMs.toFixed(1) +
      ' ms，解码 ' +
      decodeMs.toFixed(1) +
      ' ms',
  );
});

test('临时目录不被写入（防止测试污染工作区）', () => {
  // 仅占位：确保上面的测试没有在仓库内产生文件
  const stray = fs
    .readdirSync(path.join(__dirname, '..', 'server', 'api'))
    .filter((name) => name.endsWith('.zip'));
  assert.deepEqual(stray, []);
  assert.ok(os.tmpdir());
});
