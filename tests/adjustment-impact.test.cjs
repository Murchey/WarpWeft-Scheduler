const test = require('node:test');
const assert = require('node:assert/strict');

async function loadImpact() {
  return import('../apps/renderer/src/adjustmentImpact.ts');
}

function fixture() {
  const timeSlots = [
    { id: 's1', day: 1, period: 1, label: '周一 第1节' },
    { id: 's2', day: 1, period: 2, label: '周一 第2节' },
  ];
  const entries = [
    { id: 'e1', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 's1', source: 'AUTO', locked: false },
    { id: 'e2', coursePlanId: 'p2', classId: 'c2', teacherId: 't2', roomId: 'r2', slotId: 's2', source: 'AUTO', locked: false },
  ];
  const data = {
    school: { id: 's', name: '测试' },
    classes: [{ id: 'c1', name: '一班', size: 40, grade: '1' }, { id: 'c2', name: '二班', size: 40, grade: '1' }],
    teachers: [{ id: 't1', name: '甲老师' }, { id: 't2', name: '乙老师' }],
    subjects: [{ id: 'sub1', name: '语文' }, { id: 'sub2', name: '数学' }],
    rooms: [{ id: 'r1', name: '一号', capacity: 40, type: '普通教室' }, { id: 'r2', name: '二号', capacity: 40, type: '普通教室' }],
    timeSlots,
    coursePlans: [
      { id: 'p1', classId: 'c1', subjectId: 'sub1', teacherId: 't1', weeklyPeriods: 1 },
      { id: 'p2', classId: 'c2', subjectId: 'sub2', teacherId: 't2', weeklyPeriods: 1 },
    ],
    entries,
    adjustments: [],
  };
  return { data, entries };
}

function adjustment(overrides) {
  return {
    id: 'a1',
    date: '2026-10-19',
    type: 'move',
    slotId: 's1',
    classId: 'c1',
    originalEntryId: 'e1',
    createdAt: '2026-10-18T00:00:00.000Z',
    status: 'active',
    ...overrides,
  };
}

test('move impact shows class and teacher source/target changes', async () => {
  const { buildAdjustmentImpact } = await loadImpact();
  const { data, entries } = fixture();
  const move = adjustment({ targetSlotId: 's2' });
  const impact = buildAdjustmentImpact(data, '2026-10-19', [], [move], entries);
  assert.ok(impact);
  assert.equal(impact.classId, 'c1');
  assert.ok(impact.teacherIds.includes('t1'));
  assert.equal(impact.changes.some((change) => change.action === 'moved'), true);
  assert.equal(impact.classBefore.find((entry) => entry.id === 'e1').slotId, 's1');
  assert.equal(impact.classAfter.find((entry) => entry.id === 'e1').slotId, 's2');
});

test('substitute and cancel impacts identify the affected teacher', async () => {
  const { buildAdjustmentImpact } = await loadImpact();
  const { data, entries } = fixture();
  const substitute = adjustment({ type: 'substitute', substituteTeacherId: 't2' });
  const substituteImpact = buildAdjustmentImpact(data, '2026-10-19', [], [substitute], entries);
  assert.ok(substituteImpact);
  assert.ok(substituteImpact.teacherIds.includes('t1'));
  assert.ok(substituteImpact.teacherIds.includes('t2'));
  assert.equal(substituteImpact.changes.some((change) => change.action === 'substituted'), true);

  const cancel = adjustment({ type: 'cancel' });
  const cancelImpact = buildAdjustmentImpact(data, '2026-10-19', [], [cancel], entries);
  assert.ok(cancelImpact);
  assert.equal(cancelImpact.changes.some((change) => change.action === 'removed'), true);
  assert.equal(cancelImpact.classAfter.some((entry) => entry.id === 'e1'), false);
});
