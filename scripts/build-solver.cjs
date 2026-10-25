const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const usePowerShell = process.platform === 'win32';
const command = usePowerShell ? 'powershell' : 'bash';
const args = usePowerShell
  ? ['-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'services', 'solver-java', 'build.ps1')]
  : [path.join(root, 'services', 'solver-java', 'build.sh')];

const result = spawnSync(command, args, {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error('无法启动 Java Solver 构建：' + result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  console.error('Java Solver 构建失败，退出码 ' + (result.status ?? 'unknown'));
  process.exit(result.status || 1);
}
