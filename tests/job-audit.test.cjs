const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { startApi } = require('../server/api/api.cjs');
const { UserStore } = require('../server/api/auth.cjs');

const fakeLongSolver = path.join(__dirname, 'fixtures', 'fake-long-solver.cjs');

test('authenticated long jobs record their creator in the job and audit log', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpweft-job-audit-'));
  const users = new UserStore(path.join(dataDir, 'users.json'));
  users.create({ username: 'admin', password: 'admin-pass-123', role: 'admin' });
  const server = startApi({
    rootDir: path.resolve(__dirname, '..'),
    dataDir,
    port: 0,
    packaged: false,
    solverCommand: process.execPath,
    solverArgs: [fakeLongSolver],
    configFile: path.join(dataDir, 'server-config.json'),
    authEnabled: true,
  });
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const login = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin-pass-123' }),
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    const headers = {
      'Content-Type': 'application/json',
      'X-Client-Id': 'job-audit-test',
      Authorization: 'Bearer ' + token,
    };
    const payload = {
      protocolVersion: '1.0',
      dataSnapshotVersion: 'audit-test',
      classes: [{ id: 'class-1', name: '一班', size: 30 }],
      teachers: [{ id: 'teacher-1', name: '甲老师' }],
      subjects: [{ id: 'subject-1', name: '数学' }],
      rooms: [{ id: 'room-1', name: '一号教室', capacity: 40, type: '普通教室' }],
      timeSlots: [{ id: 'slot-1', day: 1, period: 1, label: '周一 第1节' }],
      coursePlans: [{ id: 'plan-1', classId: 'class-1', subjectId: 'subject-1', teacherId: 'teacher-1', weeklyPeriods: 4 }],
      unavailableSlots: [],
      lockedEntries: [],
      hardConstraints: [],
      rules: [],
      softConstraints: [],
      timeLimitSeconds: 600,
      randomSeed: 1,
      fakeTotal: 2,
      fakeStepMs: 20,
    };
    const response = await fetch(base + '/api/solve/long', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 202);
    const created = await response.json();
    assert.equal(created.job.createdBy, 'admin');

    const audit = fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8');
    assert.match(audit, /"action":"job_create"/);
    assert.match(audit, /"actor":"admin"/);
    assert.match(audit, new RegExp('"target":"' + created.job.id + '"'));
  } finally {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
