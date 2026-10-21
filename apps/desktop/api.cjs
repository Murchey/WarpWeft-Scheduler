const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { openDatabase } = require('./database.cjs');

const MAX_BODY = 5 * 1024 * 1024;
const MAX_JOBS = 100;
const MAX_LOGS = 500;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function send(res, status, payload) {
  cors(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function validateData(data) {
  if (!data || typeof data !== 'object') return '数据格式无效';
  for (const key of ['classes', 'teachers', 'subjects', 'rooms', 'timeSlots', 'coursePlans']) {
    if (!Array.isArray(data[key])) return key + ' 必须是数组';
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
  const teacherIds = new Set(data.teachers.map((item) => item.id));
  const subjectIds = new Set(data.subjects.map((item) => item.id));
  const roomIds = new Set(data.rooms.map((item) => item.id));
  const slotIds = new Set(data.timeSlots.map((item) => item.id));
  for (const room of data.rooms) {
    if (!(Number(room.capacity) > 0)) return '教室 ' + room.id + ' 的容量必须大于 0';
  }
  for (const slot of data.timeSlots) {
    if (!(Number(slot.day) > 0) || !(Number(slot.period) > 0)) return '时间段 ' + slot.id + ' 的星期和节次必须大于 0';
  }
  for (const plan of data.coursePlans) {
    if (!classIds.has(plan.classId)) return '教学计划 ' + plan.id + ' 引用了不存在的班级';
    if (!teacherIds.has(plan.teacherId)) return '教学计划 ' + plan.id + ' 引用了不存在的教师';
    if (!subjectIds.has(plan.subjectId)) return '教学计划 ' + plan.id + ' 引用了不存在的学科';
    if (plan.fixedSlotId && !slotIds.has(plan.fixedSlotId)) return '教学计划 ' + plan.id + ' 引用了不存在的固定时间';
    if (!(Number(plan.weeklyPeriods) > 0)) return '教学计划 ' + plan.id + ' 的周课时必须大于 0';
  }
  for (const item of data.unavailableSlots || []) {
    if (!teacherIds.has(item.teacherId)) return '教师不可用时间引用了不存在的教师';
    if (!slotIds.has(item.slotId)) return '教师不可用时间引用了不存在的时间段';
  }
  for (const collection of [data.candidate, data.published]) {
    if (!collection || !Array.isArray(collection.entries)) continue;
    for (const entry of collection.entries) {
      if (!classIds.has(entry.classId) || !teacherIds.has(entry.teacherId) || !roomIds.has(entry.roomId) || !slotIds.has(entry.slotId)) return '课表条目 ' + entry.id + ' 引用了不存在的资源';
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

function sendFile(res, file) {
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.end(fs.readFileSync(file));
}

function solverFailure(explanation, status = 'FAILED') {
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

function startApi({
  rootDir,
  dataDir = path.join(rootDir, 'data'),
  port = 4317,
  host = '127.0.0.1',
  packaged = false,
  solverCommand,
  solverArgs,
  solverJar,
}) {
  const store = openDatabase(rootDir, dataDir);
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
  let activeJob = null;
  let jobSequence = 0;
  let logSequence = 0;
  let lastCpu = readCpuTimes();
  let cpuUsage = 0;

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

  function queueCounts() {
    return {
      queued: queue.length,
      running: activeJob ? 1 : 0,
      completed: jobs.filter((job) => job.status === 'completed').length,
      failed: jobs.filter((job) => job.status === 'failed' || job.status === 'timeout').length,
    };
  }

  function updateQueuePositions() {
    queue.forEach((item, index) => {
      item.job.queuePosition = index + 1;
    });
  }

  function runSolver(input, job) {
    return new Promise((resolve, reject) => {
      if (!javaInfo.available) {
        reject(Object.assign(new Error('Java 21 不可用：' + (javaInfo.output || javaInfo.command)), { statusCode: 503, status: 'FAILED' }));
        return;
      }
      if (!fs.existsSync(jarPath)) {
        reject(Object.assign(new Error('Java 求解器未构建：请先运行 npm run build:solver'), { statusCode: 503, status: 'FAILED' }));
        return;
      }
      const child = spawn(javaCommand, javaArgs, { windowsHide: true });
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
      const timer = setTimeout(() => {
        child.kill();
        const error = Object.assign(new Error('Java 求解超时'), { statusCode: 504, status: 'TIMEOUT' });
        finish(error);
      }, Math.max(5, limitSeconds + 15) * 1000);
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
        finish(Object.assign(new Error('无法启动 Java 求解器：' + error.message), { statusCode: 500, status: 'FAILED' }));
      });
      child.on('close', (code) => {
        if (settled) return;
        if (code !== 0) {
          finish(Object.assign(new Error((stderr || '').trim() || 'Java 求解器退出码 ' + code), { statusCode: 500, status: 'FAILED' }));
          return;
        }
        try {
          finish(null, JSON.parse(stdout.trim()));
        } catch {
          finish(Object.assign(new Error((stderr || '').trim() || 'Java 求解器返回了非 JSON 内容'), { statusCode: 500, status: 'FAILED' }));
        }
      });
      child.stdin.end(JSON.stringify(input));
    });
  }

  function pump() {
    if (activeJob || queue.length === 0) return;
    const item = queue.shift();
    const job = item.job;
    activeJob = job;
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    job.queuePosition = 0;
    updateQueuePositions();
    log('info', '开始求解：' + job.lessons + ' 课时 / ' + job.plans + ' 条计划', job.id);
    runSolver(item.input, job)
      .then((result) => {
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
        job.status = error.status === 'TIMEOUT' ? 'timeout' : 'failed';
        job.finishedAt = new Date().toISOString();
        job.elapsedMs = new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime();
        job.error = error.message;
        log('error', '求解失败：' + error.message, job.id);
        job.reject(error);
      })
      .finally(() => {
        activeJob = null;
        pump();
      });
  }

  function enqueueSolve(input) {
    return new Promise((resolve, reject) => {
      const job = {
        id: 'job-' + Date.now().toString(36) + '-' + (++jobSequence),
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
      queue.push({ job, input });
      log('info', '任务已进入队列：队列位置 ' + job.queuePosition, job.id);
      pump();
    });
  }

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
      host,
      port,
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
        activeJob: activeJob ? activeJob.id : null,
      },
      totalJobs: jobs.length,
    };
  }

  const server = http.createServer(async (req, res) => {
    cors(res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    try {
      const url = new URL(req.url, 'http://127.0.0.1:' + port);
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return send(res, 200, {
          ok: true,
          dataSource: 'local-json',
          solver: 'java',
          java: javaInfo,
          queue: queueCounts(),
          server: { host, port },
        });
      }
      if (req.method === 'GET' && url.pathname === '/api/server/stats') {
        return send(res, 200, serverStats());
      }
      if (req.method === 'GET' && url.pathname === '/api/server/jobs') {
        return send(res, 200, { jobs: jobs.slice().reverse().map(jobSummary) });
      }
      if (req.method === 'GET' && url.pathname === '/api/server/logs') {
        const since = Number(url.searchParams.get('since') || 0);
        const items = logs.filter((item) => item.seq > since);
        return send(res, 200, { logs: items, lastSeq: logSequence });
      }
      if (req.method === 'GET' && url.pathname === '/api/data') {
        return send(res, 200, store.read());
      }
      if (req.method === 'PUT' && url.pathname === '/api/data') {
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return send(res, 400, { error: '请求不是有效 JSON' });
        }
        const error = validateData(body);
        if (error) return send(res, 400, { error });
        return send(res, 200, store.write(body));
      }
      if (req.method === 'POST' && url.pathname === '/api/solve') {
        let input;
        try {
          input = JSON.parse(await readBody(req));
        } catch {
          return send(res, 400, solverFailure('请求不是有效 JSON'));
        }
        try {
          const output = await enqueueSolve(input);
          return send(res, 200, output);
        } catch (error) {
          return send(res, error.statusCode || 500, solverFailure(error.message, error.status || 'FAILED'));
        }
      }

      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        const distDir = path.resolve(rootDir, 'dist');
        const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
        let target = path.resolve(distDir, relative);
        if (!target.startsWith(distDir + path.sep) && target !== path.resolve(distDir, 'index.html')) {
          return send(res, 403, { error: 'Forbidden' });
        }
        if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
          target = path.resolve(distDir, 'index.html');
        }
        if (!fs.existsSync(target)) return send(res, 404, { error: 'Renderer not built' });
        return sendFile(res, target);
      }
      send(res, 404, { error: 'Not found' });
    } catch (error) {
      send(res, 500, { error: error instanceof Error ? error.message : '服务异常' });
    }
  });
  server.on('error', (error) => log('error', 'API 服务异常：' + error.message));
  server.listen(port, host, () => {
    log('info', '本地服务启动：http://' + host + ':' + port);
    log('info', 'Java 求解器：' + (javaInfo.available ? 'Java ' + (javaInfo.version || 'unknown') : '不可用'));
    log('info', '求解线路：' + jarPath + (fs.existsSync(jarPath) ? '（已就绪）' : '（未构建）'));
  });
  return server;
}

module.exports = { startApi, validateData };
