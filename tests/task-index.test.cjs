const test = require('node:test');
const assert = require('node:assert/strict');

async function loadTaskIndex() {
  return import('../apps/renderer/src/taskIndex.ts');
}

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    dump: () => data,
  };
}

test('task records round-trip and dedupe by uuid/job id', async () => {
  const { rememberTask, readTaskRecords } = await loadTaskIndex();
  const storage = memoryStorage();
  rememberTask(storage, { taskUuid: 'u1', jobId: 'j1', snapshotId: 's1', endpoint: 'http://a', submittedAt: 't1' });
  rememberTask(storage, { taskUuid: 'u2', jobId: 'j2', snapshotId: 's2', endpoint: 'http://a', submittedAt: 't2' });
  rememberTask(storage, { taskUuid: 'u1', jobId: 'j1', snapshotId: 's1', endpoint: 'http://a', submittedAt: 't3' });
  const records = readTaskRecords(storage);
  assert.equal(records.length, 2);
  assert.equal(records[0].taskUuid, 'u1');
  assert.equal(records[0].submittedAt, 't3');
});

test('latest task is scoped to the current server endpoint', async () => {
  const { rememberTask, latestTaskForEndpoint } = await loadTaskIndex();
  const storage = memoryStorage();
  rememberTask(storage, { taskUuid: 'a', jobId: 'ja', snapshotId: 's', endpoint: 'http://a', submittedAt: 't1' });
  rememberTask(storage, { taskUuid: 'b', jobId: 'jb', snapshotId: 's', endpoint: 'http://b', submittedAt: 't2' });
  assert.equal(latestTaskForEndpoint(storage, 'http://a').taskUuid, 'a');
  assert.equal(latestTaskForEndpoint(storage, 'http://b').taskUuid, 'b');
  assert.equal(latestTaskForEndpoint(storage, 'http://c'), null);
});

test('corrupt or oversized storage degrades safely', async () => {
  const { readTaskRecords, rememberTask } = await loadTaskIndex();
  const storage = memoryStorage();
  storage.setItem('warpweft-task-index-v1', '{not-json');
  assert.deepEqual(readTaskRecords(storage), []);
  for (let index = 0; index < 30; index += 1) {
    rememberTask(storage, {
      taskUuid: 'u' + index,
      jobId: 'j' + index,
      snapshotId: 's',
      endpoint: 'http://a',
      submittedAt: 't',
    });
  }
  assert.equal(readTaskRecords(storage).length, 20);
});

test('snapshot ids are stable and change when the input changes', async () => {
  const { snapshotIdOf } = await loadTaskIndex();
  const input = { coursePlans: [{ id: 'p1', weeklyPeriods: 2 }], timeSlots: [{ id: 's1' }] };
  assert.equal(snapshotIdOf(input), snapshotIdOf(JSON.parse(JSON.stringify(input))));
  assert.notEqual(snapshotIdOf(input), snapshotIdOf({ ...input, coursePlans: [{ id: 'p1', weeklyPeriods: 3 }] }));
  assert.match(snapshotIdOf(input), /^[0-9a-f]+-[0-9a-f]{8}$/);
});

test('generated task uuids are unique and url-safe', async () => {
  const { newTaskUuid } = await loadTaskIndex();
  const ids = new Set(Array.from({ length: 20 }, () => newTaskUuid()));
  assert.equal(ids.size, 20);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_.:-]{8,64}$/);
});
