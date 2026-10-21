const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const jar = path.join(root, 'resources', 'solver', 'warpweft-solver.jar');
const java = process.env.JAVA_HOME
  ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  : 'java';

function solve(input) {
  if (!fs.existsSync(jar)) {
    throw new Error('Java solver jar not built: ' + jar + '（先运行 npm run build:solver）');
  }
  const result = spawnSync(java, ['-jar', jar], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

module.exports = { solve, jar, java };
