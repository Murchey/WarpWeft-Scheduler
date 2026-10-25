const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { startApi } = require('../server/api/api.cjs');

const fakeLongSolver = path.join(__dirname, 'fixtures', 'fake-long-solver.cjs');

function payload(overrides = {}) {
  return {
    protocolVersion: '1.0',
    dataSnapshotVersion: 'ownership-test',
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
    fakeTotal: 4,
    fakeStepMs: 200,
    fakeHang: true,
    ...overrides,
  };
}

async function start() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpweft-owner-'));
  const server = startApi({
    rootDir: path.resolve(__dirname, '..'),
    dataDir,
    port: 0,
    packaged: false,
    solverCommand: process.execPath,
    solverArgs: [fakeLongSolver],
    configFile: path.join(dataDir, 'server-config.json'),
  });
  await once(server, 'listening');
  const { port } = server.address();
  return {
    base: 'http://127.0.0.1:' + port,
    close: async () => {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function headers(clientId) {
  return { 'Content-Type': 'application/json', 'X-Client-Id': clientId };
}

test('long jobs are visible and controllable only by their owner', async () => {
  const ctx = await start();
  try {
    const createdResponse = await fetch(ctx.base + '/api/solve/long', {
      method: 'POST',
      headers: headers('owner-a'),
      body: JSON.stringify(payload({ taskUuid: 'task-owner-a', snapshotId: 'snapshot-a' })),
    });
    assert.equal(createdResponse.status, 202);
    const created = await createdResponse.json();
    const jobId = created.job.id;
    assert.match(jobId, /^long-/);

    const ownerList = await fetch(ctx.base + '/api/solve/jobs', { headers: headers('owner-a') });
    assert.equal(ownerList.status, 200);
    assert.ok((await ownerList.json()).jobs.some((job) => job.id === jobId));

    const otherList = await fetch(ctx.base + '/api/solve/jobs', { headers: headers('owner-b') });
    assert.equal(otherList.status, 200);
    assert.deepEqual((await otherList.json()).jobs, []);

    const otherRead = await fetch(ctx.base + '/api/solve/jobs/' + jobId, { headers: headers('owner-b') });
    assert.equal(otherRead.status, 403);
    assert.equal((await otherRead.json()).code, 'TASK_FORBIDDEN');

    const otherByUuid = await fetch(ctx.base + '/api/solve/jobs/by-uuid/task-owner-a', { headers: headers('owner-b') });
    assert.equal(otherByUuid.status, 403);
    assert.equal((await otherByUuid.json()).code, 'TASK_FORBIDDEN');

    const otherPause = await fetch(ctx.base + '/api/solve/jobs/' + jobId + '/pause', {
      method: 'POST',
      headers: headers('owner-b'),
    });
    assert.equal(otherPause.status, 403);

    const otherDelete = await fetch(ctx.base + '/api/solve/jobs/' + jobId, {
      method: 'DELETE',
      headers: headers('owner-b'),
    });
    assert.equal(otherDelete.status, 403);

    const otherReuse = await fetch(ctx.base + '/api/solve/long', {
      method: 'POST',
      headers: headers('owner-b'),
      body: JSON.stringify(payload({ taskUuid: 'task-owner-a', snapshotId: 'snapshot-a' })),
    });
    assert.equal(otherReuse.status, 403);

    const ownerRead = await fetch(ctx.base + '/api/solve/jobs/' + jobId, { headers: headers('owner-a') });
    assert.equal(ownerRead.status, 200);
    assert.equal((await ownerRead.json()).id, jobId);

    const ownerCancel = await fetch(ctx.base + '/api/solve/jobs/' + jobId + '/cancel', {
      method: 'POST',
      headers: headers('owner-a'),
    });
    assert.equal(ownerCancel.status, 200);
  } finally {
    await ctx.close();
  }
});
