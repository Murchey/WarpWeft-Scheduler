const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const { startApi } = require('../server/api/api.cjs');

const fakeSolver = path.join(__dirname, 'fixtures', 'fake-solver.cjs');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warpweft-limits-'));
}

async function start(overrides = {}) {
  const dataDir = tempDir();
  const server = startApi({
    rootDir: path.resolve(__dirname, '..'),
    dataDir,
    port: 0,
    packaged: false,
    solverCommand: process.execPath,
    solverArgs: [fakeSolver],
    configFile: path.join(dataDir, 'server-config.json'),
    ...overrides,
  });
  await once(server, 'listening');
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  return {
    server,
    base,
    dataDir,
    close: async () => {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function headers(clientId) {
  return { 'Content-Type': 'application/json', 'X-Client-Id': clientId };
}

async function configure(ctx, patch, clientId = 'admin-local') {
  const response = await fetch(`${ctx.base}/api/server/config`, {
    method: 'PUT',
    headers: headers(clientId),
    body: JSON.stringify(patch),
  });
  return { status: response.status, body: await response.json() };
}

async function overview(ctx, clientId = 'admin-local') {
  const response = await fetch(`${ctx.base}/api/server/overview`, { headers: headers(clientId) });
  return { status: response.status, body: await response.json() };
}

function solve(ctx, clientId, extra = {}) {
  return fetch(`${ctx.base}/api/solve`, {
    method: 'POST',
    headers: headers(clientId),
    body: JSON.stringify({
      protocolVersion: '1.0',
      coursePlans: [{ weeklyPeriods: 4 }],
      classes: [{ id: 'c1' }],
      fakeSolveMs: 300,
      timeLimitSeconds: 10,
      ...extra,
    }),
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last) return last;
    await wait(50);
  }
  throw new Error('waitFor 超时：' + JSON.stringify(last));
}

test('runs up to maxConcurrentJobs at once and queues the rest', async () => {
  const ctx = await start();
  try {
    const configured = await configure(ctx, {
      maxConcurrentJobs: 2,
      perClientActive: 2,
      perClientQueued: 10,
      queueCapacity: 10,
    });
    assert.equal(configured.status, 200, JSON.stringify(configured.body));
    assert.equal(configured.body.effective.maxConcurrentJobs, 2);

    const running = [solve(ctx, 'pc-a', { fakeSolveMs: 3000 }), solve(ctx, 'pc-a', { fakeSolveMs: 3000 })];
    const mid = await waitFor(async () => {
      const snapshot = await overview(ctx);
      return snapshot.body.stats.queue.running === 2 ? snapshot : null;
    });
    assert.equal(mid.body.stats.queue.running, 2, JSON.stringify(mid.body.stats.queue));
    assert.equal(mid.body.stats.queue.concurrency, 2);

    const queued = [solve(ctx, 'pc-b', { fakeSolveMs: 200 }), solve(ctx, 'pc-b', { fakeSolveMs: 200 })];
    const withQueue = await waitFor(async () => {
      const snapshot = await overview(ctx);
      return snapshot.body.stats.queue.queued === 2 ? snapshot : null;
    });
    assert.equal(withQueue.body.stats.queue.running, 2);
    assert.equal(withQueue.body.stats.queue.queued, 2);

    const results = await Promise.all([...running, ...queued]);
    for (const response of results) assert.equal(response.status, 200);
    const done = await overview(ctx);
    assert.equal(done.body.stats.queue.running, 0);
    assert.equal(done.body.stats.queue.queued, 0);
    assert.ok(done.body.stats.queue.completed >= 4);
  } finally {
    await ctx.close();
  }
});

test('rejects with QUEUE_FULL when the global queue is full', async () => {
  const ctx = await start();
  try {
    await configure(ctx, {
      maxConcurrentJobs: 1,
      perClientActive: 1,
      perClientQueued: 5,
      queueCapacity: 4,
    });
    const first = solve(ctx, 'pc-a', { fakeSolveMs: 2500 });
    await waitFor(async () => {
      const snapshot = await overview(ctx);
      return snapshot.body.stats.queue.running === 1 ? snapshot : null;
    });
    const queued = [0, 1, 2, 3].map(() => solve(ctx, 'pc-a', { fakeSolveMs: 2500 }));
    await waitFor(async () => {
      const snapshot = await overview(ctx);
      return snapshot.body.stats.queue.queued === 4 ? snapshot : null;
    });
    const rejected = await solve(ctx, 'pc-b', { fakeSolveMs: 100 });
    assert.equal(rejected.status, 503);
    const body = await rejected.json();
    assert.equal(body.code, 'QUEUE_FULL');
    assert.equal(rejected.headers.get('retry-after'), '15');

    await Promise.all([first, ...queued]);
  } finally {
    await ctx.close();
  }
});
test('limits connected computers and frees the slot after TTL', async () => {
  const ctx = await start({ clientTtlMs: 250 });
  try {
    await configure(ctx, { maxClients: 3 });
    const a = await fetch(`${ctx.base}/api/server/clients`, { headers: headers('pc-alpha') });
    const b = await fetch(`${ctx.base}/api/server/clients`, { headers: headers('pc-bravo') });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);

    const c = await fetch(`${ctx.base}/api/server/clients`, { headers: headers('pc-charlie') });
    assert.equal(c.status, 429);
    const limited = await c.json();
    assert.equal(limited.code, 'CLIENT_LIMIT');
    assert.equal(limited.maxClients, 3);

    await wait(600);
    const retry = await fetch(`${ctx.base}/api/server/clients`, { headers: headers('pc-charlie') });
    assert.equal(retry.status, 200);
  } finally {
    await ctx.close();
  }
});

test('per-client allowance stops one computer from flooding the queue', async () => {
  const ctx = await start();
  try {
    await configure(ctx, {
      maxConcurrentJobs: 1,
      perClientActive: 1,
      perClientQueued: 1,
      queueCapacity: 10,
    });
    const first = solve(ctx, 'pc-a', { fakeSolveMs: 800 });
    await waitFor(async () => {
      const snapshot = await overview(ctx);
      return snapshot.body.stats.queue.running === 1 ? snapshot : null;
    });
    const second = solve(ctx, 'pc-a', { fakeSolveMs: 200 });
    await waitFor(async () => {
      const snapshot = await overview(ctx);
      return snapshot.body.stats.queue.queued === 1 ? snapshot : null;
    });
    const third = await solve(ctx, 'pc-a', { fakeSolveMs: 100 });
    assert.equal(third.status, 429);
    const body = await third.json();
    assert.equal(body.code, 'CLIENT_QUEUE_FULL');
    await Promise.all([first, second]);
  } finally {
    await ctx.close();
  }
});

test('cancelling a running job frees its slot and marks it cancelled', async () => {
  const ctx = await start();
  try {
    await configure(ctx, { maxConcurrentJobs: 1, queueCapacity: 4 });
    const running = solve(ctx, 'pc-a', { fakeSolveMs: 5000 });
    const before = await waitFor(async () => {
      const snapshot = await overview(ctx);
      return snapshot.body.stats.queue.running === 1 ? snapshot : null;
    });
    const jobId = before.body.jobs.find((job) => job.status === 'running').id;

    const cancelled = await fetch(`${ctx.base}/api/server/jobs/${jobId}/cancel`, {
      method: 'POST',
      headers: headers('pc-a'),
    });
    assert.equal(cancelled.status, 200);
    const response = await running;
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, 'JOB_CANCELLED');

    await wait(300);
    const after = await overview(ctx);
    assert.equal(after.body.stats.queue.running, 0);
    assert.ok(after.body.jobs.some((job) => job.id === jobId && job.status === 'cancelled'));
  } finally {
    await ctx.close();
  }
});

test('kills a job that exceeds the configured timeout', async () => {
  const ctx = await start({ timeoutSecondsOverride: 0.3 });
  try {
    await configure(ctx, { maxConcurrentJobs: 1 });
    const response = await solve(ctx, 'pc-a', { fakeSolveMs: 3000 });
    assert.equal(response.status, 504);
    const body = await response.json();
    assert.equal(body.code, 'TIMEOUT');
    const after = await overview(ctx);
    assert.equal(after.body.stats.queue.running, 0);
    assert.ok(after.body.jobs.some((job) => job.status === 'timeout'));
  } finally {
    await ctx.close();
  }
});

test('config endpoint validates, clamps and reports effective limits', async () => {
  const ctx = await start();
  try {
    const bad = await configure(ctx, { maxClients: 99, maxConcurrentJobs: 0, allowedCidrs: ['nonsense'] });
    assert.equal(bad.status, 200);
    assert.ok(bad.body.warnings.length >= 2);
    assert.equal(bad.body.config.maxClients, 8);
    assert.deepEqual(bad.body.config.allowedCidrs, []);

    const good = await configure(ctx, { maxConcurrentJobs: 3, queueCapacity: 40, allowedCidrs: ['192.168.1.0/24'] });
    assert.equal(good.status, 200);
    assert.equal(good.body.config.queueCapacity, 40);
    assert.deepEqual(good.body.config.allowedCidrs, ['192.168.1.0/24']);
    assert.ok(good.body.effective.maxConcurrentJobs <= 3);

    const stored = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'server-config.json'), 'utf8'));
    assert.equal(stored.queueCapacity, 40);
  } finally {
    await ctx.close();
  }
});

test('overview stays responsive while jobs are running', async () => {
  const ctx = await start();
  try {
    await configure(ctx, { maxConcurrentJobs: 2, perClientActive: 2, perClientQueued: 4, queueCapacity: 8 });
    const jobs = [0, 1, 2, 3].map(() => solve(ctx, 'pc-a', { fakeSolveMs: 400 }));
    await wait(100);
    const samples = [];
    for (let index = 0; index < 12; index++) {
      const started = Date.now();
      const response = await fetch(`${ctx.base}/api/server/overview`, { headers: headers('pc-monitor') });
      assert.equal(response.status, 200);
      await response.json();
      samples.push(Date.now() - started);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95) - 1];
    assert.ok(p95 < 500, 'overview p95=' + p95 + 'ms');
    await Promise.all(jobs);
  } finally {
    await ctx.close();
  }
});

test('static pages do not consume client slots', async () => {
  const ctx = await start();
  try {
    await configure(ctx, { maxClients: 1 });
    // The admin client already holds the only slot; a plain page load must not
    // be rejected and must not register another computer.
    const page = await fetch(`${ctx.base}/`);
    assert.notEqual(page.status, 429);
    const clients = await fetch(`${ctx.base}/api/server/clients`, { headers: headers('admin-local') }).then((response) => response.json());
    assert.equal(clients.clients.length, 1);
    const other = await fetch(`${ctx.base}/api/server/overview`, { headers: headers('pc-other') });
    assert.equal(other.status, 429);
  } finally {
    await ctx.close();
  }
});
test('switching the bind address keeps the same port and stays reachable', async () => {
  const ctx = await start();
  try {
    const initial = await fetch(`${ctx.base}/api/health`, { headers: headers('admin-local') });
    assert.equal(initial.status, 200);

    const updated = await configure(ctx, { bindAddress: 'lan' });
    assert.equal(updated.status, 200);

    const after = await waitFor(async () => {
      try {
        const response = await fetch(`${ctx.base}/api/health`, { headers: headers('admin-local') });
        if (response.status !== 200) return null;
        const body = await response.json();
        return body.server.host === '0.0.0.0' ? body : null;
      } catch {
        return null;
      }
    });
    assert.equal(after.server.host, '0.0.0.0');

    await configure(ctx, { bindAddress: 'loopback' });
    const back = await waitFor(async () => {
      try {
        const response = await fetch(`${ctx.base}/api/health`, { headers: headers('admin-local') });
        if (response.status !== 200) return null;
        const body = await response.json();
        return body.server.host === '127.0.0.1' ? body : null;
      } catch {
        return null;
      }
    });
    assert.equal(back.server.host, '127.0.0.1');
  } finally {
    await ctx.close();
  }
});