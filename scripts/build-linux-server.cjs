const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const skipBuild = process.argv.includes('--skip-build');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const schema = JSON.parse(fs.readFileSync(path.join(root, 'data-schema.json'), 'utf8'));
const version = pkg.version || '0.0.0';
const outputDir = path.join(root, 'dist', 'linux-server');
const stageParent = path.join(root, 'build', 'linux-server');
const stage = path.join(stageParent, 'warpweft');
const tarName = 'warpweft-linux-server-' + version + '.tar.gz';
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

function copy(source, target) {
  const dst = path.join(stage, target);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(path.join(root, source), dst, { recursive: true });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function verifyRendererAssets(distDir, htmlRelative = 'index.html') {
  const indexPath = path.join(distDir, htmlRelative);
  if (!fs.existsSync(indexPath)) throw new Error('构建产物缺少 dist/' + htmlRelative);
  const html = fs.readFileSync(indexPath, 'utf8');
  const refs = Array.from(html.matchAll(/(?:src|href)="([^"]+)"/g), (match) => match[1])
    .filter((ref) => ref && !/^(?:https?:|data:|#|\/\/)/i.test(ref));
  const hashes = {};
  for (const ref of refs) {
    const clean = ref.split('?')[0].split('#')[0];
    const target = path.resolve(distDir, clean.replace(/^\/+/, ''));
    if (!target.startsWith(path.resolve(distDir) + path.sep)) {
      throw new Error('renderer 资源路径越界：' + ref);
    }
    if (!fs.existsSync(target)) throw new Error('renderer 资源缺失：' + ref);
    hashes[clean] = sha256(target);
  }
  return { count: refs.length, hashes };
}

function copyRenderer(source, target) {
  const src = path.join(root, source);
  const dst = path.join(stage, target);
  fs.mkdirSync(dst, { recursive: true });
  const excluded = new Set([
    'linux-server',
    'win-unpacked',
    'builder-debug.yml',
    'builder-effective-config.yaml',
    'latest.yml',
  ]);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.name.endsWith('.exe') || entry.name.endsWith('.blockmap')) continue;
    fs.cpSync(path.join(src, entry.name), path.join(dst, entry.name), { recursive: true });
  }
}

if (!skipBuild) {
  console.log('[linux-server] 构建渲染层、Java 求解器与官网…');
  // 顺序不可交换：应用构建会清空 dist/，官网产物（dist/site）必须在其之后生成。
  if (process.platform === 'win32') {
    run('cmd.exe', ['/d', '/s', '/c', 'npm run build && npm run build:site']);
  } else {
    run('npm', ['run', 'build']);
    run('npm', ['run', 'build:site']);
  }
}

for (const required of [
  'dist/index.html',
  'dist/site/index.html',
  'data-schema.json',
  'resources/solver/warpweft-solver.jar',
]) {
  if (!fs.existsSync(path.join(root, required))) {
    throw new Error('缺少打包文件：' + required + (required.includes('solver') ? '（先运行 npm run build:solver）' : ''));
  }
}
if (!fs.existsSync(path.join(root, 'guideline.md'))) {
  throw new Error('缺少 guideline.md');
}
if (!fs.existsSync(path.join(root, 'linux_server', 'server.cjs'))) {
  throw new Error('缺少 linux_server/server.cjs');
}

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

copy('linux_server', 'linux_server');
copy('server/api', 'server/api');
copyRenderer('dist', 'dist');
copy('resources/solver/warpweft-solver.jar', 'resources/solver/warpweft-solver.jar');
copy('data-schema.json', 'data-schema.json');
copy('guideline.md', 'guideline.md');
copy('LICENSE', 'LICENSE');

const runtimePackage = {
  name: pkg.name,
  version,
  private: true,
  description: pkg.description,
  main: 'linux_server/server.cjs',
};
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(runtimePackage, null, 2) + '\n', 'utf8');

// 应用入口与官网入口的资源引用合并进同一份 assetHashes：
// verify-manifest.cjs 按 dist/<引用路径> 解析，因此官网资源（dist/site/assets/*）
// 无需改动校验脚本即可获得完整性保护。
const renderer = verifyRendererAssets(path.join(stage, 'dist'), 'index.html');
const site = verifyRendererAssets(path.join(stage, 'dist'), 'site/index.html');
const manifest = {
  appVersion: version,
  schemaVersion: Number(schema.version) || 1,
  solverProtocol: schema.solverProtocol || '1.0',
  capabilities: Array.isArray(schema.features) ? schema.features : [],
  builtAt: new Date().toISOString(),
  assetCount: renderer.count + site.count,
  assetHashes: { ...renderer.hashes, ...site.hashes },
  hashes: {
    rendererIndex: sha256(path.join(stage, 'dist', 'index.html')),
    siteIndex: sha256(path.join(stage, 'dist', 'site', 'index.html')),
    serverApi: sha256(path.join(stage, 'server', 'api', 'api.cjs')),
    serverEntry: sha256(path.join(stage, 'linux_server', 'server.cjs')),
    dataSchema: sha256(path.join(stage, 'data-schema.json')),
    solverJar: sha256(path.join(stage, 'resources', 'solver', 'warpweft-solver.jar')),
  },
};
fs.writeFileSync(path.join(stage, 'warpweft-build.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(
  '[linux-server] renderer assets: ' + renderer.count +
    ', site assets: ' + site.count +
    ', schema v' + manifest.schemaVersion,
);

fs.mkdirSync(outputDir, { recursive: true });
fs.rmSync(tarPath, { force: true });
const tarRelativePath = path.relative(root, tarPath).split(path.sep).join('/');
const stageRelativePath = path.relative(root, stageParent).split(path.sep).join('/');
run('tar', ['-czf', tarRelativePath, '-C', stageRelativePath, 'warpweft'], { shell: false });
const digest = crypto.createHash('sha256').update(fs.readFileSync(tarPath)).digest('hex');
fs.writeFileSync(tarPath + '.sha256', digest + '  ' + tarName + '\n', 'utf8');

const size = fs.statSync(tarPath).size;
console.log('[linux-server] ' + path.relative(root, tarPath) + ' (' + (size / 1024 / 1024).toFixed(1) + ' MiB)');
console.log('[linux-server] SHA256 ' + digest);
