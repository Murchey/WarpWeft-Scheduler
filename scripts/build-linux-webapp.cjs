#!/usr/bin/env node
/**
 * 第二种 Linux 部署包：**网页版应用**（warpweft-linux-webapp-<版本>.tar.gz）。
 *
 * 与「纯服务端包」的区别：
 *   - 服务端包（scripts/build-linux-server.cjs）：只做官网 + 监控 + API 运算，
 *     不含排课界面；排课在 Electron 桌面客户端完成。
 *   - 本包：把排课界面（React 应用）单独打出来，**可直接部署到任意网站**，
 *     给那些想用浏览器排课、不想装桌面客户端的用户。
 *
 * 包内容：
 *   dist/index.html、dist/icon.svg、dist/assets/   应用静态资源
 *   nginx.conf.example                            部署到网站的示例配置
 *   README.md                                     部署说明
 *
 * 注意：本包**只有前端**，必须指向一个 WarpWeft 服务端（纯服务端包）才能工作。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const skipBuild = process.argv.includes('--skip-build');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version || '0.0.0';
const outputDir = path.join(root, 'dist', 'linux');
const stageParent = path.join(root, 'build', 'linux-webapp');
const stage = path.join(stageParent, 'warpweft-webapp');
const tarName = 'warpweft-linux-webapp-' + version + '.tar.gz';
const tarPath = path.join(outputDir, tarName);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32' && !command.endsWith('.exe'),
    ...options,
  });
  if (result.error) throw new Error('无法启动 ' + command + '：' + result.error.message);
  if (result.status !== 0) throw new Error(command + ' 退出码 ' + (result.status ?? 'unknown'));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** 校验 index.html 引用的本地资源都真实存在，避免「部署上去白屏」。 */
function verifyRendererAssets(distDir) {
  const indexPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexPath)) throw new Error('构建产物缺少 dist/index.html（先运行 npm run build）');
  const html = fs.readFileSync(indexPath, 'utf8');
  const refs = Array.from(html.matchAll(/(?:src|href)="([^"]+)"/g), (m) => m[1])
    .filter((ref) => ref && !/^(?:https?:|data:|#|\/\/)/i.test(ref));
  const hashes = {};
  for (const ref of refs) {
    const clean = ref.split('?')[0].split('#')[0];
    const target = path.resolve(distDir, clean.replace(/^\/+/, ''));
    if (!target.startsWith(path.resolve(distDir) + path.sep)) {
      throw new Error('应用资源路径越界：' + ref);
    }
    if (!fs.existsSync(target)) throw new Error('应用资源缺失：' + ref);
    hashes[clean] = sha256(target);
  }
  return { count: refs.length, hashes };
}

if (!skipBuild) {
  console.log('[linux-webapp] 构建渲染层…');
  // 与服务端包共用 dist/index.html + dist/assets；prebuild 会精确清理应用产物。
  run('npm', ['run', 'build']);
}

for (const required of ['dist/index.html', 'dist/icon.svg']) {
  if (!fs.existsSync(path.join(root, required))) {
    throw new Error('缺少打包文件：' + required);
  }
}
if (!fs.existsSync(path.join(root, 'dist', 'assets'))) {
  throw new Error('缺少 dist/assets（应用静态资源）');
}

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, 'dist'), { recursive: true });

// 只拷应用自身产物，不要把 dist/site、dist/linux、dist/windows 带进来。
fs.cpSync(path.join(root, 'dist', 'index.html'), path.join(stage, 'dist', 'index.html'));
fs.cpSync(path.join(root, 'dist', 'icon.svg'), path.join(stage, 'dist', 'icon.svg'));
fs.cpSync(path.join(root, 'dist', 'assets'), path.join(stage, 'dist', 'assets'), { recursive: true });

const deployReadme = [
  '# WarpWeft 网页版应用',
  '',
  '这是**排课界面**的静态前端包，可以直接部署到任意网站（Nginx、对象存储 + CDN 等）。',
  '它只负责界面，**必须指向一个 WarpWeft 服务端**（纯服务端包）才能排课。',
  '',
  '## 你需要什么',
  '',
  '1. 一个已经跑起来的 WarpWeft 服务端（默认 http://127.0.0.1:4317）。',
  '2. 一个能提供静态文件的网站（下面以 Nginx 为例）。',
  '',
  '## 部署（Nginx）',
  '',
  '把本包的 dist/ 解压到网站目录，再把下面的 location 加进你的 server 块：',
  '',
  '```nginx',
  '# 排课界面：静态文件',
  'location /app/ {',
  '    alias /var/www/warpweft/;   # 指向解压后的 dist/',
  '    try_files $uri $uri/ /app/index.html;',
  '}',
  '',
  '# 后端接口：转发到 WarpWeft 服务端',
  'location /api/ {',
  '    proxy_pass http://127.0.0.1:4317;',
  '    proxy_http_version 1.1;',
  '    proxy_set_header X-Real-IP $remote_addr;',
  '    proxy_set_header X-Forwarded-For $remote_addr;',
  '    proxy_set_header X-Forwarded-Proto $scheme;',
  '    proxy_set_header Connection "";',
  '    proxy_read_timeout 900s;',
  '    proxy_send_timeout 900s;',
  '    proxy_buffering off;      # 长时排课结果是流式返回的',
  '}',
  '```',
  '',
  '完整示例见同目录的 nginx.conf.example。',
  '',
  '## 用法',
  '',
  '浏览器打开 https://你的域名/app/ ，在「运行模式」里选「局域网客户端」或「云端」，',
  '填入服务端地址（如 https://你的域名 ）即可开始排课。',
  '',
  '## 前提',
  '',
  '- 服务端必须启用 TLS（公网）；浏览器不允许 https 页面调用 http 接口。',
  '- 排课需要服务端装有 Java 21+；界面会检测并给出下载链接。',
  '- 服务端开启账号登录时，界面会要求登录。',
].join('\n');
fs.writeFileSync(path.join(stage, 'README.md'), deployReadme + '\n', 'utf8');

const nginxExample = [
  '# WarpWeft 网页版应用 —— 部署到网站的示例配置。',
  '#',
  '# 把本包的 dist/ 解压到 /var/www/warpweft/ 后，把下面两个 location 加进你的 server 块。',
  '# /api/ 必须指向一个已经跑起来的 WarpWeft 服务端（纯服务端包）。',
  '',
  '    # ---------- 排课界面：静态文件 ----------',
  '    location /app/ {',
  '        alias /var/www/warpweft/;',
  '        # SPA 回落：未知路径返回应用入口，否则刷新会 404',
  '        try_files $uri $uri/ /app/index.html;',
  '        add_header Cache-Control "no-cache, must-revalidate" always;',
  '    }',
  '',
  '    # 应用资源带内容哈希，可长缓存',
  '    location /app/assets/ {',
  '        alias /var/www/warpweft/assets/;',
  '        expires 1y;',
  '        add_header Cache-Control "public, immutable" always;',
  '    }',
  '',
  '    # ---------- 后端接口：转发到 WarpWeft 服务端 ----------',
  '    location /api/ {',
  '        proxy_pass http://127.0.0.1:4317;',
  '        proxy_http_version 1.1;',
  '        proxy_set_header X-Real-IP $remote_addr;',
  '        # 覆盖而非追加：服务端只信任第一个地址',
  '        proxy_set_header X-Forwarded-For $remote_addr;',
  '        proxy_set_header X-Forwarded-Proto $scheme;',
  '        proxy_set_header Connection "";',
  '        proxy_read_timeout 900s;',
  '        proxy_send_timeout 900s;',
  '        # 长时求解结果流式返回，必须关闭缓冲',
  '        proxy_buffering off;',
  '    }',
].join('\n');
fs.writeFileSync(path.join(stage, 'nginx.conf.example'), nginxExample + '\n', 'utf8');

const site = verifyRendererAssets(path.join(stage, 'dist'));
const manifest = {
  kind: 'webapp',
  appVersion: version,
  builtAt: new Date().toISOString(),
  assetCount: site.count,
  assetHashes: { ...site.hashes },
};
fs.writeFileSync(path.join(stage, 'warpweft-webapp-build.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log('[linux-webapp] 应用资源 ' + site.count + ' 项');

fs.mkdirSync(outputDir, { recursive: true });
fs.rmSync(tarPath, { force: true });
const tarRelativePath = path.relative(root, tarPath).split(path.sep).join('/');
const stageRelativePath = path.relative(root, stageParent).split(path.sep).join('/');
run('tar', ['-czf', tarRelativePath, '-C', stageRelativePath, 'warpweft-webapp'], { shell: false });
const digest = crypto.createHash('sha256').update(fs.readFileSync(tarPath)).digest('hex');
fs.writeFileSync(tarPath + '.sha256', digest + '  ' + tarName + '\n', 'utf8');

const size = fs.statSync(tarPath).size;
console.log('[linux-webapp] ' + path.relative(root, tarPath) + ' (' + (size / 1024 / 1024).toFixed(1) + ' MiB)');
console.log('[linux-webapp] SHA256 ' + digest);
