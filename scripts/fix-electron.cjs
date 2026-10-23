#!/usr/bin/env node
/**
 * Repair a partially installed Electron binary.
 *
 * npm install can leave node_modules/electron/dist with only a few files while
 * the package itself looks installed. @electron/get accepts the mirror via
 * npm_config_electron_mirror / ELECTRON_MIRROR; setting both here also works
 * with older npm configs that only know electron_mirror.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const electronDir = path.join(root, 'node_modules', 'electron');
const installer = path.join(electronDir, 'install.js');
const mirror = process.env.ELECTRON_MIRROR || 'https://cdn.npmmirror.com/binaries/electron/';

if (!fs.existsSync(installer)) {
  console.error('[fix-electron] node_modules/electron/install.js 不存在，请先 npm install electron。');
  process.exit(1);
}

try {
  const installed = require('electron');
  console.log('[fix-electron] Electron 已安装：' + installed);
  process.exit(0);
} catch {
  // fall through to the installer
}

const env = {
  ...process.env,
  ELECTRON_MIRROR: mirror,
  npm_config_electron_mirror: mirror,
};
delete env.ELECTRON_RUN_AS_NODE;

console.log('[fix-electron] 下载/解压 Electron 二进制（镜像：' + mirror + '）…');
const result = spawnSync(process.execPath, [installer], { cwd: root, env, stdio: 'inherit' });
if (result.status !== 0) {
  console.error('[fix-electron] 修复失败。可尝试删除 node_modules/electron 后重新 npm install。');
  process.exit(result.status || 1);
}

try {
  const electron = require('electron');
  console.log('[fix-electron] 完成：' + electron);
} catch (error) {
  console.error('[fix-electron] 安装后仍无法加载：' + error.message);
  process.exit(1);
}
