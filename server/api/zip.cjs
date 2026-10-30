/**
 * 零依赖 ZIP 读写（store / deflate，无 zip64）。
 *
 * 为什么自己写：Linux 服务端（linux_server/）没有 package.json，只靠系统 Node
 * 与内置模块运行，引 jszip 会打破这一点。ZIP 的容器结构很稳定，配合内置
 * zlib.deflateRawSync / inflateRawSync 即可完整实现，约 200 行。
 *
 * 限制（与使用场景匹配）：
 * - 单文件 < 4 GiB（工程快照上限 4 MiB，远未触及 zip64）
 * - 只读我们自己写的包：不处理加密、分卷、数据描述符（bit 3）
 * - 文件名按 UTF-8 写入并置 bit 11，纯 ASCII 片名不受影响
 */
const zlib = require('node:zlib');

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** CRC32（IEEE 802.3），ZIP 每个条目都必须带。 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

/** DOS 时间格式；精度只有 2 秒，仅用于展示，不参与正确性。 */
function dosDateTime(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * 打包。entries: { name: string|Buffer }，对象/数组会先 JSON.stringify。
 * 小于 64 字节或压缩后反而变大的条目改用 store，避免无意义的 deflate 开销。
 */
function writeZip(entries, { compress = true, mtime = new Date() } = {}) {
  const { time, date } = dosDateTime(mtime);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, rawValue] of Object.entries(entries)) {
    const raw = Buffer.isBuffer(rawValue) ? rawValue : Buffer.from(String(rawValue), 'utf8');
    const nameBuffer = Buffer.from(name, 'utf8');
    let method = METHOD_STORE;
    let body = raw;
    if (compress && raw.length >= 64) {
      const deflated = zlib.deflateRawSync(raw, { level: 6 });
      if (deflated.length < raw.length) {
        method = METHOD_DEFLATE;
        body = deflated;
      }
    }
    const crc = crc32(raw);

    const local = Buffer.alloc(30 + nameBuffer.length);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuffer.copy(local, 30);
    locals.push(local, body);

    const central = Buffer.alloc(46 + nameBuffer.length);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuffer.copy(central, 46);
    centrals.push(central);

    offset += local.length + body.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(centrals.length, 8);
  eocd.writeUInt16LE(centrals.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuffer, eocd]);
}

function findEocd(buffer) {
  // EOCD 固定 22 字节 + 最多 65535 字节注释，从尾部向前找签名
  const min = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}

/** 解析为 Map<name, Buffer>；条目顺序保持写入顺序。 */
function readZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
    throw new Error('ZIP 内容过短');
  }
  const eocd = findEocd(buffer);
  if (eocd < 0) throw new Error('ZIP 缺少中央目录（不是有效的 zip 文件）');
  const count = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (centralOffset + centralSize > buffer.length) throw new Error('ZIP 中央目录越界');

  const entries = new Map();
  let cursor = centralOffset;
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(cursor) !== SIG_CENTRAL) throw new Error('ZIP 中央目录条目损坏');
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;

    if (buffer.readUInt32LE(localOffset) !== SIG_LOCAL) throw new Error('ZIP 本地文件头损坏：' + name);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const body = buffer.subarray(dataStart, dataStart + compressedSize);

    let raw;
    if (method === METHOD_STORE) raw = Buffer.from(body);
    else if (method === METHOD_DEFLATE) raw = zlib.inflateRawSync(body);
    else throw new Error('不支持的 ZIP 压缩方式：' + method + '（' + name + '）');

    if (raw.length !== uncompressedSize) throw new Error('ZIP 条目大小不匹配：' + name);
    if (crc32(raw) !== crc) throw new Error('ZIP 条目校验失败：' + name);
    entries.set(name, raw);
  }
  return entries;
}

/** 把 ZIP 解析成 { name: 解析后的 JSON }，非 JSON 条目原样返回 Buffer。 */
function readZipJson(buffer) {
  const result = {};
  for (const [name, raw] of readZip(buffer)) {
    if (name.endsWith('.json')) {
      try {
        result[name] = JSON.parse(raw.toString('utf8'));
      } catch (error) {
        throw new Error('ZIP 内 ' + name + ' 不是有效 JSON：' + error.message);
      }
    } else {
      result[name] = raw;
    }
  }
  return result;
}

module.exports = { writeZip, readZip, readZipJson, crc32 };
