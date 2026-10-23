#!/usr/bin/env node
/**
 * Browser development launcher: local API + Vite, then open the browser.
 *
 * Usage: npm run dev:web
 *        npm run dev:web -- --lan
 *        npm run dev:web -- --no-open
 *        node scripts/dev-web.cjs --dry-run
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const lan = process.argv.includes('--lan') || process.env.WARPVEFT_HOST === '0.0.0.0';
const dryRun = process.argv.includes('--dry-run');
const noOpen = process.argv.includes('--no-open');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const viteUrl = 'http://127.0.0.1:5173/';
const apiUrl = 'http://127.0.0.1:4317/api/health';
const children = new Set();
let shuttingDown = false;

function log(prefix, message) {
  console.log('[' + prefix + '] ' + message);
}

function probe(url, timeoutMs = 800) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode !== undefined && response.statusCode < 500);
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
  });
}

async function waitFor(label, url, child, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child && child.exitCode !== null) throw new Error(label + ' 进程已退出（退出码 ' + child.exitCode + '）');
    if (await probe(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('等待 ' + label + ' 超时：' + url);
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) killTree(child);
  process.exitCode = code;
  setTimeout(() => process.exit(code), 150).unref();
}

function openBrowser(url) {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

function lanAddresses() {
  const result = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const info of list || []) {
      if (info.family === 'IPv4' && !info.internal) result.push(info.address);
    }
  }
  return result;
}

async function ensureSolver() {
  const jar = path.join(root, 'resources', 'solver', 'warpweft-solver.jar');
  if (fs.existsSync(jar)) return;
  log('solver', '未找到 warpweft-solver.jar，先构建一次…');
  if (dryRun) return;
  const result = spawnSync('npm', ['run', 'build:solver'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) log('solver', '构建失败；排课将不可用，但界面仍可启动。');
}

async function main() {
  if (!fs.existsSync(viteBin)) throw new Error('找不到 Vite：' + viteBin + '，请先 npm install');
  const apiAlreadyRunning = await probe(apiUrl);
  const viteAlreadyRunning = await probe(viteUrl);
  if (dryRun) {
    log('dev', 'root: ' + root);
    log('dev', 'mode: ' + (lan ? '局域网（API/Vite 监听 0.0.0.0）' : '本机'));
    log('dev', 'vite: ' + viteBin + (viteAlreadyRunning ? '（已在运行，复用）' : '（将启动）'));
    log('dev', 'api:  ' + (apiAlreadyRunning ? '已有 API，复用' : '将启动'));
    return;
  }

  await ensureSolver();

  if (apiAlreadyRunning) {
    log('api', '复用已有 ' + apiUrl);
  } else {
    const api = spawn(process.execPath, [path.join(root, 'scripts', 'dev-api.cjs')], {
      cwd: root,
      env: { ...process.env, WARPVEFT_HOST: lan ? '0.0.0.0' : '127.0.0.1' },
      stdio: 'inherit',
    });
    children.add(api);
    api.on('exit', (code) => {
      if (!shuttingDown) {
        log('api', '进程退出（' + (code ?? 'signal') + '）');
        shutdown(code || 1);
      }
    });
    await waitFor('API', apiUrl, api);
    log('api', '已就绪：http://127.0.0.1:4317');
  }

  if (viteAlreadyRunning) {
    log('vite', '复用已有 ' + viteUrl);
  } else {
    const vite = spawn(
      process.execPath,
      [viteBin, '--host', lan ? '0.0.0.0' : '127.0.0.1', '--port', '5173', '--strictPort'],
      { cwd: root, env: process.env, stdio: 'inherit' },
    );
    children.add(vite);
    vite.on('exit', (code) => {
      if (!shuttingDown) {
        log('vite', '进程退出（' + (code ?? 'signal') + '）');
        shutdown(code || 1);
      }
    });
    await waitFor('Vite', viteUrl, vite);
    log('vite', '已就绪：' + viteUrl);
  }

  const query = lan ? '?mode=lan-server&endpoint=http://127.0.0.1:4317' : '?mode=single';
  const localUrl = 'http://127.0.0.1:5173/' + query;
  if (noOpen) {
    log('browser', '已跳过自动打开，请手动访问 ' + localUrl);
  } else {
    log('browser', '打开 ' + localUrl);
    openBrowser(localUrl);
  }
  if (lan) {
    for (const address of lanAddresses()) {
      log('lan', '其他设备：http://' + address + ':5173/?mode=lan-client&endpoint=http://' + address + ':4317');
    }
  }
  log('dev', '按 Ctrl+C 结束本次调试。');

  const stop = () => shutdown(0);
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('SIGBREAK', stop);
}

main().catch((error) => {
  console.error('[dev] ' + error.message);
  shutdown(1);
});
