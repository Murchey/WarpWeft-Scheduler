const test = require('node:test');
const assert = require('node:assert/strict');

async function load() {
  return import('../packages/adjustments/src.ts');
}

// 2026-10-21 is Wednesday (day 3); 2026-10-22 is Thursday (day 4).
const WED = '2026-10-21';
const THU = '2026-10-22';

function fixture() {
  return {
    timeSlots: [
      { id: 'wed-1', day: 3, period: 1, label: '周三 第1节' },
      { id: 'wed-2', day: 3, period: 2, label: '周三 第2节' },
      { id: 'wed-3', day: 3, period: 3, label: '周三 第3节' },
      { id: 'thu-1', day: 4, period: 1, label: '周四 第1节' },
    ],
    classes: [
      { id: 'c1', name: '一班' },
      { id: 'c2', name: '二班' },
    ],
    teachers: [
      { id: 't1', name: '甲老师' },
      { id: 't2', name: '乙老师' },
    ],
    rooms: [
      { id: 'r1', name: '一号教室' },
      { id: 'r2', name: '二号教室' },
    ],
    coursePlans: [
      { id: 'p1', classId: 'c1', subjectId: 's1', teacherId: 't1' },
      { id: 'p2', classId: 'c1', subjectId: 's2', teacherId: 't2' },
      { id: 'p3', classId: 'c2', subjectId: 's1', teacherId: 't1' },
      { id: 'p4', classId: 'c2', subjectId: 's2', teacherId: 't2' },
    ],
    entries: [
      { id: 'e1', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'wed-1', source: 'AUTO', locked: false },
      { id: 'e2', coursePlanId: 'p2', classId: 'c1', teacherId: 't2', roomId: 'r1', slotId: 'wed-2', source: 'AUTO', locked: false },
      { id: 'e3', coursePlanId: 'p3', classId: 'c2', teacherId: 't1', roomId: 'r2', slotId: 'wed-2', source: 'AUTO', locked: false },
      { id: 'e4', coursePlanId: 'p4', classId: 'c2', teacherId: 't2', roomId: 'r2', slotId: 'thu-1', source: 'AUTO', locked: false },
      { id: 'e5', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'thu-1', source: 'AUTO', locked: false },
    ],
    unavailableSlots: [],
    adjustments: [],
  };
}

function swap(overrides = {}) {
  return {
    id: 'a-swap',
    date: WED,
    type: 'swap',
    classId: 'c1',
    slotId: 'wed-1',
    originalEntryId: 'e1',
    targetDate: THU,
    targetSlotId: 'thu-1',
    targetEntryId: 'e5',
    createdAt: '2026-10-20T08:00:00.000Z',
    status: 'active',
    ...overrides,
  };
}

test('cross-date swap moves both lessons and leaves no duplicate', async () => {
  const { effectiveEntries, activeAdjustmentOf } = await load();
  const data = fixture();
  data.adjustments = [swap()];

  const wed = effectiveEntries(data, WED);
  assert.ok(!wed.some((entry) => entry.id === 'e1'));
  assert.equal(wed.find((entry) => entry.id === 'e5')?.slotId, 'wed-1');
  assert.equal(wed.find((entry) => entry.id === 'e5')?.roomId, 'r1');
  assert.equal(wed.filter((entry) => entry.slotId === 'wed-1').length, 1);

  const thu = effectiveEntries(data, THU);
  assert.ok(!thu.some((entry) => entry.id === 'e5'));
  assert.equal(thu.find((entry) => entry.id === 'e1')?.slotId, 'thu-1');
  assert.equal(thu.find((entry) => entry.id === 'e1')?.roomId, 'r1');
  assert.equal(thu.filter((entry) => entry.slotId === 'thu-1' && entry.classId === 'c1').length, 1);

  assert.equal(activeAdjustmentOf(data.adjustments, WED, 'e1')?.id, 'a-swap');
  assert.equal(activeAdjustmentOf(data.adjustments, THU, 'e5')?.id, 'a-swap');
});

test('planSwap accepts a free same-class future lesson and explains blockers', async () => {
  const { planSwap } = await load();
  const data = fixture();
  const ok = planSwap(data, { date: WED, originalEntryId: 'e1', targetDate: THU, targetEntryId: 'e5' });
  assert.equal(ok.kind, 'apply');
  assert.deepEqual(ok.blockers, []);

  const otherClass = planSwap(data, { date: WED, originalEntryId: 'e1', targetDate: THU, targetEntryId: 'e4' });
  assert.equal(otherClass.kind, 'blocked');
  assert.ok(otherClass.blockers.some((blocker) => blocker.code === 'class-mismatch'));

  const sameDate = planSwap(data, { date: WED, originalEntryId: 'e1', targetDate: WED, targetEntryId: 'e2' });
  assert.equal(sameDate.kind, 'blocked');
  assert.ok(sameDate.blockers.some((blocker) => blocker.code === 'target-date'));

  const sameWeekday = planSwap(data, { date: WED, originalEntryId: 'e1', targetDate: '2026-10-28', targetEntryId: 'e2' });
  assert.equal(sameWeekday.kind, 'blocked');
  assert.ok(sameWeekday.blockers.some((blocker) => blocker.text.includes('同星期')));

  data.entries.push({ id: 'e6', coursePlanId: 'p3', classId: 'c2', teacherId: 't1', roomId: 'r2', slotId: 'thu-1', source: 'AUTO', locked: false });
  const busy = planSwap(data, { date: WED, originalEntryId: 'e1', targetDate: THU, targetEntryId: 'e5' });
  assert.equal(busy.kind, 'blocked');
  assert.ok(busy.blockers.some((blocker) => blocker.code === 'teacher-busy'));
});

test('validateAdjustment accepts a swap and rejects an already adjusted lesson', async () => {
  const { validateAdjustment } = await load();
  const data = fixture();
  const draft = { date: WED, type: 'swap', originalEntryId: 'e1', targetDate: THU, targetEntryId: 'e5' };
  assert.equal(validateAdjustment(data, draft).ok, true);

  data.adjustments = [swap()];
  const again = validateAdjustment(data, draft);
  assert.equal(again.ok, false);
  assert.ok(again.errors.some((error) => error.includes('已有')));
});

test('day logs and stats include the incoming swap lesson on both dates', async () => {
  const { buildDayLogs } = await load();
  const data = fixture();
  data.adjustments = [swap()];

  const wed = buildDayLogs(data, WED);
  assert.ok(!wed.some((log) => log.entryId === 'e1'));
  const incoming = wed.find((log) => log.entryId === 'e5');
  assert.equal(incoming.status, 'moved');
  assert.equal(incoming.slotId, 'wed-1');
  assert.equal(incoming.adjustmentId, 'a-swap');

  const thu = buildDayLogs(data, THU);
  assert.ok(!thu.some((log) => log.entryId === 'e5'));
  const returned = thu.find((log) => log.entryId === 'e1');
  assert.equal(returned.status, 'moved');
  assert.equal(returned.slotId, 'thu-1');
});

test('adjustment impact sees both sides of the swap', async () => {
  const { buildAdjustmentImpact } = await import('../apps/renderer/src/adjustmentImpact.ts');
  const data = fixture();
  const record = swap();
  const impact = buildAdjustmentImpact(data, WED, [], [record], data.entries);
  assert.ok(impact);
  assert.equal(impact.type, 'swap');
  assert.equal(impact.classId, 'c1');
  assert.ok(impact.changes.some((change) => change.entryId === 'e1' && change.action === 'removed'));
  assert.ok(impact.changes.some((change) => change.entryId === 'e5' && change.action === 'added'));
  assert.ok(impact.teacherIds.includes('t1'));
});

test('swap summary and description expose both dates', async () => {
  const { summarizeAdjustments, describeAdjustment, ADJUSTMENT_LABELS } = await load();
  const data = fixture();
  const record = swap();
  const summary = summarizeAdjustments([record]);
  assert.equal(summary.swap, 1);
  assert.equal(ADJUSTMENT_LABELS.swap, '对调');
  const text = describeAdjustment(record, data);
  assert.ok(text.includes('周三 第1节'));
  assert.ok(text.includes(THU));
  assert.ok(text.includes('周四 第1节'));
});
