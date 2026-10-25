const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'linux_server', 'admin-cli.cjs');

function run(dataDir, args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, WARPVEFT_DATA_DIR: dataDir, WARPVEFT_USER_PASSWORD: 'Passw0rd!' },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('admin CLI creates, lists, resets and removes users with an audit trail', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpweft-cli-'));
  try {
    let result = run(dataDir, ['user', 'add', 'admin', '--admin']);
    assert.equal(result.status, 0, result.stderr);
    result = run(dataDir, ['user', 'add', 'teacher1']);
    assert.equal(result.status, 0, result.stderr);
    result = run(dataDir, ['user', 'list']);
    assert.match(result.stdout, /admin\tadmin\tactive/);
    assert.match(result.stdout, /teacher1\tuser\tactive/);

    result = run(dataDir, ['user', 'passwd', 'teacher1']);
    assert.equal(result.status, 0, result.stderr);
    result = run(dataDir, ['user', 'remove', 'teacher1', '--yes']);
    assert.equal(result.status, 0, result.stderr);

    const audit = fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8');
    assert.match(audit, /"action":"user_create"/);
    assert.match(audit, /"action":"password_reset"/);
    assert.match(audit, /"action":"user_delete"/);
    assert.match(audit, /"target":"teacher1"/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('admin CLI lists long jobs by creator and filters logs by user', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpweft-cli-'));
  try {
    assert.equal(run(dataDir, ['user', 'add', 'admin', '--admin']).status, 0);
    const jobsDir = path.join(dataDir, 'solve-jobs');
    fs.mkdirSync(jobsDir, { recursive: true });
    fs.writeFileSync(path.join(jobsDir, 'long-1.json'), JSON.stringify({
      id: 'long-1',
      createdBy: 'admin',
      status: 'completed',
      createdAt: '2026-10-25T00:00:00.000Z',
      lessons: 30,
      progress: { placed: 28, total: 30 },
    }));
    fs.writeFileSync(path.join(jobsDir, 'long-2.json'), JSON.stringify({
      id: 'long-2',
      createdBy: 'teacher1',
      status: 'paused',
      createdAt: '2026-10-24T00:00:00.000Z',
      lessons: 20,
      progress: { placed: 12, total: 20 },
    }));

    let result = run(dataDir, ['task', 'admin']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /long-1/);
    assert.doesNotMatch(result.stdout, /long-2/);
    assert.match(result.stdout, /28\/30/);

    result = run(dataDir, ['log', 'admin']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /创建用户/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('workspace clear deletes workspace and jobs but preserves users', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpweft-cli-'));
  try {
    assert.equal(run(dataDir, ['user', 'add', 'admin', '--admin']).status, 0);
    fs.writeFileSync(path.join(dataDir, 'warpweft.json'), '{"school":{}}');
    const jobsDir = path.join(dataDir, 'solve-jobs');
    fs.mkdirSync(jobsDir, { recursive: true });
    fs.writeFileSync(path.join(jobsDir, 'long-1.json'), '{}');

    const result = run(dataDir, ['workspace', 'clear']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(dataDir, 'warpweft.json')), false);
    assert.equal(fs.existsSync(path.join(jobsDir, 'long-1.json')), false);
    assert.equal(fs.existsSync(path.join(dataDir, 'users.json')), true);
    assert.match(fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8'), /"action":"workspace_clear"/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
