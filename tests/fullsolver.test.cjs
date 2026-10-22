const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

test('server/fullsolver builds and passes its three verification scenarios', { timeout: 180000 }, (t) => {
  if (process.platform !== 'win32') {
    t.skip('verify.ps1 is PowerShell-based');
    return;
  }
  const result = spawnSync(
    'powershell',
    ['-ExecutionPolicy', 'Bypass', '-File', path.join('server', 'fullsolver', 'verify.ps1')],
    { cwd: root, encoding: 'utf8', timeout: 180000 },
  );
  assert.equal(result.status, 0, (result.stdout || '') + (result.stderr || ''));
  assert.match(result.stdout || '', /全流程验证通过/);
});
