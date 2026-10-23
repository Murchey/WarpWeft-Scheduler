const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { openDatabase } = require('./database.cjs');
const {
  loadConfig,
  normalizeIp,
  ipAllowed,
  normalizeConfig,
  saveConfig,
} = require('./server-config.cjs');

const MAX_BODY = 5 * 1024 * 1024;
const MAX_JOBS = 100;
const MAX_LOGS = 500;
const CLIENT_TTL_MS = 90_000;
const CLIENT_PRUNE_MS = 30_000;
const MAX_LONG_JOBS = 20;
const LONG_JOB_MIN_SECONDS = 60;
const LONG_JOB_MAX_SECONDS = 6 * 60 * 60;
const LONG_JOB_MAX_STAGNATION = 60 * 60;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Client-Id');
  res.setHeader('Cache-Control', 'no-store');
}

function send(res, status, payload) {
  if (res.writableEnded) return;
  cors(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function fail(res, status, error, code, extra = {}) {
  send(res, status, { error, code, ...extra });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        const error = new Error('请求体过大');
        error.statusCode = 413;
        error.code = 'PAYLOAD_TOO_LARGE';
        reject(error);
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/**
 * Drop date-level records whose referenced resource was removed. This keeps
 * deleting a time slot / class / teacher / room from turning every later save
 * into a hard validation error about a stale adjustment.
 */
function sanitizeOrphanReferences(data) {
  if (!data || typeof data !== 'object') return data;
  const classIds = new Set(Array.isArray(data.classes) ? data.classes.map((item) => item.id) : []);
  const teacherIds = new Set(Array.isArray(data.teachers) ? data.teachers.map((item) => item.id) : []);
  const subjectIds = new Set(Array.isArray(data.subjects) ? data.subjects.map((item) => item.id) : []);
  const roomIds = new Set(Array.isArray(data.rooms) ? data.rooms.map((item) => item.id) : []);
  const slotIds = new Set(Array.isArray(data.timeSlots) ? data.timeSlots.map((item) => item.id) : []);
  if (Array.isArray(data.adjustments)) {
    data.adjustments = data.adjustments.filter((item) =>
      item &&
      classIds.has(item.classId) &&
      slotIds.has(item.slotId) &&
      (!item.targetSlotId || slotIds.has(item.targetSlotId)) &&
      (!item.substituteTeacherId || teacherIds.has(item.substituteTeacherId)) &&
      (!item.roomId || roomIds.has(item.roomId)),
    );
  }
  if (Array.isArray(data.lessonLogs)) {
    data.lessonLogs = data.lessonLogs.filter((item) =>
      item &&
      classIds.has(item.classId) &&
      slotIds.has(item.slotId) &&
      teacherIds.has(item.teacherId) &&
      teacherIds.has(item.originalTeacherId) &&
      subjectIds.has(item.subjectId),
    );
  }
  if (Array.isArray(data.unavailableSlots)) {
    data.unavailableSlots = data.unavailableSlots.filter((item) =>
      item && teacherIds.has(item.teacherId) && slotIds.has(item.slotId),
    );
  }
  if (Array.isArray(data.teachers)) {
    const classNames = new Set(data.classes.map((item) => String(item.name ?? '').trim().toLowerCase()));
    data.teachers = data.teachers.map((teacher) => {
      if (!teacher || teacher.classes === undefined || teacher.classes === null) return teacher;
      const names = Array.isArray(teacher.classes)
        ? teacher.classes.map((item) => String(item).trim()).filter(Boolean)
        : String(teacher.classes).split(/[,，;；、]+/).map((item) => item.trim()).filter(Boolean);
      const remaining = names.filter((name) => classNames.has(name.toLowerCase()));
      if (remaining.length === names.length) return teacher;
      return { ...teacher, classes: remaining.join('、') || undefined };
    });
  }
  return data;
}
function validateData(data) {
  if (!data || typeof data !== 'object') return '数据格式无效';
  for (const key of ['classes', 'teachers', 'subjects', 'rooms', 'timeSlots', 'coursePlans']) {
    if (!Array.isArray(data[key])) return key + ' 必须是数组';
  }
  if (data.semester !== undefined && data.semester !== null) {
    const semester = data.semester;
    const parse = (value) => {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
      const date = new Date(value + 'T00:00:00Z');
      if (!Number.isFinite(date.getTime())) return null;
      return date.toISOString().slice(0, 10) === value ? date : null;
    };
    const start = parse(semester.startDate);
    const end = parse(semester.endDate);
    if (!start || !end) return '学期日期格式必须是 YYYY-MM-DD（且为有效日期）';
    if (start.getTime() > end.getTime()) return '学期开始日期不能晚于结束日期';
    if (end.getTime() - start.getTime() > 2 * 366 * 86400000) return '学期跨度不能超过 2 年';
  }
  const unique = (items, label) => {
    const seen = new Set();
    for (const item of items) {
      if (!item || typeof item.id !== 'string' || !item.id.trim()) return label + '存在空 ID';
      if (seen.has(item.id)) return label + '存在重复 ID：' + item.id;
      seen.add(item.id);
    }
    return null;
  };
  for (const [items, label] of [
    [data.classes, '班级'],
    [data.teachers, '教师'],
    [data.subjects, '学科'],
    [data.rooms, '教室'],
    [data.timeSlots, '时间段'],
    [data.coursePlans, '教学计划'],
  ]) {
    const error = unique(items, label);
    if (error) return error;
  }
  const classIds = new Set(data.classes.map((item) => item.id));
  const classNameById = new Map(data.classes.map((item) => [item.id, item.name]));
  const classByName = new Map(data.classes.map((item) => [String(item.name).trim().toLowerCase(), item.id]));
  const teacherIds = new Set(data.teachers.map((item) => item.id));
  const teacherById = new Map(data.teachers.map((item) => [item.id, item]));
  const subjectIds = new Set(data.subjects.map((item) => item.id));
  const roomIds = new Set(data.rooms.map((item) => item.id));
  const slotIds = new Set(data.timeSlots.map((item) => item.id));
  const classNamesOf = (teacher) => {
    if (Array.isArray(teacher.classes)) return teacher.classes.map((item) => String(item).trim()).filter(Boolean);
    return String(teacher.classes ?? '')
      .split(/[,，;；、]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  };
  for (const teacher of data.teachers) {
    for (const name of classNamesOf(teacher)) {
      if (!classByName.has(name.toLowerCase())) return '教师 ' + teacher.id + ' 的负责班级不存在：' + name;
    }
  }
  for (const room of data.rooms) {
    if (!(Number(room.capacity) > 0)) return '教室 ' + room.id + ' 的容量必须大于 0';
  }
  for (const slot of data.timeSlots) {
    if (!(Number(slot.day) > 0) || !(Number(slot.period) > 0)) return '时间段 ' + slot.id + ' 的星期和节次必须大于 0';
    if (slot.kind !== undefined && slot.kind !== null && !['morning', 'regular', 'evening', 'makeup'].includes(slot.kind)) {
      return '时间段 ' + slot.id + ' 的时段类型无效（只能是 morning/regular/evening/makeup）';
    }
    if (slot.start !== undefined && slot.start !== null && slot.start !== '' && !/^\d{1,2}:\d{2}$/.test(String(slot.start))) {
      return '时间段 ' + slot.id + ' 的开始时间无效（应为 HH:MM）';
    }
    if (slot.duration !== undefined && slot.duration !== null && !(Number(slot.duration) >= 0)) {
      return '时间段 ' + slot.id + ' 的时长必须是非负数';
    }
  }
  for (const plan of data.coursePlans) {
    if (!classIds.has(plan.classId)) return '教学计划 ' + plan.id + ' 引用了不存在的班级';
    if (plan.teacherId && !teacherIds.has(plan.teacherId)) return '教学计划 ' + plan.id + ' 引用了不存在的教师';
    const teacher = plan.teacherId ? teacherById.get(plan.teacherId) : undefined;
    if (teacher) {
      const names = classNamesOf(teacher).map((item) => item.toLowerCase());
      if (names.length && !names.includes(String(classNameById.get(plan.classId) ?? '').trim().toLowerCase())) {
        return '教师 ' + teacher.id + ' 不负责教学计划 ' + plan.id + ' 的班级';
      }
    }
    if (!subjectIds.has(plan.subjectId)) return '教学计划 ' + plan.id + ' 引用了不存在的学科';
    if (plan.fixedSlotId && !slotIds.has(plan.fixedSlotId)) return '教学计划 ' + plan.id + ' 引用了不存在的固定时间';
    if (plan.weeks !== undefined && plan.weeks !== null && !['all', 'odd', 'even'].includes(plan.weeks)) {
      return '教学计划 ' + plan.id + ' 的周次无效（只能是 all/odd/even）';
    }
    if (plan.kind !== undefined && plan.kind !== null && !['morning', 'regular', 'evening', 'makeup'].includes(plan.kind)) {
      return '教学计划 ' + plan.id + ' 的时段类型无效';
    }
    if (!(Number(plan.weeklyPeriods) > 0)) return '教学计划 ' + plan.id + ' 的周课时必须大于 0';
  }
  for (const item of data.unavailableSlots || []) {
    if (!teacherIds.has(item.teacherId)) return '教师不可用时间引用了不存在的教师';
    if (!slotIds.has(item.slotId)) return '教师不可用时间引用了不存在的时间段';
  }
  for (const collection of [data.candidate, data.published]) {
    if (!collection || !Array.isArray(collection.entries)) continue;
    for (const entry of collection.entries) {
      if (!classIds.has(entry.classId) || (entry.teacherId && !teacherIds.has(entry.teacherId)) || !roomIds.has(entry.roomId) || !slotIds.has(entry.slotId)) return '课表条目 ' + entry.id + ' 引用了不存在的资源';
    }
  }
  if (data.adjustments !== undefined) {
    if (!Array.isArray(data.adjustments)) return 'adjustments 必须是数组';
    const teacherIdsForAdjustment = teacherIds;
    for (const item of data.adjustments) {
      if (!item || typeof item.id !== 'string' || !item.id.trim()) return '调代课记录缺少 ID';
      if (!['move', 'substitute', 'cancel'].includes(item.type)) return '调代课记录 ' + item.id + ' 的类型无效';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(item.date || ''))) return '调代课记录 ' + item.id + ' 的日期无效';
      if (!slotIds.has(item.slotId)) return '调代课记录 ' + item.id + ' 引用了不存在的时间段';
      if (!classIds.has(item.classId)) return '调代课记录 ' + item.id + ' 引用了不存在的班级';
      if (item.type === 'move' && !slotIds.has(item.targetSlotId || '')) return '调代课记录 ' + item.id + ' 的调课目标无效';
      if (item.type === 'substitute' && !teacherIdsForAdjustment.has(item.substituteTeacherId || '')) return '调代课记录 ' + item.id + ' 的代课教师不存在';
      if (item.roomId && !roomIds.has(item.roomId)) return '调代课记录 ' + item.id + ' 引用了不存在的教室';
      if (item.status !== 'active' && item.status !== 'revoked') return '调代课记录 ' + item.id + ' 的状态无效';
    }
  }
  if (data.lessonLogs !== undefined) {
    if (!Array.isArray(data.lessonLogs)) return 'lessonLogs 必须是数组';
    const logIds = new Set();
    for (const item of data.lessonLogs) {
      if (!item || typeof item.id !== 'string' || !item.id.trim()) return '上课记录缺少 ID';
      if (logIds.has(item.id)) return '上课记录 ID 重复：' + item.id;
      logIds.add(item.id);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(item.date || ''))) return '上课记录 ' + item.id + ' 的日期无效';
      if (!['normal', 'substituted', 'moved', 'cancelled'].includes(item.status)) return '上课记录 ' + item.id + ' 的状态无效';
      if (!classIds.has(item.classId)) return '上课记录 ' + item.id + ' 引用了不存在的班级';
      if (!teacherIds.has(item.teacherId)) return '上课记录 ' + item.id + ' 引用了不存在的教师';
      if (!slotIds.has(item.slotId)) return '上课记录 ' + item.id + ' 引用了不存在的时间段';
      if (!subjectIds.has(item.subjectId)) return '上课记录 ' + item.id + ' 引用了不存在的学科';
    }
  }
  if (data.electiveGroups !== undefined) {
    if (!Array.isArray(data.electiveGroups)) return 'electiveGroups 必须是数组';
    const groupIds = new Set();
    for (const group of data.electiveGroups) {
      if (!group || typeof group.id !== 'string' || !group.id.trim()) return '走班组缺少 ID';
      if (groupIds.has(group.id)) return '走班组 ID 重复：' + group.id;
      groupIds.add(group.id);
      if (!subjectIds.has(group.subjectId)) return '走班组 ' + group.id + ' 引用了不存在的学科';
      if (!(Number(group.weeklyPeriods) > 0)) return '走班组 ' + group.id + ' 的周课时必须大于 0';
      if (!Array.isArray(group.classIds) || group.classIds.length === 0) return '走班组 ' + group.id + ' 至少需要一个班级';
      for (const classId of group.classIds) {
        if (!classIds.has(classId)) return '走班组 ' + group.id + ' 引用了不存在的班级';
      }
      if (!Array.isArray(group.blocks) || group.blocks.length === 0) return '走班组 ' + group.id + ' 至少需要一个并行班';
      const blockIds = new Set();
      for (const block of group.blocks) {
        if (!block || typeof block.id !== 'string' || !block.id.trim()) return '走班组 ' + group.id + ' 的并行班缺少 ID';
        if (blockIds.has(block.id)) return '走班组 ' + group.id + ' 的并行班 ID 重复';
        blockIds.add(block.id);
        if (!teacherIds.has(block.teacherId)) return '走班组 ' + group.id + ' 的并行班引用了不存在的教师';
      }
    }
  }
  return null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** Streaming keeps the event loop free while several LAN clients load assets. */
function sendFile(req, res, file, immutable = false) {
  const stat = fs.statSync(file);
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  res.setHeader(
    'Cache-Control',
    immutable ? 'public, max-age=31536000, immutable' : 'no-store',
  );
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(file);
  stream.on('error', () => {
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  });
  stream.pipe(res);
}

function solverFailure(explanation, status = 'FAILED', code = null) {
  return {
    protocolVersion: '1.0',
    status,
    entries: [],
    hardConstraintViolations: [explanation],
    softScore: 0,
    scoreBreakdown: {},
    unsatisfiedRules: [],
    explanation,
    elapsedMs: 0,
    hasFeasibleSolution: false,
    ...(code ? { code } : {}),
  };
}

function resolveJavaCommand() {
  const home = process.env.JAVA_HOME;
  if (home) {
    const candidate = path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'java';
}

function detectJava(command) {
  try {
    const result = spawnSync(command, ['-version'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    const output = ((result.stderr || '') + (result.stdout || '')).trim();
    const match = output.match(/version "([^"]+)"/);
    const major = match ? Number(String(match[1]).split('.')[0]) : 0;
    return {
      available: result.status === 0 && major >= 21,
      version: match ? match[1] : null,
      command,
      output: output.split(/\r?\n/).slice(0, 2).join(' | '),
    };
  } catch (error) {
    return { available: false, version: null, command, output: error.message };
  }
}

function readCpuTimes() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const times = cpu.times;
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total, at: Date.now() };
}

function lanAddresses() {
  const result = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const info of list || []) {
      if (info.family === 'IPv4' && !info.internal) result.push({ name, address: info.address });
    }
  }
  return result;
}

function requestError(message, statusCode, code, extra = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function startApi({
  rootDir,
  dataDir = path.join(rootDir, 'data'),
  port = 4317,
  host,
  packaged = false,
  solverCommand,
  solverArgs,
  solverJar,
  configFile = null,
  clientTtlMs = CLIENT_TTL_MS,
  timeoutSecondsOverride = null,
}) {
  const store = openDatabase(rootDir, dataDir);
  const resolvedConfigFile = configFile || path.join(dataDir, 'server-config.json');
  const loaded = loadConfig(resolvedConfigFile);
  let config = loaded.config;
  let effective = loaded.effective;
  let bindHost = host || (config.bindAddress === 'lan' ? '0.0.0.0' : '127.0.0.1');

  const javaCommand = solverCommand || resolveJavaCommand();
  const jarPath =
    solverJar ||
    (packaged
      ? path.join(process.resourcesPath, 'solver', 'warpweft-solver.jar')
      : path.join(rootDir, 'resources', 'solver', 'warpweft-solver.jar'));
  const javaArgs = solverArgs || ['-Xms64m', '-Xmx512m', '-jar', jarPath];
  const javaInfo = solverCommand && solverArgs ? { available: true, version: 'custom', command: javaCommand, output: 'custom solver' } : detectJava(javaCommand);

  const jobs = [];
  const logs = [];
  const queue = [];
  const active = new Map();
  const clients = new Map();
  let jobSequence = 0;
  let logSequence = 0;
  let lastCpu = readCpuTimes();
  let cpuUsage = 0;
  const startupWarnings = loaded.warnings.slice();

  function log(level, message, jobId = null) {
    const item = {
      seq: ++logSequence,
      at: new Date().toISOString(),
      level,
      message,
      jobId,
    };
    logs.push(item);
    if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
    return item;
  }

  function jobSummary(job) {
    return {
      id: job.id,
      clientId: job.clientId || null,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt || null,
      finishedAt: job.finishedAt || null,
      elapsedMs: job.elapsedMs || 0,
      queuePosition: job.queuePosition || 0,
      lessons: job.lessons,
      classes: job.classes,
      plans: job.plans,
      entries: job.entries || 0,
      resultStatus: job.resultStatus || null,
      error: job.error || null,
    };
  }

  function clientSummary(client) {
    const running = Array.from(active.values()).filter((entry) => entry.job.clientId === client.id).length;
    const queued = queue.filter((item) => item.job.clientId === client.id).length;
    return {
      id: client.id,
      idShort: client.id.length > 12 ? client.id.slice(0, 8) : client.id,
      ip: client.ip,
      anonymous: !!client.anonymous,
      firstSeen: client.firstSeen,
      lastSeen: client.lastSeen,
      requests: client.requests,
      running,
      queued,
    };
  }

  function pruneClients() {
    const now = Date.now();
    for (const [id, client] of clients) {
      const busy =
        Array.from(active.values()).some((entry) => entry.job.clientId === id) ||
        queue.some((item) => item.job.clientId === id);
      if (busy) continue;
      if (now - client.lastSeen > clientTtlMs) clients.delete(id);
    }
  }

  const pruneTimer = setInterval(pruneClients, CLIENT_PRUNE_MS);
  if (typeof pruneTimer.unref === 'function') pruneTimer.unref();

  function clientIdentity(req) {
    const raw = String(req.headers['x-client-id'] || '').trim();
    const ip = normalizeIp(req.socket.remoteAddress || '');
    if (/^[A-Za-z0-9_.:-]{3,64}$/.test(raw)) return { id: raw, ip, anonymous: false };
    return { id: 'ip:' + (ip || 'unknown'), ip, anonymous: true };
  }

  function touchClient(req, res, enforce = true) {
    // Idle sessions age out on their own timer, but a new connection should be
    // able to take a slot that has already expired.
    pruneClients();
    const identity = clientIdentity(req);
    if (!ipAllowed(identity.ip, config.allowedCidrs)) {
      fail(res, 403, '来源地址不在允许的网段内', 'IP_NOT_ALLOWED', { ip: identity.ip });
      return null;
    }
    const now = Date.now();
    let client = clients.get(identity.id);
    if (!client) {
      if (enforce && clients.size >= config.maxClients) {
        fail(res, 429, '已连接的电脑数量达到上限（' + config.maxClients + '）', 'CLIENT_LIMIT', {
          maxClients: config.maxClients,
          retryAfterSeconds: 30,
          clients: clients.size,
        });
        return null;
      }
      if (!enforce) {
        // Health checks stay cheap and must not consume a slot.
        return { id: identity.id, ip: identity.ip, anonymous: identity.anonymous, firstSeen: now, lastSeen: now, requests: 0 };
      }
      client = {
        id: identity.id,
        ip: identity.ip,
        anonymous: identity.anonymous,
        firstSeen: now,
        lastSeen: now,
        requests: 0,
      };
      clients.set(identity.id, client);
      log('info', '客户端已连接：' + identity.id + '（' + identity.ip + '）');
    }
    client.lastSeen = now;
    client.requests += 1;
    client.ip = identity.ip;
    return client;
  }

  function queueCounts() {
    return {
      queued: queue.length,
      running: active.size,
      capacity: config.queueCapacity,
      concurrency: effective.maxConcurrentJobs,
      completed: jobs.filter((job) => job.status === 'completed').length,
      failed: jobs.filter((job) => job.status === 'failed' || job.status === 'timeout').length,
      cancelled: jobs.filter((job) => job.status === 'cancelled').length,
    };
  }

  function updateQueuePositions() {
    queue.forEach((item, index) => {
      item.job.queuePosition = index + 1;
    });
  }

  function clientLoad(id) {
    const running = Array.from(active.values()).filter((entry) => entry.job.clientId === id).length;
    const queued = queue.filter((item) => item.job.clientId === id).length;
    return { running, queued };
  }

  function runSolver(input, job) {
    let child = null;
    const promise = new Promise((resolve, reject) => {
      if (!javaInfo.available) {
        reject(requestError('Java 21 不可用：' + (javaInfo.output || javaInfo.command), 503, 'SOLVER_UNAVAILABLE'));
        return;
      }
      if (!fs.existsSync(jarPath)) {
        reject(requestError('Java 求解器未构建：请先运行 npm run build:solver', 503, 'SOLVER_UNAVAILABLE'));
        return;
      }
      child = spawn(javaCommand, javaArgs, { windowsHide: true });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(result);
      };
      const limitSeconds = Number(input.timeLimitSeconds) || 30;
      const timeoutSeconds = timeoutSecondsOverride ?? Math.min(config.jobTimeoutSeconds, Math.max(15, limitSeconds + 15));
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // ignore
        }
        finish(Object.assign(requestError('Java 求解超时', 504, 'TIMEOUT'), { status: 'TIMEOUT' }));
      }, timeoutSeconds * 1000);
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
        const text = String(chunk).trim();
        if (text) log('debug', text.startsWith('[java]') ? text : '[java] ' + text, job.id);
      });
      child.stdin.on('error', () => {});
      child.on('error', (error) => {
        finish(requestError('无法启动 Java 求解器：' + error.message, 500, 'SOLVER_FAILED'));
      });
      child.on('close', (code) => {
        if (settled) return;
        if (job.cancelRequested) {
          finish(requestError('任务已取消', 409, 'JOB_CANCELLED', { status: 'CANCELLED' }));
          return;
        }
        if (code !== 0) {
          finish(requestError((stderr || '').trim() || 'Java 求解器退出码 ' + code, 500, 'SOLVER_FAILED'));
          return;
        }
        try {
          finish(null, JSON.parse(stdout.trim()));
        } catch {
          finish(requestError((stderr || '').trim() || 'Java 求解器返回了非 JSON 内容', 500, 'SOLVER_FAILED'));
        }
      });
      child.stdin.end(JSON.stringify(input));
    });
    return { promise, child: () => child };
  }

  function pump() {
    // A long solve owns one concurrency slot: with maxConcurrentJobs=1 short
    // solves queue behind it instead of starting a second JVM on the same box.
    const capacity = Math.max(0, effective.maxConcurrentJobs - (longJobRunning ? 1 : 0));
    while (active.size < capacity && queue.length > 0) {
      const item = queue.shift();
      const job = item.job;
      job.status = 'running';
      job.startedAt = new Date().toISOString();
      job.queuePosition = 0;
      updateQueuePositions();
      log('info', '开始求解：' + job.lessons + ' 课时 / ' + job.plans + ' 条计划', job.id);
      const { promise, child } = runSolver(item.input, job);
      active.set(job.id, { job, child, startedAt: Date.now() });
      promise
        .then((result) => {
          if (job.status === 'cancelled') return;
          job.status = result.hasFeasibleSolution ? 'completed' : 'failed';
          job.finishedAt = new Date().toISOString();
          job.elapsedMs = new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime();
          job.resultStatus = result.status || null;
          job.entries = Array.isArray(result.entries) ? result.entries.length : 0;
          job.error = result.hasFeasibleSolution ? null : (result.explanation || '未找到可行课表');
          log(result.hasFeasibleSolution ? 'info' : 'warn', '求解结束：' + result.status + '，' + job.entries + ' 条课表', job.id);
          job.resolve(result);
        })
        .catch((error) => {
          if (job.status !== 'cancelled') {
            job.status = error.code === 'JOB_CANCELLED' ? 'cancelled' : error.status === 'TIMEOUT' || error.code === 'TIMEOUT' ? 'timeout' : 'failed';
            job.finishedAt = new Date().toISOString();
            job.elapsedMs = new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime();
            job.error = error.message;
            log(error.code === 'JOB_CANCELLED' ? 'warn' : 'error', '求解失败：' + error.message, job.id);
          }
          job.reject(error);
        })
        .finally(() => {
          active.delete(job.id);
          job.resolve = null;
          job.reject = null;
          pump();
        });
    }
  }

  function enqueueSolve(rawInput, client) {
    // Clients must not be able to point the solver at a server-side path: only
    // the long-job runner owns checkpoint files.
    const input = { ...rawInput, checkpointFile: undefined, stagnationSeconds: 0 };
    return new Promise((resolve, reject) => {
      const load = client ? clientLoad(client.id) : { running: 0, queued: 0 };
      const allowance = config.perClientActive + config.perClientQueued;
      if (client && load.running + load.queued >= allowance) {
        reject(
          requestError(
            '当前电脑在跑/排队的任务已达上限（' + allowance + '）',
            429,
            'CLIENT_QUEUE_FULL',
            { running: load.running, queued: load.queued, allowance },
          ),
        );
        return;
      }
      if (queue.length >= config.queueCapacity) {
        reject(
          requestError('服务端队列已满（' + config.queueCapacity + '）', 503, 'QUEUE_FULL', {
            retryAfterSeconds: 15,
            capacity: config.queueCapacity,
          }),
        );
        return;
      }
      const job = {
        id: 'job-' + Date.now().toString(36) + '-' + (++jobSequence),
        clientId: client ? client.id : null,
        status: 'queued',
        createdAt: new Date().toISOString(),
        queuePosition: queue.length + 1,
        lessons: (input.coursePlans || []).reduce((sum, plan) => sum + (Number(plan.weeklyPeriods) || 0), 0),
        classes: (input.classes || []).length,
        plans: (input.coursePlans || []).length,
        resolve,
        reject,
      };
      jobs.push(job);
      if (jobs.length > MAX_JOBS) jobs.splice(0, jobs.length - MAX_JOBS);
      queue.push({ job, input, clientId: job.clientId });
      log('info', '任务已进入队列：队列位置 ' + job.queuePosition, job.id);
      pump();
    });
  }

  function cancelJob(id) {
    const running = active.get(id);
    if (running) {
      running.job.cancelRequested = true;
      running.job.status = 'cancelled';
      running.job.finishedAt = new Date().toISOString();
      running.job.error = '已取消';
      try {
        running.child()?.kill();
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          running.child()?.kill('SIGKILL');
        } catch {
          // ignore
        }
      }, 2000).unref();
      log('warn', '任务已取消（运行中）', id);
      return true;
    }
    const index = queue.findIndex((item) => item.job.id === id);
    if (index === -1) return false;
    const [item] = queue.splice(index, 1);
    updateQueuePositions();
    item.job.status = 'cancelled';
    item.job.finishedAt = new Date().toISOString();
    item.job.error = '已取消';
    log('warn', '任务已取消（排队中）', id);
    item.job.reject(requestError('任务已取消', 409, 'JOB_CANCELLED'));
    return true;
  }

  // ---------------------------------------------------------------------------
  // Long-running solve jobs
  //
  // A short solve answers one HTTP request. A long solve (up to six hours) is a
  // first-class task: its input, best checkpoint and status live in
  // data/solve-jobs/, so the page can be closed, the server restarted, and the
  // task resumed with the last best timetable as its starting point.
  // ---------------------------------------------------------------------------
  const longJobsDir = path.join(dataDir, 'solve-jobs');
  fs.mkdirSync(longJobsDir, { recursive: true });
  const longJobs = new Map();
  const longJobsByUuid = new Map();
  const TASK_UUID_PATTERN = /^[A-Za-z0-9_.:-]{8,64}$/;
  const longChildren = new Map();
  const longSaveTimes = new Map();
  let longJobRunning = null;
  let longSequence = 0;
  let shuttingDown = false;

  function longJobFile(id) {
    return path.join(longJobsDir, id + '.json');
  }

  function loadLongJobs() {
    let files = [];
    try {
      files = fs.readdirSync(longJobsDir).filter((file) => file.endsWith('.json') && !file.endsWith('.best.json'));
    } catch {
      return;
    }
    for (const file of files) {
      try {
        const job = JSON.parse(fs.readFileSync(path.join(longJobsDir, file), 'utf8'));
        if (!job || typeof job.id !== 'string') continue;
        if (job.status === 'running' || job.status === 'queued') {
          job.status = 'interrupted';
          job.error = '服务重启导致任务中断，可继续';
        }
        longJobs.set(job.id, job);
        if (job.taskUuid) longJobsByUuid.set(job.taskUuid, job);
      } catch {
        // A corrupt checkpoint must not stop the server from starting.
      }
    }
    if (longJobs.size > MAX_LONG_JOBS) {
      const sorted = Array.from(longJobs.values()).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      for (const job of sorted.slice(0, longJobs.size - MAX_LONG_JOBS)) {
        longJobs.delete(job.id);
        if (job.taskUuid) longJobsByUuid.delete(job.taskUuid);
        try {
          fs.rmSync(longJobFile(job.id), { force: true });
          if (job.bestFile) fs.rmSync(job.bestFile, { force: true });
        } catch {
          // ignore
        }
      }
    }
  }

  function saveLongJob(job, throttleMs = 0) {
    job.updatedAt = new Date().toISOString();
    const now = Date.now();
    const last = longSaveTimes.get(job.id) || 0;
    if (throttleMs > 0 && now - last < throttleMs) return;
    longSaveTimes.set(job.id, now);
    const file = longJobFile(job.id);
    const tmp = file + '.tmp';
    const meta = {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt || null,
      finishedAt: job.finishedAt || null,
      elapsedMs: job.elapsedMs || 0,
      timeLimitSeconds: job.timeLimitSeconds,
      stagnationSeconds: job.stagnationSeconds,
      lessons: job.lessons,
      classes: job.classes,
      plans: job.plans,
      rounds: job.rounds || 0,
      error: job.error || null,
      clientId: job.clientId || null,
      taskUuid: job.taskUuid || null,
      snapshotId: job.snapshotId || null,
      bestFile: job.bestFile,
      input: job.input,
      progress: job.progress || null,
      hasFeasibleSolution: job.hasFeasibleSolution || false,
      entryCount: job.entryCount || 0,
    };
    try {
      fs.writeFileSync(tmp, JSON.stringify(meta), 'utf8');
      fs.renameSync(tmp, file);
    } catch (error) {
      log('error', '保存长时任务失败：' + error.message, job.id);
    }
  }

  function readLongBest(job) {
    if (!job.bestFile) return null;
    try {
      const stat = fs.statSync(job.bestFile);
      if (job.bestMtime === stat.mtimeMs && job.best) return job.best;
      const best = JSON.parse(fs.readFileSync(job.bestFile, 'utf8'));
      job.bestMtime = stat.mtimeMs;
      job.best = best;
      return best;
    } catch {
      return job.best || null;
    }
  }

  function longJobSummary(job) {
    const best = readLongBest(job);
    const total = best && typeof best.total === 'number' ? best.total : job.total || job.lessons || 0;
    const placed = best && typeof best.placed === 'number' ? best.placed : (job.progress && job.progress.placed) || 0;
    return {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt || job.createdAt,
      startedAt: job.startedAt || null,
      finishedAt: job.finishedAt || null,
      elapsedMs: job.elapsedMs || (best && best.elapsedMs) || 0,
      timeLimitSeconds: job.timeLimitSeconds,
      stagnationSeconds: job.stagnationSeconds || 0,
      lessons: job.lessons,
      total,
      placed,
      unplaced: Math.max(0, total - placed),
      score: best && typeof best.score === 'number' ? best.score : null,
      rounds: job.rounds || 0,
      error: job.error || null,
      clientId: job.clientId || null,
      taskUuid: job.taskUuid || null,
      snapshotId: job.snapshotId || null,
      hasFeasibleSolution: !!job.hasFeasibleSolution,
      canResume: ['paused', 'interrupted', 'failed', 'cancelled', 'completed'].includes(job.status) && !longJobRunning,
    };
  }

  function longJobDetail(job) {
    const best = readLongBest(job);
    return {
      ...longJobSummary(job),
      bestEntries: best && Array.isArray(best.entries) ? best.entries : [],
      bestUpdatedAt: best ? best.updatedAt || null : null,
      inputSummary: {
        timeSlots: (job.input.timeSlots || []).length,
        classes: (job.input.classes || []).length,
        teachers: (job.input.teachers || []).length,
        rooms: (job.input.rooms || []).length,
        plans: (job.input.coursePlans || []).length,
        locked: (job.input.lockedEntries || []).length,
      },
    };
  }

  function runLongJob(job) {
    if (longJobRunning) {
      throw requestError('已有长时任务在运行，请先暂停或取消', 409, 'LONG_JOB_BUSY', { running: longJobRunning });
    }
    const best = readLongBest(job);
    const previous = best && Array.isArray(best.entries) ? best.entries : [];
    const locks = job.input.lockedEntries || [];
    const lockedIds = new Set(locks.map((entry) => entry.id));
    const input = {
      ...job.input,
      timeLimitSeconds: job.timeLimitSeconds,
      stagnationSeconds: job.stagnationSeconds,
      checkpointFile: job.bestFile,
    };
    if (previous.length > 0) {
      // Resume by seeding: everything already placed stays as a starting point
      // (repair may still move it), while user-locked lessons stay locked.
      input.seedEntries = previous.filter((entry) => !entry.locked && !lockedIds.has(entry.id));
      input.lockedEntries = [...locks, ...previous.filter((entry) => entry.locked && !lockedIds.has(entry.id))];
    }
    job.status = 'running';
    job.startedAt = job.startedAt || new Date().toISOString();
    job.finishedAt = null;
    job.error = null;
    job.pauseRequested = false;
    job.cancelRequested = false;
    job.rounds = (job.rounds || 0) + 1;
    job.progress = job.progress || null;
    saveLongJob(job);
    longJobRunning = job.id;
    log('info', '长时任务开始：' + job.lessons + ' 课时，时限 ' + job.timeLimitSeconds + ' 秒，第 ' + job.rounds + ' 轮', job.id);

    if (!javaInfo.available) {
      job.status = 'failed';
      job.error = 'Java 21 不可用：' + (javaInfo.output || javaInfo.command);
      job.finishedAt = new Date().toISOString();
      longJobRunning = null;
      saveLongJob(job);
      return;
    }
    if (!fs.existsSync(jarPath)) {
      job.status = 'failed';
      job.error = 'Java 求解器未构建：请先运行 npm run build:solver';
      job.finishedAt = new Date().toISOString();
      longJobRunning = null;
      saveLongJob(job);
      return;
    }
    const child = spawn(javaCommand, javaArgs, { windowsHide: true });
    longChildren.set(job.id, child);
    const startedAt = Date.now();
    let stdout = '';
    let stderrTail = '';
    let stderrBuffer = '';
    let settled = false;

    const progressTimer = setInterval(() => {
      const checkpoint = readLongBest(job);
      if (checkpoint) {
        job.progress = {
          placed: checkpoint.placed,
          total: checkpoint.total,
          unplaced: checkpoint.unplaced,
          score: checkpoint.score,
          elapsedMs: checkpoint.elapsedMs,
          at: new Date().toISOString(),
        };
        job.elapsedMs = checkpoint.elapsedMs || Date.now() - startedAt;
        saveLongJob(job, 3000);
      }
    }, 1000);
    if (typeof progressTimer.unref === 'function') progressTimer.unref();

    const guard = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
    }, (job.timeLimitSeconds + 300) * 1000);
    if (typeof guard.unref === 'function') guard.unref();

    const finish = () => {
      if (settled) return;
      settled = true;
      clearInterval(progressTimer);
      clearTimeout(guard);
      longChildren.delete(job.id);
      longJobRunning = null;
      const checkpoint = readLongBest(job);
      if (checkpoint) {
        job.progress = {
          placed: checkpoint.placed,
          total: checkpoint.total,
          unplaced: checkpoint.unplaced,
          score: checkpoint.score,
          elapsedMs: checkpoint.elapsedMs,
          at: new Date().toISOString(),
        };
        job.elapsedMs = checkpoint.elapsedMs || job.elapsedMs;
        job.entryCount = Array.isArray(checkpoint.entries) ? checkpoint.entries.length : 0;
      }
      job.finishedAt = new Date().toISOString();
      saveLongJob(job);
      pump();
    };

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      stderrTail = (stderrTail + text).slice(-4000);
      stderrBuffer += text;
      let index = stderrBuffer.indexOf('\n');
      while (index >= 0) {
        const line = stderrBuffer.slice(0, index).trim();
        stderrBuffer = stderrBuffer.slice(index + 1);
        if (line) {
          if (line.startsWith('[progress] ')) {
            try {
              const progress = JSON.parse(line.slice('[progress] '.length));
              job.progress = { ...progress, at: new Date().toISOString() };
              job.elapsedMs = progress.elapsedMs || job.elapsedMs;
              saveLongJob(job, 3000);
            } catch {
              log('debug', '无法解析进度行：' + line, job.id);
            }
          } else {
            log('debug', line.startsWith('[java]') ? line : '[java] ' + line, job.id);
          }
        }
        index = stderrBuffer.indexOf('\n');
      }
    });
    child.stdin.on('error', () => {});
    child.on('error', (error) => {
      job.status = 'failed';
      job.error = '无法启动 Java 求解器：' + error.message;
      finish();
      log('error', job.error, job.id);
    });
    child.on('close', (code) => {
      if (job.cancelRequested) {
        job.status = 'cancelled';
        job.error = '已取消';
      } else if (shuttingDown) {
        job.status = 'interrupted';
        job.error = '服务停止导致任务中断，可继续';
      } else if (job.pauseRequested) {
        job.status = 'paused';
        job.error = '已暂停';
      } else if (code === 0) {
        try {
          const output = JSON.parse(stdout.trim());
          job.hasFeasibleSolution = !!output.hasFeasibleSolution;
          job.entryCount = Array.isArray(output.entries) ? output.entries.length : 0;
          job.status = output.hasFeasibleSolution ? 'completed' : 'failed';
          job.error = output.hasFeasibleSolution ? null : output.explanation || '未找到可行课表';
          job.elapsedMs = output.elapsedMs || job.elapsedMs;
        } catch {
          job.status = 'failed';
          job.error = (stderrTail.trim() || 'Java 求解器返回了非 JSON 内容').slice(0, 500);
        }
      } else {
        job.status = 'failed';
        job.error = (stderrTail.trim() || 'Java 求解器退出码 ' + code).slice(0, 500);
      }
      finish();
      const summary = longJobSummary(job);
      log(job.status === 'completed' ? 'info' : 'warn', '长时任务结束：' + job.status + '，' + summary.placed + '/' + summary.total + ' 课时', job.id);
    });
    child.stdin.end(JSON.stringify(input));
  }

  function createLongJob(input, client, taskMeta = {}) {
    const taskUuid = typeof taskMeta.taskUuid === 'string' ? taskMeta.taskUuid.trim() : '';
    const snapshotId = typeof taskMeta.snapshotId === 'string' ? taskMeta.snapshotId.trim() : '';
    if (taskUuid) {
      if (!TASK_UUID_PATTERN.test(taskUuid)) {
        throw requestError('任务 UUID 格式无效（8-64 位字母、数字或 _.:-）', 400, 'INVALID_TASK_UUID');
      }
      const existing = longJobsByUuid.get(taskUuid);
      if (existing) {
        if ((existing.snapshotId || '') !== snapshotId) {
          throw requestError('任务 UUID 已被另一份数据快照使用，请生成新的任务 UUID', 409, 'TASK_UUID_CONFLICT');
        }
        return { job: existing, reused: true };
      }
    }
    const seconds = Math.round(Number(input.timeLimitSeconds));
    const timeLimitSeconds = Number.isFinite(seconds) && seconds > 0
      ? Math.min(LONG_JOB_MAX_SECONDS, Math.max(LONG_JOB_MIN_SECONDS, seconds))
      : 3600;
    const stagnation = Math.round(Number(input.stagnationSeconds));
    const stagnationSeconds = Number.isFinite(stagnation) && stagnation >= 0
      ? Math.min(LONG_JOB_MAX_STAGNATION, stagnation)
      : 600;
    const jobsInFlight = Array.from(longJobs.values()).filter((job) => job.status === 'running' || job.status === 'queued');
    if (jobsInFlight.length > 0) {
      throw requestError('已有长时任务在运行（' + jobsInFlight[0].id + '），请先暂停或取消', 409, 'LONG_JOB_BUSY', {
        running: jobsInFlight[0].id,
      });
    }
    longSequence += 1;
    const id = 'long-' + Date.now().toString(36) + '-' + longSequence;
    const job = {
      id,
      clientId: client ? client.id : null,
      taskUuid: taskUuid || null,
      snapshotId: snapshotId || null,
      status: 'queued',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      timeLimitSeconds,
      stagnationSeconds,
      lessons: (input.coursePlans || []).reduce((sum, plan) => sum + (Number(plan.weeklyPeriods) || 0), 0),
      classes: (input.classes || []).length,
      plans: (input.coursePlans || []).length,
      total: (input.coursePlans || []).reduce((sum, plan) => sum + (Number(plan.weeklyPeriods) || 0), 0),
      bestFile: path.join(longJobsDir, id + '.best.json'),
      input,
    };
    longJobs.set(id, job);
    if (taskUuid) longJobsByUuid.set(taskUuid, job);
    if (longJobs.size > MAX_LONG_JOBS) {
      const sorted = Array.from(longJobs.values()).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      const stale = sorted.find((item) => item.status !== 'running' && item.status !== 'queued');
      if (stale) {
        longJobs.delete(stale.id);
        if (stale.taskUuid) longJobsByUuid.delete(stale.taskUuid);
        try {
          fs.rmSync(longJobFile(stale.id), { force: true });
          if (stale.bestFile) fs.rmSync(stale.bestFile, { force: true });
        } catch {
          // ignore
        }
      }
    }
    runLongJob(job);
    return { job, reused: false };
  }

  function pauseLongJob(id) {
    const job = longJobs.get(id);
    if (!job) throw requestError('长时任务不存在', 404, 'LONG_JOB_NOT_FOUND');
    if (job.status !== 'running') throw requestError('任务当前不在运行（' + job.status + '）', 409, 'LONG_JOB_NOT_RUNNING');
    job.pauseRequested = true;
    job.status = 'paused';
    job.error = '已暂停';
    job.finishedAt = new Date().toISOString();
    const child = longChildren.get(id);
    if (child) {
      try {
        child.kill();
      } catch {
        // ignore
      }
    }
    saveLongJob(job);
    log('warn', '长时任务已暂停', id);
    return job;
  }

  function resumeLongJob(id) {
    const job = longJobs.get(id);
    if (!job) throw requestError('长时任务不存在', 404, 'LONG_JOB_NOT_FOUND');
    if (job.status === 'running') throw requestError('任务已在运行', 409, 'LONG_JOB_RUNNING');
    runLongJob(job);
    return job;
  }


  function deleteLongJob(id) {
    const job = longJobs.get(id);
    if (!job) throw requestError('长时任务不存在', 404, 'LONG_JOB_NOT_FOUND');
    if (job.status !== 'completed' && job.status !== 'cancelled') throw requestError('只有已完成或已取消任务可以删除', 409, 'LONG_JOB_NOT_COMPLETED');
    longJobs.delete(id);
    if (job.taskUuid) longJobsByUuid.delete(job.taskUuid);
    try {
      fs.rmSync(longJobFile(id), { force: true });
      fs.rmSync(job.bestFile || path.join(longJobsDir, id + '.best.json'), { force: true });
    } catch {
      // ignore cleanup failures; the job is already removed from the index
    }
    log('info', '长时任务已删除', id);
    return job;
  }
  function cancelLongJob(id) {
    const job = longJobs.get(id);
    if (!job) throw requestError('长时任务不存在', 404, 'LONG_JOB_NOT_FOUND');
    if (job.status === 'running') {
      job.cancelRequested = true;
      job.status = 'cancelled';
      job.error = '已取消';
      job.finishedAt = new Date().toISOString();
      const child = longChildren.get(id);
      if (child) {
        try {
          child.kill();
        } catch {
          // ignore
        }
      }
      saveLongJob(job);
      log('warn', '长时任务已取消', id);
      return job;
    }
    job.status = 'cancelled';
    job.error = '已取消';
    job.finishedAt = new Date().toISOString();
    saveLongJob(job);
    return job;
  }

  loadLongJobs();

  function serverStats() {
    const now = readCpuTimes();
    const totalDelta = now.total - lastCpu.total;
    const idleDelta = now.idle - lastCpu.idle;
    if (totalDelta > 0) cpuUsage = Math.max(0, Math.min(100, Math.round(((totalDelta - idleDelta) / totalDelta) * 100)));
    lastCpu = now;
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const mem = process.memoryUsage();
    return {
      at: new Date().toISOString(),
      host: bindHost,
      port,
      addresses: lanAddresses(),
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      osUptimeSeconds: Math.round(os.uptime()),
      cpu: {
        model: os.cpus()[0]?.model || 'unknown',
        cores: os.cpus().length,
        usage: cpuUsage,
        load: os.loadavg().map((value) => Math.round(value * 100) / 100),
      },
      memory: {
        total: totalMem,
        free: freeMem,
        used: totalMem - freeMem,
        usage: totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100) : 0,
        process: mem.rss,
      },
      java: javaInfo,
      solver: {
        engine: 'java',
        jar: jarPath,
        ready: javaInfo.available && fs.existsSync(jarPath),
      },
      queue: {
        ...queueCounts(),
        activeJob: active.size > 0 ? Array.from(active.keys())[0] : null,
        activeJobs: Array.from(active.keys()),
      },
      clients: {
        active: clients.size,
        max: config.maxClients,
      },
      limits: {
        maxClients: config.maxClients,
        maxConcurrentJobs: config.maxConcurrentJobs,
        queueCapacity: config.queueCapacity,
        perClientActive: config.perClientActive,
        perClientQueued: config.perClientQueued,
        jobTimeoutSeconds: config.jobTimeoutSeconds,
      },
      effective,
      totalJobs: jobs.length,
      config,
      warnings: startupWarnings,
    };
  }

  function applyConfig(patch, req, res) {
    const normalized = normalizeConfig(patch, config);
    const previousBind = config.bindAddress;
    config = normalized.config;
    effective = normalized.effective;
    saveConfig(resolvedConfigFile, config);
    const requiresRestart = false;
    let rebind = false;
    if (config.bindAddress !== previousBind) {
      const nextHost = config.bindAddress === 'lan' ? '0.0.0.0' : '127.0.0.1';
      if (nextHost !== bindHost) {
        rebind = true;
        bindHost = nextHost;
      }
    }
    const connectionBudget = Math.max(32, config.maxClients * 16);
    if (server.maxConnections !== connectionBudget) {
      server.maxConnections = connectionBudget;
    }
    const payload = {
      config,
      effective,
      requiresRestart,
      warnings: normalized.warnings,
      clients: { active: clients.size, max: config.maxClients },
      bind: { mode: config.bindAddress, host: bindHost, port },
    };
    if (!rebind) return payload;
    return { ...payload, rebinding: true };
  }

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      cors(res);
      res.statusCode = 204;
      res.end();
      return;
    }
    try {
      const url = new URL(req.url, 'http://' + (bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost) + ':' + port);
      // Static assets are served without admission control: a browser loading
      // the page would otherwise burn one "computer" slot per connection.
      const isApi = url.pathname.startsWith('/api/');
      const client = isApi ? touchClient(req, res, url.pathname !== '/api/health') : null;
      if (isApi && !client) return;

      if (req.method === 'GET' && url.pathname === '/api/health') {
        return send(res, 200, {
          ok: true,
          dataSource: 'local-json',
          solver: 'java',
          java: javaInfo,
          queue: queueCounts(),
          server: { host: bindHost, port, config },
          clients: { active: clients.size, max: config.maxClients },
          effective,
        });
      }
      if (req.method === 'GET' && url.pathname === '/api/server/stats') {
        return send(res, 200, serverStats());
      }
      if (req.method === 'GET' && url.pathname === '/api/server/overview') {
        const since = Number(url.searchParams.get('sinceLog') || url.searchParams.get('since') || 0);
        const items = logs.filter((item) => item.seq > since);
        return send(res, 200, {
          stats: serverStats(),
          jobs: jobs.slice().reverse().map(jobSummary),
          logs: { items, lastSeq: logSequence },
          config,
          effective,
          clients: Array.from(clients.values()).map(clientSummary),
        });
      }
      if (req.method === 'GET' && url.pathname === '/api/server/jobs') {
        return send(res, 200, { jobs: jobs.slice().reverse().map(jobSummary) });
      }
      if (req.method === 'GET' && url.pathname === '/api/server/logs') {
        const since = Number(url.searchParams.get('since') || 0);
        const items = logs.filter((item) => item.seq > since);
        return send(res, 200, { logs: items, lastSeq: logSequence });
      }
      if (req.method === 'GET' && url.pathname === '/api/server/clients') {
        return send(res, 200, {
          clients: Array.from(clients.values()).map(clientSummary),
          max: config.maxClients,
        });
      }
      if (req.method === 'PUT' && url.pathname === '/api/server/config') {
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return fail(res, 400, '请求不是有效 JSON', 'INVALID_CONFIG');
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return fail(res, 400, '配置必须是对象', 'INVALID_CONFIG');
        }
        const result = applyConfig(body, req, res);
        log('info', '服务端限额已更新：电脑 ' + config.maxClients + ' · 并发 ' + effective.maxConcurrentJobs + ' · 队列 ' + config.queueCapacity);
        send(res, 200, result);
        if (result.rebinding) {
          setImmediate(() => {
            // Re-bind in place: queue, jobs and logs stay in memory.
            server.close(() => {
              server.listen(port, bindHost, () => {
                log('info', '监听地址已切换：http://' + bindHost + ':' + port);
              });
            });
            if (typeof server.closeAllConnections === 'function') {
              setTimeout(() => server.closeAllConnections(), 100).unref();
            }
          });
        }
        return;
      }
      const clientRoute = url.pathname.match(/^\/api\/server\/clients\/([^/]+)$/);
      if (req.method === 'DELETE' && clientRoute) {
        const id = decodeURIComponent(clientRoute[1]);
        const load = clientLoad(id);
        if (load.running > 0 || load.queued > 0) {
          return fail(res, 409, '该电脑还有在跑或排队的任务，先取消任务再断开', 'CLIENT_BUSY');
        }
        const removed = clients.delete(id);
        return send(res, 200, { ok: removed, clients: Array.from(clients.values()).map(clientSummary) });
      }
      const cancelRoute = url.pathname.match(/^\/api\/server\/jobs\/([^/]+)\/cancel$/);
      if (req.method === 'POST' && cancelRoute) {
        const id = decodeURIComponent(cancelRoute[1]);
        const ok = cancelJob(id);
        if (!ok) return fail(res, 404, '任务不存在或已结束', 'JOB_NOT_FOUND');
        return send(res, 200, { ok: true, status: 'cancelled' });
      }
      if (req.method === 'GET' && url.pathname === '/api/data') {
        return send(res, 200, store.read());
      }
      if (req.method === 'PUT' && url.pathname === '/api/data') {
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return send(res, 400, { error: '请求不是有效 JSON', code: 'INVALID_BODY' });
        }
        sanitizeOrphanReferences(body);
        const error = validateData(body);
        if (error) return send(res, 400, { error, code: 'INVALID_DATA' });
        return send(res, 200, store.write(body));
      }
      if (req.method === 'POST' && url.pathname === '/api/solve') {
        let input;
        try {
          input = JSON.parse(await readBody(req));
        } catch {
          return send(res, 400, solverFailure('请求不是有效 JSON', 'FAILED', 'INVALID_BODY'));
        }
        try {
          const output = await enqueueSolve(input, client);
          return send(res, 200, output);
        } catch (error) {
          const extra = error.code === 'QUEUE_FULL' || error.code === 'CLIENT_QUEUE_FULL'
            ? { retryAfterSeconds: error.retryAfterSeconds || 15 }
            : {};
          if (!res.writableEnded) {
            res.setHeader('Retry-After', String(extra.retryAfterSeconds || 15));
          }
          return send(res, error.statusCode || 500, solverFailure(error.message, error.status || 'FAILED', error.code));
        }
      }

      if (req.method === 'POST' && url.pathname === '/api/solve/long') {
        let input;
        try {
          input = JSON.parse(await readBody(req));
        } catch {
          return fail(res, 400, '请求不是有效 JSON', 'INVALID_BODY');
        }
        if (!input || !Array.isArray(input.coursePlans) || !Array.isArray(input.timeSlots)) {
          return fail(res, 400, '缺少 timeSlots / coursePlans', 'INVALID_DATA');
        }
        try {
          const { taskUuid, snapshotId, ...solverInput } = input;
          const created = createLongJob(solverInput, client, { taskUuid, snapshotId });
          return send(res, created.reused ? 200 : 202, {
            job: longJobSummary(created.job),
            reused: created.reused,
          });
        } catch (error) {
          return fail(res, error.statusCode || 500, error.message, error.code || 'LONG_JOB_FAILED');
        }
      }
      if (req.method === 'GET' && url.pathname === '/api/solve/jobs') {
        const jobs = Array.from(longJobs.values())
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          .map(longJobSummary);
        return send(res, 200, { jobs, running: longJobRunning });
      }
      const longJobByUuid = url.pathname.match(/^\/api\/solve\/jobs\/by-uuid\/([^/]+)$/);
      if (req.method === 'GET' && longJobByUuid) {
        const taskUuid = decodeURIComponent(longJobByUuid[1]);
        const job = longJobsByUuid.get(taskUuid);
        if (!job) return fail(res, 404, '任务不存在或已被清理', 'LONG_JOB_NOT_FOUND');
        if (job.clientId && client && job.clientId !== client.id) {
          return fail(res, 403, '该任务属于其他客户端，当前客户端无权读取', 'TASK_FORBIDDEN');
        }
        return send(res, 200, longJobDetail(job));
      }
      const longJobRoute = url.pathname.match(/^\/api\/solve\/jobs\/([^/]+)$/);
      if (req.method === 'GET' && longJobRoute) {
        const job = longJobs.get(decodeURIComponent(longJobRoute[1]));
        if (!job) return fail(res, 404, '长时任务不存在', 'LONG_JOB_NOT_FOUND');
        return send(res, 200, longJobDetail(job));
      }
      if (req.method === 'DELETE' && longJobRoute) {
        try {
          const job = deleteLongJob(decodeURIComponent(longJobRoute[1]));
          return send(res, 200, { deleted: true, id: job.id });
        } catch (error) {
          return fail(res, error.statusCode || 500, error.message, error.code || 'LONG_JOB_DELETE_FAILED');
        }
      }
      const longJobAction = url.pathname.match(/^\/api\/solve\/jobs\/([^/]+)\/(pause|resume|cancel)$/);
      if (req.method === 'POST' && longJobAction) {
        const id = decodeURIComponent(longJobAction[1]);
        const action = longJobAction[2];
        try {
          const job = action === 'pause' ? pauseLongJob(id) : action === 'resume' ? resumeLongJob(id) : cancelLongJob(id);
          return send(res, 200, { job: longJobSummary(job) });
        } catch (error) {
          return fail(res, error.statusCode || 500, error.message, error.code || 'LONG_JOB_FAILED');
        }
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        if (url.pathname.startsWith('/api/')) {
          return fail(res, 404, 'Not found', 'NOT_FOUND');
        }
        const distDir = path.resolve(rootDir, 'dist');
        const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
        let target = path.resolve(distDir, relative);
        if (!target.startsWith(distDir + path.sep) && target !== path.resolve(distDir, 'index.html')) {
          return fail(res, 403, 'Forbidden', 'FORBIDDEN');
        }
        if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
          target = path.resolve(distDir, 'index.html');
        }
        if (!fs.existsSync(target)) return fail(res, 404, 'Renderer not built', 'NOT_FOUND');
        const immutable = target.startsWith(path.join(distDir, 'assets') + path.sep);
        return sendFile(req, res, target, immutable);
      }
      fail(res, 404, 'Not found', 'NOT_FOUND');
    } catch (error) {
      const status = error && error.statusCode ? error.statusCode : 500;
      const code = error && error.code ? error.code : 'SERVER_ERROR';
      send(res, status, { error: error instanceof Error ? error.message : '服务异常', code });
    }
  });
  server.on('error', (error) => log('error', 'API 服务异常：' + error.message));
  server.on('close', () => {
    // A long solve can outlive the listening socket. Kill it so the process
    // (and a test run) can exit; the next start marks the job "interrupted".
    shuttingDown = true;
    for (const [id, child] of longChildren) {
      try {
        child.kill();
      } catch {
        // ignore
      }
      longChildren.delete(id);
    }
  });
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  server.requestTimeout = 0;
  server.maxConnections = Math.max(32, config.maxClients * 16);
  server.applyConfig = (patch) => applyConfig(patch);
  server.listen(port, bindHost, () => {
    // port 0 asks the OS for a free port; keep the resolved value for re-binds.
    port = server.address().port;
    log('info', '本地服务启动：http://' + bindHost + ':' + port);
    log('info', 'Java 求解器：' + (javaInfo.available ? 'Java ' + (javaInfo.version || 'unknown') : '不可用'));
    log('info', '求解线路：' + jarPath + (fs.existsSync(jarPath) ? '（已就绪）' : '（未构建）'));
    log(
      'info',
      '限额：电脑 ' + config.maxClients + ' · 并发 ' + effective.maxConcurrentJobs + ' · 队列 ' + config.queueCapacity + ' · 超时 ' + config.jobTimeoutSeconds + 's',
    );
    for (const warning of startupWarnings) log('warn', warning);
  });
  return server;
}

module.exports = { startApi, validateData, sanitizeOrphanReferences };











