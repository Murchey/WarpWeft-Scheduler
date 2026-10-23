const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const { startApi } = require('../server/api/api.cjs');

const fakeLongSolver = path.join(__dirname, 'fixtures', 'fake-long-solver.cjs');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warpweft-long-'));
}

async function start(dataDir, base) {
  const server = startApi({
    rootDir: base || path.resolve(__dirname, '..'),
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

const headers = { 'Content-Type': 'application/json', 'X-Client-Id': 'long-test' };

function payload(overrides = {}) {
  return {
    protocolVersion: '1.0',
    dataSnapshotVersion: 'long-test',
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

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJob(ctx, id, predicate, timeoutMs = 8000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const response = await fetch(`${ctx.base}/api/solve/jobs/${id}`, { headers });
    last = await response.json();
    if (predicate(last)) return last;
    await sleep(80);
  }
  throw new Error('timed out waiting for job state, last = ' + JSON.stringify(last));
}

test('long job runs, reports progress and persists a checkpoint', async () => {
  const dataDir = tempDir();
  const ctx = await start(dataDir);
  try {
    const response = await fetch(`${ctx.base}/api/solve/long`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload({ fakeTotal: 5, fakeStepMs: 40 })),
    });
    assert.equal(response.status, 202);
    const created = await response.json();
    assert.match(created.job.id, /^long-/);
    assert.equal(created.job.timeLimitSeconds, 600);

    const detail = await waitForJob(ctx, created.job.id, (job) => job.status === 'completed');
    assert.equal(detail.status, 'completed');
    assert.equal(detail.total, 5);
    assert.equal(detail.placed, 5);
    assert.equal(detail.unplaced, 0);
    assert.equal(detail.bestEntries.length, 5);
    assert.equal(detail.hasFeasibleSolution, true);

    // The checkpoint file is the source for the UI and for resume.
    const files = fs.readdirSync(path.join(dataDir, 'solve-jobs'));
    const jobFile = files.find((file) => file.startsWith(created.job.id) && file.endsWith('.json') && !file.includes('.best.'));
    const bestFile = files.find((file) => file.includes(created.job.id) && file.includes('.best.'));
    assert.ok(jobFile, 'job metadata is persisted');
    assert.ok(bestFile, 'best checkpoint is persisted');
    const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, 'solve-jobs', jobFile), 'utf8'));
    assert.equal(persisted.status, 'completed');
    assert.equal(persisted.input.coursePlans.length, 1);
  } finally {
    await ctx.close();
  }
});

test('paused job resumes from its checkpoint and only one long job runs at a time', async () => {
  const dataDir = tempDir();
  const ctx = await start(dataDir);
  try {
    const response = await fetch(`${ctx.base}/api/solve/long`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload({ fakeTotal: 30, fakeStepMs: 60, fakeHang: true })),
    });
    assert.equal(response.status, 202);
    const { job } = await response.json();

    const running = await waitForJob(ctx, job.id, (item) => item.placed >= 2);
    assert.equal(running.status, 'running');

    // A second long job must be refused while the first is alive.
    const second = await fetch(`${ctx.base}/api/solve/long`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload({ fakeTotal: 5 })),
    });
    assert.equal(second.status, 409);
    assert.equal((await second.json()).code, 'LONG_JOB_BUSY');

    const paused = await fetch(`${ctx.base}/api/solve/jobs/${job.id}/pause`, { method: 'POST', headers });
    assert.equal(paused.status, 200);
    const pausedJob = (await paused.json()).job;
    assert.equal(pausedJob.status, 'paused');
    const checkpointPlaced = pausedJob.placed;
    assert.ok(checkpointPlaced >= 2, 'pause keeps the best checkpoint');

    // Wait until the killed process is fully gone before resuming.
    await sleep(150);
    const resumed = await fetch(`${ctx.base}/api/solve/jobs/${job.id}/resume`, { method: 'POST', headers });
    assert.equal(resumed.status, 200);
    const finished = await waitForJob(ctx, job.id, (item) => item.status === 'completed');
    assert.equal(finished.status, 'completed');
    assert.ok(finished.placed >= checkpointPlaced);
    assert.ok(finished.rounds >= 2);
  } finally {
    await ctx.close();
  }
});

test('running jobs become resumable after a server restart', async () => {
  const dataDir = tempDir();
  const first = await start(dataDir);
  let jobId = null;
  try {
    const response = await fetch(`${first.base}/api/solve/long`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload({ fakeTotal: 30, fakeStepMs: 60, fakeHang: true })),
    });
    assert.equal(response.status, 202);
    jobId = (await response.json()).job.id;
    await waitForJob(first, jobId, (item) => item.placed >= 1);
  } finally {
    await first.close();
  }
  await sleep(150);

  const second = await start(dataDir);
  try {
    const list = await (await fetch(`${second.base}/api/solve/jobs`, { headers })).json();
    const job = list.jobs.find((item) => item.id === jobId);
    assert.ok(job, 'job survives the restart');
    assert.equal(job.status, 'interrupted');
    assert.equal(job.canResume, true);

    const resumed = await fetch(`${second.base}/api/solve/jobs/${jobId}/resume`, { method: 'POST', headers });
    assert.equal(resumed.status, 200);
    const finished = await waitForJob(second, jobId, (item) => item.status === 'completed');
    assert.equal(finished.status, 'completed');
  } finally {
    await second.close();
  }
});

test('cancel stops a running long job, and bad requests are rejected', async () => {
  const dataDir = tempDir();
  const ctx = await start(dataDir);
  try {
    const missing = await fetch(`${ctx.base}/api/solve/jobs/does-not-exist`, { headers });
    assert.equal(missing.status, 404);

    const invalid = await fetch(`${ctx.base}/api/solve/long`, { method: 'POST', headers, body: JSON.stringify({ coursePlans: [] }) });
    assert.equal(invalid.status, 400);

    const response = await fetch(`${ctx.base}/api/solve/long`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload({ fakeTotal: 30, fakeStepMs: 60, fakeHang: true })),
    });
    const job = (await response.json()).job;
    await waitForJob(ctx, job.id, (item) => item.placed >= 1);
    const cancelled = await fetch(`${ctx.base}/api/solve/jobs/${job.id}/cancel`, { method: 'POST', headers });
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).job.status, 'cancelled');
    const after = await (await fetch(`${ctx.base}/api/solve/jobs/${job.id}`, { headers })).json();
    assert.equal(after.status, 'cancelled');
  } finally {
    await ctx.close();
  }
});

