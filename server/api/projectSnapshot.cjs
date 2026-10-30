/**
 * 工程快照的编解码：工作区对象 ↔ 分片 ZIP。
 *
 * 为什么分片：一次工作区快照里 `candidate`（排课结果）通常占 40%–50%，
 * `coursePlans` 再占 ~18%，其余基础资料合计不到 3%。分片后每类数据是独立
 * 的 JSON 条目，既能单独查看/比对，也便于将来按需只解压需要的部分。
 *
 * 容器用零依赖 ZIP（server/api/zip.cjs）：747 KB 的工作区压到约 51 KB，
 * 磁盘与跨机拷贝的字节数下降一个数量级。
 *
 * ZIP 内布局：
 *   manifest.json          格式版本、名称、保存时间、roomMode、计数、分片清单
 *   core/school.json       …基础资料，一类一个文件
 *   results/candidate.json 排课结果（体积大头，单独成片）
 *   history/auditLog.json  调代课 / 日志
 *   extra.json             未知字段兜底，保证前向兼容不丢数据
 */
const { writeZip, readZip } = require('./zip.cjs');

const WORKSPACE_FORMAT = 'warpweft-workspace';
const WORKSPACE_VERSION = 2;
const SNAPSHOT_EXT = '.zip';

const GROUPS = {
  core: [
    'school',
    'classes',
    'teachers',
    'subjects',
    'rooms',
    'timeSlots',
    'coursePlans',
    'electiveGroups',
    'unavailableSlots',
    'rules',
    'softConstraints',
    'semester',
  ],
  results: ['candidate', 'published', 'candidateVersion', 'publishedVersion'],
  history: ['adjustments', 'lessonLogs', 'auditLog'],
};

const GROUP_OF = {};
for (const [group, keys] of Object.entries(GROUPS)) {
  for (const key of keys) GROUP_OF[key] = group;
}

/** 放进 manifest 的标量字段，不单独成片（updatedAt 是时间戳，与 savedAt 同源）。 */
const MANIFEST_SCALARS = ['roomMode', 'dataSchemaVersion', 'updatedAt'];

/**
 * 小于该阈值时不分片：每个 ZIP 条目有 ~76 字节固定开销，20 个分片就是 1.5 KB，
 * 对空工程（约 500 字节）反而会膨胀数倍。数据量小的时候单条目更划算。
 */
const SINGLE_LAYOUT_THRESHOLD = 32 * 1024;

function countSummary(data) {
  return {
    classes: Array.isArray(data?.classes) ? data.classes.length : 0,
    teachers: Array.isArray(data?.teachers) ? Math.max(0, data.teachers.length) : 0,
    coursePlans: Array.isArray(data?.coursePlans) ? data.coursePlans.length : 0,
  };
}

/** 工作区对象 → 分片 ZIP Buffer。 */
function encodeSnapshot(data, { name, savedAt = new Date().toISOString() } = {}) {
  if (!data || typeof data !== 'object') throw new Error('工程数据格式无效，无法打包');
  const entries = {};
  const shards = [];
  const extra = {};
  const manifest = {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    name: typeof name === 'string' && name ? name : '未命名工程',
    savedAt,
    counts: countSummary(data),
  };

  for (const key of MANIFEST_SCALARS) {
    if (data[key] !== undefined) manifest[key] = data[key];
  }

  const rawData = JSON.stringify(data);
  if (Buffer.byteLength(rawData, 'utf8') < SINGLE_LAYOUT_THRESHOLD) {
    // 小工程：一个 data.json，避免分片的固定开销
    manifest.layout = 'single';
    manifest.shards = [{ name: 'data.json', bytes: Buffer.byteLength(rawData, 'utf8') }];
    entries['data.json'] = rawData;
    return { buffer: writeZip({ 'manifest.json': JSON.stringify(manifest, null, 2), ...entries }, { mtime: new Date(savedAt) }), manifest };
  }

  manifest.layout = 'sharded';
  for (const [key, value] of Object.entries(data)) {
    if (MANIFEST_SCALARS.includes(key)) continue;
    const group = GROUP_OF[key];
    if (!group) {
      extra[key] = value;
      continue;
    }
    const entryName = group + '/' + key + '.json';
    entries[entryName] = JSON.stringify(value ?? null);
    shards.push({ name: entryName, key, bytes: Buffer.byteLength(entries[entryName]) });
  }

  if (Object.keys(extra).length > 0) {
    entries['extra.json'] = JSON.stringify(extra);
    shards.push({ name: 'extra.json', bytes: Buffer.byteLength(entries['extra.json']) });
  }

  manifest.shards = shards;
  // manifest 必须排在最前，方便人工用解压工具快速看到概况
  const ordered = { 'manifest.json': JSON.stringify(manifest, null, 2), ...entries };
  return { buffer: writeZip(ordered, { mtime: new Date(savedAt) }), manifest };
}

/** 分片 ZIP Buffer → { format, version, name, savedAt, data } */
function decodeSnapshot(buffer) {
  const entries = readZip(buffer);
  const manifestRaw = entries.get('manifest.json');
  if (!manifestRaw) throw new Error('工程包缺少 manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(manifestRaw.toString('utf8'));
  } catch (error) {
    throw new Error('manifest.json 不是有效 JSON：' + error.message);
  }
  if (!manifest || manifest.format !== WORKSPACE_FORMAT) {
    throw new Error('这不是 WarpWeft 工程包');
  }

  const data = {};
  const single = entries.get('data.json');
  if (single) {
    let parsed;
    try {
      parsed = JSON.parse(single.toString('utf8'));
    } catch (error) {
      throw new Error('工程包内 data.json 不是有效 JSON：' + error.message);
    }
    Object.assign(data, parsed);
  } else {
    for (const [entryName, raw] of entries) {
      if (entryName === 'manifest.json') continue;
      const base = entryName.split('/').pop();
      if (!base.endsWith('.json')) continue;
      const key = base.slice(0, -'.json'.length);
      let value;
      try {
        value = JSON.parse(raw.toString('utf8'));
      } catch (error) {
        throw new Error('工程包内 ' + entryName + ' 不是有效 JSON：' + error.message);
      }
      if (key === 'extra' && value && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(data, value);
        continue;
      }
      data[key] = value;
    }
    for (const key of MANIFEST_SCALARS) {
      if (manifest[key] !== undefined) data[key] = manifest[key];
    }
  }

  return {
    format: manifest.format,
    version: Number(manifest.version) || 1,
    name: typeof manifest.name === 'string' ? manifest.name : '未命名工程',
    savedAt: typeof manifest.savedAt === 'string' ? manifest.savedAt : new Date().toISOString(),
    data,
  };
}

/** 是否是 ZIP 容器（PK\x03\x04）。用于区分新格式与旧的单文件 JSON。 */
function isZipBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

module.exports = {
  WORKSPACE_FORMAT,
  WORKSPACE_VERSION,
  SNAPSHOT_EXT,
  GROUPS,
  encodeSnapshot,
  decodeSnapshot,
  isZipBuffer,
  countSummary,
};
