const test = require('node:test');
const assert = require('node:assert/strict');

async function loadAdjustments() {
  return import('../packages/adjustments/src.ts');
}

// 2026-10-21 is a Wednesday (timetable day 3).
const DATE = '2026-10-21';

function baseData() {
  return {
    timeSlots: [
      { id: 'wed-1', day: 3, period: 1, label: '周三 第1节' },
      { id: 'wed-2', day: 3, period: 2, label: '周三 第2节' },
      { id: 'thu-1', day: 4, period: 1, label: '周四 第1节' },
    ],
    classes: [
      { id: 'c1', name: '一班' },
      { id: 'c2', name: '二班' },
    ],
    teachers: [
      { id: 't1', name: '甲老师' },
      { id: 't2', name: '乙老师' },
      { id: 't3', name: '丙老师' },
    ],
    unavailableSlots: [{ teacherId: 't3', slotId: 'wed-2' }],
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
    ],
    adjustments: [],
  };
}

function adjustment(overrides) {
  return {
    id: 'a1',
    date: DATE,
    type: 'move',
    slotId: 'wed-1',
    classId: 'c1',
    originalEntryId: 'e1',
    createdAt: '2026-10-20T08:00:00.000Z',
    status: 'active',
    ...overrides,
  };
}

test('weekdayOf maps calendar dates to timetable day numbers', async () => {
  const { weekdayOf } = await loadAdjustments();
  assert.equal(weekdayOf('2026-10-21'), 3);
  assert.equal(weekdayOf('2026-10-25'), 7);
  assert.equal(weekdayOf('2026-10-19'), 1);
  assert.equal(weekdayOf('not-a-date'), 0);
});

test('effectiveEntries applies move, substitute and cancel for one date only', async () => {
  const { effectiveEntries } = await loadAdjustments();
  const data = baseData();
  data.adjustments = [
    adjustment({ id: 'a-move', type: 'move', originalEntryId: 'e1', targetSlotId: 'wed-2' }),
    adjustment({ id: 'a-sub', type: 'substitute', originalEntryId: 'e2', substituteTeacherId: 't3', slotId: 'wed-2' }),
    adjustment({ id: 'a-cancel', type: 'cancel', originalEntryId: 'e3', slotId: 'wed-2' }),
  ];
  // The base timetable still says e1 is on wed-1, e3 exists.
  assert.equal(data.entries.find((entry) => entry.id === 'e1').slotId, 'wed-1');
  assert.ok(data.entries.some((entry) => entry.id === 'e3'));

  const effective = effectiveEntries(data, DATE);
  assert.equal(effective.length, 2);
  const moved = effective.find((entry) => entry.id === 'e1');
  assert.equal(moved.slotId, 'wed-2');
  const substituted = effective.find((entry) => entry.id === 'e2');
  assert.equal(substituted.teacherId, 't3');
  assert.ok(!effective.some((entry) => entry.id === 'e3'));

  // Another date is untouched.
  assert.equal(effectiveEntries(data, '2026-10-22').length, 1);
});

test('revoked adjustments no longer affect the day', async () => {
  const { effectiveEntries } = await loadAdjustments();
  const data = baseData();
  data.adjustments = [adjustment({ type: 'cancel', originalEntryId: 'e1', status: 'revoked' })];
  const effective = effectiveEntries(data, DATE);
  assert.equal(effective.length, 3);
});

test('move is blocked when the target slot is taken by the class', async () => {
  const { validateAdjustment } = await loadAdjustments();
  const data = baseData();
  // 一班 already has e2 at wed-2.
  const result = validateAdjustment(data, { date: DATE, type: 'move', originalEntryId: 'e1', targetSlotId: 'wed-2' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('一班 在该时段已有课程')));
});

test('move is blocked by a teacher conflict at the target slot', async () => {
  const { validateAdjustment } = await loadAdjustments();
  const data = baseData();
  // 甲老师 also teaches 二班 at wed-2.
  const result = validateAdjustment(data, { date: DATE, type: 'move', originalEntryId: 'e1', targetSlotId: 'wed-2' });
  assert.ok(result.errors.some((error) => error.includes('甲老师 在该时段已有课程')));
});

test('move to a free slot succeeds and rejects other days', async () => {
  const { validateAdjustment } = await loadAdjustments();
  const data = baseData();
  const free = validateAdjustment(data, { date: DATE, type: 'move', originalEntryId: 'e1', targetSlotId: 'wed-2' });
  assert.equal(free.ok, false);

  // Remove the blockers from wed-2 to make the target free.
  data.entries = data.entries.filter((entry) => entry.slotId !== 'wed-2');
  const ok = validateAdjustment(data, { date: DATE, type: 'move', originalEntryId: 'e1', targetSlotId: 'wed-2' });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));

  const otherDay = validateAdjustment(data, { date: DATE, type: 'move', originalEntryId: 'e1', targetSlotId: 'thu-1' });
  assert.equal(otherDay.ok, false);
  assert.ok(otherDay.errors.some((error) => error.includes('同一天')));
});

test('substitute respects availability and double booking', async () => {
  const { validateAdjustment, substituteCandidates } = await loadAdjustments();
  const data = baseData();
  // 丙老师 is unavailable at wed-2 and therefore cannot take e2's lesson.
  const unavailable = validateAdjustment(data, { date: DATE, type: 'substitute', originalEntryId: 'e2', substituteTeacherId: 't3' });
  assert.equal(unavailable.ok, false);
  assert.ok(unavailable.errors.some((error) => error.includes('不可用')));

  // 甲老师 is already teaching 二班 at wed-2.
  const busy = validateAdjustment(data, { date: DATE, type: 'substitute', originalEntryId: 'e2', substituteTeacherId: 't1' });
  assert.ok(busy.errors.some((error) => error.includes('甲老师 在该时段已有课程')));

  const same = validateAdjustment(data, { date: DATE, type: 'substitute', originalEntryId: 'e2', substituteTeacherId: 't2' });
  assert.ok(same.errors.some((error) => error.includes('不能是原任课教师')));

  const candidates = substituteCandidates(data, DATE, 'e2');
  assert.equal(candidates.find((item) => item.id === 't1').unavailable, true);
  assert.equal(candidates.find((item) => item.id === 't3').unavailable, true);
  assert.equal(candidates.find((item) => item.id === 't2').unavailable, true);
});

test('one adjustment per lesson per day', async () => {
  const { validateAdjustment } = await loadAdjustments();
  const data = baseData();
  data.adjustments = [adjustment({ id: 'a-existing', type: 'cancel', originalEntryId: 'e1' })];
  const result = validateAdjustment(data, { date: DATE, type: 'substitute', originalEntryId: 'e1', substituteTeacherId: 't3' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('当天已有调整')));
});

test('clock helpers find the current slot', async () => {
  const { parseClock, slotWindow, currentSlot, formatClock, minutesOfDay } = await loadAdjustments();
  assert.equal(parseClock('08:05'), 485);
  assert.equal(parseClock('8:05'), 485);
  assert.equal(parseClock('25:00'), null);
  assert.equal(parseClock(''), null);
  assert.equal(formatClock(485), '08:05');
  assert.equal(minutesOfDay(new Date(2026, 9, 22, 9, 30)), 570);

  const slots = [
    { id: 'morning', day: 3, period: 0, label: '早读', start: '07:40', duration: 20 },
    { id: 'p1', day: 3, period: 1, label: '第1节', start: '08:00', duration: 45 },
    { id: 'p2', day: 3, period: 2, label: '第2节', start: '08:55', duration: 45 },
    { id: 'evening', day: 3, period: 9, label: '晚自习', start: '19:00', duration: 60 },
  ];
  assert.deepEqual(slotWindow(slots[0]), { start: 460, end: 480 });
  assert.equal(currentSlot(slots, 3, 465)?.id, 'morning');
  assert.equal(currentSlot(slots, 3, 500)?.id, 'p1');
  assert.equal(currentSlot(slots, 3, 540)?.id, 'p2');
  assert.equal(currentSlot(slots, 3, 1150)?.id, 'evening');
  assert.equal(currentSlot(slots, 3, 700), null);
  assert.equal(currentSlot(slots, 4, 500), null);
  // Slots without a start time never become "current".
  assert.equal(currentSlot([{ id: 'x', day: 3, period: 1, label: '第1节' }], 3, 500), null);
});

test('buildDayLogs records actual lessons with adjustments applied', async () => {
  const { buildDayLogs } = await loadAdjustments();
  const data = baseData();

  let logs = buildDayLogs(data, DATE);
  assert.equal(logs.length, 3);
  assert.ok(logs.every((log) => log.status === 'normal'));
  assert.ok(logs.every((log) => log.teacherId === log.originalTeacherId));

  data.adjustments = [
    adjustment({ id: 'a-move', type: 'move', originalEntryId: 'e1', targetSlotId: 'wed-2' }),
    adjustment({ id: 'a-sub', type: 'substitute', originalEntryId: 'e2', substituteTeacherId: 't3', slotId: 'wed-2' }),
    adjustment({ id: 'a-cancel', type: 'cancel', originalEntryId: 'e3', slotId: 'wed-2' }),
  ];
  logs = buildDayLogs(data, DATE);
  const moved = logs.find((log) => log.entryId === 'e1');
  assert.equal(moved.status, 'moved');
  assert.equal(moved.slotId, 'wed-2');
  const substituted = logs.find((log) => log.entryId === 'e2');
  assert.equal(substituted.status, 'substituted');
  assert.equal(substituted.teacherId, 't3');
  assert.equal(substituted.originalTeacherId, 't2');
  const cancelled = logs.find((log) => log.entryId === 'e3');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.adjustmentId, 'a-cancel');

  // Deterministic ids make refresh idempotent.
  assert.equal(buildDayLogs(data, DATE)[0].id, logs[0].id);
});

test('mergeDayLogs keeps manual status, notes and confirmation', async () => {
  const { buildDayLogs, mergeDayLogs } = await loadAdjustments();
  const data = baseData();
  const generated = buildDayLogs(data, DATE);
  const edited = generated.map((log) =>
    log.entryId === 'e2' ? { ...log, status: 'normal', note: '临时取消代课', confirmed: true } : log,
  );
  const merged = mergeDayLogs(edited, generated, DATE);
  const e2 = merged.find((log) => log.entryId === 'e2');
  assert.equal(e2.status, 'normal');
  assert.equal(e2.note, '临时取消代课');
  assert.equal(e2.confirmed, true);
  // A lesson removed from the timetable disappears from the merged list.
  const withoutE1 = { ...data, entries: data.entries.filter((entry) => entry.id !== 'e1') };
  const refreshed = mergeDayLogs(edited, buildDayLogs(withoutE1, DATE), DATE);
  assert.ok(!refreshed.some((log) => log.entryId === 'e1'));
});

test('buildActualStats separates taught, substitute, covered and cancelled', async () => {
  const { buildDayLogs, buildActualStats } = await loadAdjustments();
  const data = baseData();
  data.adjustments = [
    adjustment({ id: 'a-sub', type: 'substitute', originalEntryId: 'e2', substituteTeacherId: 't3', slotId: 'wed-2' }),
    adjustment({ id: 'a-cancel', type: 'cancel', originalEntryId: 'e3', slotId: 'wed-2' }),
    adjustment({ id: 'a-move', type: 'move', originalEntryId: 'e1', targetSlotId: 'wed-2' }),
  ];
  const logs = buildDayLogs(data, DATE);
  const stats = buildActualStats(logs, data.teachers, DATE);
  assert.equal(stats.total, 3);
  assert.equal(stats.normal, 0);
  assert.equal(stats.substituted, 1);
  assert.equal(stats.moved, 1);
  assert.equal(stats.cancelled, 1);
  const byTeacher = Object.fromEntries(stats.teachers.map((row) => [row.teacherId, row]));
  assert.equal(byTeacher.t3.substitute, 1);
  assert.equal(byTeacher.t3.taught, 1);
  assert.equal(byTeacher.t2.covered, 1);
  assert.equal(byTeacher.t1.cancelled, 1);
  assert.equal(byTeacher.t1.moved, 1);
});

test('summary counts substitute workload per teacher', async () => {
  const { summarizeAdjustments } = await loadAdjustments();
  const summary = summarizeAdjustments([
    adjustment({ id: 'a1', type: 'substitute', substituteTeacherId: 't2' }),
    adjustment({ id: 'a2', type: 'substitute', substituteTeacherId: 't2' }),
    adjustment({ id: 'a3', type: 'move' }),
    adjustment({ id: 'a4', type: 'cancel', status: 'revoked' }),
  ]);
  assert.equal(summary.total, 4);
  assert.equal(summary.substitute, 2);
  assert.equal(summary.revoked, 1);
  assert.equal(summary.substituteByTeacher.t2, 2);
});

