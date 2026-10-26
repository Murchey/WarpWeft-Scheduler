const test = require('node:test');
const assert = require('node:assert/strict');

test('import review reports added, changed, removed and unchanged rows by collection', async () => {
  const { importChanges } = await import('../apps/renderer/src/importReview.ts');
  const base = {
    school: { id: 's', name: '旧学校' }, classes: [{ id: 'c1', name: '一班' }, { id: 'c2', name: '二班' }],
    teachers: [], subjects: [], rooms: [], timeSlots: [], coursePlans: [], rules: [], unavailableSlots: [], adjustments: [], lessonLogs: [],
  };
  const next = {
    ...base,
    school: { id: 's', name: '新学校' },
    classes: [{ id: 'c1', name: '一班（改名）' }, { id: 'c3', name: '三班' }],
  };
  const row = importChanges(base, next).find((item) => item.key === 'classes');
  assert.deepEqual(row && { added: row.added, changed: row.changed, removed: row.removed, unchanged: row.unchanged }, {
    added: 1, changed: 1, removed: 1, unchanged: 0,
  });
});
