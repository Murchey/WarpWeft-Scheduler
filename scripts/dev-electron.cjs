#!/usr/bin/env node
/**
 * One-command Electron development launcher.
 *
 * Starts Vite on 127.0.0.1:5173, waits for it, then starts Electron with
 * VITE_DEV_SERVER_URL. Electron's main process starts the local API on 4317
 * unless an API is already running (then it reuses it).
 *
 * Usage: npm run dev:electron
 *        node scripts/dev-electron.cjs --dry-run
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');
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

async function ensureSolver() {
  const jar = path.join(root, 'resources', 'solver', 'warpweft-solver.jar');
  if (fs.existsSync(jar)) return;
  log('solver', '未找到 warpweft-solver.jar，先构建一次…');
  if (dryRun) {
    log('solver', 'dry-run：将执行 npm run build:solver');
    return;
  }
  const result = spawnSync('npm', ['run', 'build:solver'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) log('solver', '构建失败；排课将不可用，但界面仍可启动。');
}

async function main() {
  if (!fs.existsSync(viteBin)) {
    throw new Error('找不到 Vite：' + viteBin + '，请先 npm install');
  }
  let electronBinary;
  try {
    electronBinary = require('electron');
  } catch (cause) {
    const localBinary =
      process.platform === 'win32'
        ? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
        : process.platform === 'darwin'
          ? path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
          : path.join(root, 'node_modules', 'electron', 'dist', 'electron');
    if (fs.existsSync(localBinary)) electronBinary = localBinary;
    else throw new Error('Electron 不可用：' + cause.message + '。请运行 npm install，或运行 npm run fix:electron 修复二进制');
  }
  if (typeof electronBinary !== 'string' || !fs.existsSync(electronBinary)) {
    throw new Error('Electron 可执行文件不可用：' + electronBinary + '。请运行 npm run fix:electron');
  }

  const apiAlreadyRunning = await probe(apiUrl);
  const viteAlreadyRunning = await probe(viteUrl);
  if (dryRun) {
    log('dev', 'root: ' + root);
    log('dev', 'vite: ' + viteBin + (viteAlreadyRunning ? '（已在运行，复用）' : '（将启动）'));
    log('dev', 'electron: ' + electronBinary);
    log('dev', 'api:  ' + (apiAlreadyRunning ? '已有 API，复用' : '由 Electron 启动'));
    return;
  }

  await ensureSolver();

  let vite = null;
  if (viteAlreadyRunning) {
    log('vite', '复用已有 ' + viteUrl);
  } else {
    vite = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    });
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

  const env = {
    ...process.env,
    VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
    NODE_ENV: process.env.NODE_ENV || 'development',
  };
  // Some IDE/DSH terminals export ELECTRON_RUN_AS_NODE=1. Passing it to the
  // Electron binary starts it as plain Node, so ipcMain/BrowserWindow are
  // undefined. Always launch the real Electron main process in dev.
  delete env.ELECTRON_RUN_AS_NODE;
  if (apiAlreadyRunning) env.WARPVEFT_SKIP_LOCAL_API = '1';

  log('electron', '启动桌面窗口…' + (apiAlreadyRunning ? '（复用 4317 上已有 API）' : '（Electron 将启动本地 API）'));
  const electron = spawn(electronBinary, ['.'], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  children.add(electron);
  electron.on('exit', (code) => {
    if (!shuttingDown) {
      log('electron', '窗口退出（' + (code ?? 'signal') + '）');
      shutdown(code || 0);
    }
  });

  const stop = () => shutdown(0);
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('SIGBREAK', stop);
}

main().catch((error) => {
  console.error('[dev] ' + error.message);
  shutdown(1);
});
