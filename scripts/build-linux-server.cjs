const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const skipBuild = process.argv.includes('--skip-build');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
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
  console.log('[linux-server] Building renderer and Java solver…');
  if (process.platform === 'win32') {
    run('cmd.exe', ['/d', '/s', '/c', 'npm run build']);
  } else {
    run('npm', ['run', 'build']);
  }
}

for (const required of ['dist/index.html', 'data-schema.json', 'resources/solver/warpweft-solver.jar']) {
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
