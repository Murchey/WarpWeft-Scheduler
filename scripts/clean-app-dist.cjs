#!/usr/bin/env node
/**
 * 只清理**应用自身**的构建产物，不动 dist/site、dist/linux、dist/windows。
 *
 * 为什么要这一步：Vite 的 emptyOutDir 会把整个 dist/ 清空，会连带删掉
 * 已经打好的 Linux/Windows 部署包与官网产物。因此 vite.config.ts 里把
 * emptyOutDir 关掉，改由这里精确删除应用自己的文件。
 */
const fs = require('node:fs');
const path = require('node:path');

const distDir = path.resolve(__dirname, '..', 'dist');
// 应用产物清单：index.html、图标，以及内容哈希命名的 assets/。
const appOwned = ['index.html', 'icon.svg', 'assets'];

let removed = 0;
for (const name of appOwned) {
  const target = path.join(distDir, name);
  if (!fs.existsSync(target)) continue;
  fs.rmSync(target, { recursive: true, force: true });
  removed += 1;
}

// 防呆：绝不允许把清理范围写成整个 dist。
for (const preserved of ['site', 'linux', 'windows']) {
  if (!fs.existsSync(path.join(distDir, preserved))) continue;
  console.log('[clean-app-dist] 保留 dist/' + preserved + '/');
}

console.log('[clean-app-dist] 已清理应用产物 ' + removed + ' 项（dist/linux、dist/windows、dist/site 未受影响）');
