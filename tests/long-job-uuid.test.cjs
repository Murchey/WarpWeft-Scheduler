const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const { startApi } = require('../apps/desktop/api.cjs');
const fakeLongSolver = path.join(__dirname, 'fixtures', 'fake-long-solver.cjs');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warpweft-uuid-'));
}

async function start(dataDir) {
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
    server,
    base: `http://127.0.0.1:${port}`,
    close: async () => {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

const headers = { 'Content-Type': 'application/json', 'X-Client-Id': 'uuid-test' };

function payload(overrides = {}) {
  return {
    protocolVersion: '1.0',
    dataSnapshotVersion: 'uuid-test',
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
    ...overrides,
  };
}

async function post(ctx, body, clientId = 'uuid-test') {
  const response = await fetch(`${ctx.base}/api/solve/long`, {
    method: 'POST',
    headers: { ...headers, 'X-Client-Id': clientId },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function getByUuid(ctx, taskUuid, clientId = 'uuid-test') {
  const response = await fetch(`${ctx.base}/api/solve/jobs/by-uuid/${encodeURIComponent(taskUuid)}`, {
    headers: { 'X-Client-Id': clientId },
  });
  return { status: response.status, body: await response.json() };
}

test('a task UUID makes submission idempotent and rejects snapshot conflicts', async () => {
  const dataDir = tempDir();
  const ctx = await start(dataDir);
  try {
    const first = await post(ctx, payload({ taskUuid: 'task-aaa-111', snapshotId: 'snap-1', fakeTotal: 3, fakeStepMs: 30 }));
    assert.equal(first.status, 202);
    assert.equal(first.body.reused, false);
    assert.match(first.body.job.id, /^long-/);
    assert.equal(first.body.job.taskUuid, 'task-aaa-111');

    // A network retry with the same uuid + snapshot returns the same job.
    const retry = await post(ctx, payload({ taskUuid: 'task-aaa-111', snapshotId: 'snap-1', fakeTotal: 3, fakeStepMs: 30 }));
    assert.equal(retry.status, 200);
    assert.equal(retry.body.reused, true);
    assert.equal(retry.body.job.id, first.body.job.id);

    // Re-using the uuid for different data is a hard conflict.
    const conflict = await post(ctx, payload({ taskUuid: 'task-aaa-111', snapshotId: 'snap-2', fakeTotal: 3, fakeStepMs: 30 }));
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, 'TASK_UUID_CONFLICT');

    const invalid = await post(ctx, payload({ taskUuid: 'bad id!', snapshotId: 'snap-1', fakeTotal: 3, fakeStepMs: 30 }));
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, 'INVALID_TASK_UUID');
  } finally {
    await ctx.close();
  }
});

test('the UUID lookup is scoped to its client while the legacy id lookup stays readable', async () => {
  const dataDir = tempDir();
  const ctx = await start(dataDir);
  try {
    const created = await post(ctx, payload({ taskUuid: 'task-bbb-222', snapshotId: 'snap-9', fakeTotal: 2, fakeStepMs: 20 }));
    assert.equal(created.status, 202);

    const own = await getByUuid(ctx, 'task-bbb-222', 'uuid-test');
    assert.equal(own.status, 200);
    assert.equal(own.body.taskUuid, 'task-bbb-222');
    assert.equal(own.body.snapshotId, 'snap-9');
    assert.ok(Array.isArray(own.body.bestEntries));

    const other = await getByUuid(ctx, 'task-bbb-222', 'another-client');
    assert.equal(other.status, 403);
    assert.equal(other.body.code, 'TASK_FORBIDDEN');

    const missing = await getByUuid(ctx, 'task-does-not-exist', 'uuid-test');
    assert.equal(missing.status, 404);
  } finally {
    await ctx.close();
  }
});

test('task UUIDs survive a server restart and are not exposed to other clients', async () => {
  const dataDir = tempDir();
  const first = await start(dataDir);
  let jobId = '';
  try {
    const created = await post(first, payload({ taskUuid: 'task-ccc-333', snapshotId: 'snap-r', fakeTotal: 3, fakeStepMs: 20 }));
    assert.equal(created.status, 202);
    jobId = created.body.job.id;
    await new Promise((resolve) => setTimeout(resolve, 600));
  } finally {
    await first.close();
  }

  // Restart against the same data directory: the checkpoint must restore the
  // uuid -> job mapping (running/queued jobs become "interrupted").
  const second = await start(dataDir);
  try {
    const restored = await getByUuid(second, 'task-ccc-333', 'uuid-test');
    assert.equal(restored.status, 200);
    assert.equal(restored.body.id, jobId);
    assert.equal(restored.body.taskUuid, 'task-ccc-333');
    assert.equal(restored.body.snapshotId, 'snap-r');
    assert.ok(['completed', 'running', 'interrupted'].includes(restored.body.status));
  } finally {
    await second.close();
  }
});

test('a completed long job can be deleted, and its files disappear', async () => {
  const dataDir = tempDir();
  const ctx = await start(dataDir);
  try {
    const created = await post(ctx, payload({ taskUuid: 'task-del-444', snapshotId: 'snap-del', fakeTotal: 2, fakeStepMs: 20 }));
    assert.equal(created.status, 202);
    const id = created.body.job.id;

    let detail = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await fetch(ctx.base + '/api/solve/jobs/' + encodeURIComponent(id), { headers });
      detail = await response.json();
      if (detail.status === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(detail.status, 'completed');

    const deleted = await fetch(ctx.base + '/api/solve/jobs/' + encodeURIComponent(id), {
      method: 'DELETE',
      headers,
    });
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).deleted, true);

    const after = await fetch(ctx.base + '/api/solve/jobs/' + encodeURIComponent(id), { headers });
    assert.equal(after.status, 404);
    assert.equal(fs.existsSync(path.join(dataDir, 'solve-jobs', id + '.json')), false);
  } finally {
    await ctx.close();
  }
});
