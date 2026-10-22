const test = require('node:test');
const assert = require('node:assert/strict');

async function loadAvailability() {
  return import('../packages/availability/src.ts');
}

test('batch block adds every teacher × slot pair exactly once', async () => {
  const { applyAvailability } = await loadAvailability();
  const current = [{ teacherId: 't1', slotId: 'p1' }];
  const result = applyAvailability(current, ['t1', 't2', 't3'], ['p1', 'p2'], 'block');
  assert.equal(result.added, 5);
  assert.equal(result.removed, 0);
  assert.equal(result.unchanged, 1);
  assert.equal(result.next.length, 6);
  const keys = result.next.map((entry) => entry.teacherId + '|' + entry.slotId);
  assert.equal(new Set(keys).size, keys.length);
});

test('applying the same batch twice is idempotent', async () => {
  const { applyAvailability } = await loadAvailability();
  const teachers = ['t1', 't2'];
  const slots = ['p1', 'p2'];
  const first = applyAvailability([], teachers, slots, 'block');
  const second = applyAvailability(first.next, teachers, slots, 'block');
  assert.equal(second.added, 0);
  assert.equal(second.removed, 0);
  assert.equal(second.unchanged, 4);
  assert.deepEqual(second.next, first.next);
});

test('batch unblock removes only the selected window', async () => {
  const { applyAvailability } = await loadAvailability();
  const current = [
    { teacherId: 't1', slotId: 'p1' },
    { teacherId: 't1', slotId: 'p2' },
    { teacherId: 't2', slotId: 'p1' },
    { teacherId: 't2', slotId: 'p2' },
    { teacherId: 't2', slotId: 'p3' },
  ];
  const result = applyAvailability(current, ['t1', 't2'], ['p1'], 'unblock');
  assert.equal(result.removed, 2);
  assert.equal(result.added, 0);
  assert.deepEqual(
    result.next.map((entry) => entry.teacherId + '|' + entry.slotId),
    ['t1|p2', 't2|p2', 't2|p3'],
  );
});

test('teachers and slots outside the selection are untouched', async () => {
  const { applyAvailability } = await loadAvailability();
  const current = [{ teacherId: 't9', slotId: 'p1' }, { teacherId: 't1', slotId: 'p9' }];
  const result = applyAvailability(current, ['t1'], ['p1'], 'unblock');
  assert.equal(result.removed, 0);
  assert.deepEqual(result.next, current);
});

test('empty selections are a no-op', async () => {
  const { applyAvailability } = await loadAvailability();
  const current = [{ teacherId: 't1', slotId: 'p1' }];
  for (const [teachers, slots] of [[[], ['p1']], [['t1'], []], [[], []]]) {
    const result = applyAvailability(current, teachers, slots, 'block');
    assert.equal(result.added, 0);
    assert.equal(result.removed, 0);
    assert.deepEqual(result.next, current);
  }
});
