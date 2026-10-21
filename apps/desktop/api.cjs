const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { openDatabase } = require('./database.cjs');

const MAX_BODY = 5 * 1024 * 1024;

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

function startApi({
  rootDir,
  dataDir = path.join(rootDir, 'data'),
  port = 4317,
  packaged = false,
  solverCommand,
  solverArgs,
}) {
  const store = openDatabase(rootDir, dataDir);
  const command =
    solverCommand ||
    (packaged
      ? path.join(
          process.resourcesPath,
          'solver',
          process.platform === 'win32' ? 'warpweft-solver.exe' : 'warpweft-solver',
        )
      : process.platform === 'win32'
        ? 'python'
        : 'python3');
  const args =
    solverArgs ||
    (packaged ? [] : [path.join(rootDir, 'services', 'solver', 'solver.py')]);

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
          solver: packaged ? 'bundled' : command,
        });
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
        const solver = spawn(command, args, { windowsHide: true });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (status, payload) => {
          if (settled) return;
          settled = true;
          send(res, status, payload);
        };
        const limitSeconds = Number(input.timeLimitSeconds) || 30;
        const timer = setTimeout(() => {
          solver.kill();
          finish(504, solverFailure('求解超时', 'TIMEOUT'));
        }, Math.max(5, limitSeconds + 10) * 1000);
        solver.stdout.on('data', (chunk) => (stdout += chunk));
        solver.stderr.on('data', (chunk) => (stderr += chunk));
        solver.stdin.on('error', () => {});
        solver.on('error', (error) => {
          clearTimeout(timer);
          finish(500, solverFailure('无法启动本地求解器：' + error.message));
        });
        solver.on('close', (code) => {
          clearTimeout(timer);
          if (settled) return;
          if (code !== 0) {
            return finish(
              500,
              solverFailure(
                (stderr || '').trim() || '求解器退出码 ' + code,
                'FAILED',
              ),
            );
          }
          try {
            finish(200, JSON.parse(stdout.trim()));
          } catch {
            finish(
              500,
              solverFailure(
                (stderr || '').trim() || '求解器返回了非 JSON 内容',
                'FAILED',
              ),
            );
          }
        });
        solver.stdin.end(JSON.stringify(input));
        return;
      }

      // Serve the built renderer from the same local origin in packaged mode.
      // Loading dist/index.html through file:// blocks ES module scripts, which
      // is why the installer used to open a blank window.
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
  server.listen(port, '127.0.0.1');
  return server;
}

module.exports = { startApi, validateData };
