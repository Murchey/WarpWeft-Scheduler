#!/usr/bin/env node
// LAN load smoke test: fire N clients x M solve requests and print what the
// server did with them. Requires a running server and a built Java solver.
//
//   node scripts/load-lan.cjs --base http://192.168.1.20:4317 --clients 4 --jobs 2
//
// It only reads the seed data and posts solver inputs; it never writes /api/data.

const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : 'true';
    result[key] = value;
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
const base = String(args.base || 'http://127.0.0.1:4317').replace(/\/+$/, '');
const clients = Math.max(1, Number(args.clients) || 2);
const jobsPerClient = Math.max(1, Number(args.jobs) || 1);
const timeLimit = Math.max(5, Number(args['time-limit']) || 15);

const seedPath = path.join(__dirname, '..', 'database', 'seeds', 'demo.json');
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
const payload = {
  ...seed,
  protocolVersion: '1.0',
  dataSnapshotVersion: 'load-' + Date.now(),
  hardConstraints: [],
  softConstraints: [],
  unavailableSlots: [],
  lockedEntries: [],
  rules: [],
  timeLimitSeconds: timeLimit,
  randomSeed: 1,
};

const headers = (clientId) => ({ 'Content-Type': 'application/json', 'X-Client-Id': clientId });

async function stats() {
  const response = await fetch(base + '/api/server/stats', { headers: headers('load-monitor') });
  if (!response.ok) throw new Error('stats HTTP ' + response.status);
  return response.json();
}

async function solve(clientId, index) {
  const started = Date.now();
  const response = await fetch(base + '/api/solve', {
    method: 'POST',
    headers: headers(clientId),
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let code = '';
  try {
    code = JSON.parse(text).code || '';
  } catch {
    // ignore
  }
  return {
    clientId,
    index,
    status: response.status,
    code,
    elapsedMs: Date.now() - started,
    bytes: text.length,
  };
}

(async () => {
  console.log(`目标 ${base}：${clients} 台客户端 × ${jobsPerClient} 个任务（时限 ${timeLimit}s）`);
  const before = await stats();
  console.log('限额：', before.limits, '有效并发：', before.effective.maxConcurrentJobs);

  const started = Date.now();
  const tasks = [];
  for (let client = 1; client <= clients; client += 1) {
    for (let job = 1; job <= jobsPerClient; job += 1) {
      tasks.push(solve('load-' + client, job));
    }
  }

  const sampler = setInterval(async () => {
    try {
      const snapshot = await stats();
      const queue = snapshot.queue;
      console.log(`  running=${queue.running}/${queue.concurrency} queued=${queue.queued}/${queue.capacity} clients=${snapshot.clients.active}/${snapshot.clients.max}`);
    } catch {
      // ignore transient failures while the queue is busy
    }
  }, 1000);

  const results = await Promise.all(tasks);
  clearInterval(sampler);
  const total = Date.now() - started;

  console.log('\n结果：');
  for (const item of results) {
    console.log(
      `  ${item.clientId} #${item.index}  HTTP ${item.status}${item.code ? ' [' + item.code + ']' : ''}  ${item.elapsedMs}ms  ${item.bytes}B`,
    );
  }
  const ok = results.filter((item) => item.status === 200).length;
  const rejected = results.filter((item) => item.status === 429 || item.status === 503).length;
  console.log(`\n成功 ${ok} · 被限额拒绝 ${rejected} · 总耗时 ${total}ms`);
  const after = await stats();
  console.log('队列：', after.queue);
  console.log('客户端：', after.clients);
  console.log('提示：被 429/503 拒绝说明准入控制生效；若全部成功且墙钟时间接近任务数 × 单任务耗时，说明并发没有生效。');
})().catch((error) => {
  console.error('压测失败：', error.message);
  process.exit(1);
});
