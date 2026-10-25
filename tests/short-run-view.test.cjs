const test = require('node:test');
const assert = require('node:assert/strict');

async function load() {
  return import('../apps/renderer/src/shortRunView.ts');
}

function fixture() {
  return {
    school: { id: 's', name: '测试学校' },
    classes: [
      { id: 'c1', name: '一年级1班', grade: '一年级', size: 40 },
      { id: 'c2', name: '二年级1班', grade: '二年级', size: 40 },
    ],
    teachers: [
      { id: 't1', name: '王老师' },
      { id: 't2', name: '李老师' },
    ],
    subjects: [
      { id: 's1', name: '语文' },
      { id: 's2', name: '数学' },
    ],
    rooms: [
      { id: 'r1', name: '101 教室', capacity: 50, type: '普通' },
    ],
    timeSlots: [
      { id: 'd2-p1', day: 2, period: 1, label: '周二 第1节' },
      { id: 'd1-p2', day: 1, period: 2, label: '周一 第2节' },
    ],
    coursePlans: [
      { id: 'p1', classId: 'c1', subjectId: 's1', teacherId: 't1', weeklyPeriods: 2, weeks: 'even' },
      { id: 'p2', classId: 'c2', subjectId: 's2', teacherId: 't2', weeklyPeriods: 1 },
    ],
  };
}

function record(entries) {
  return {
    id: 'short-1',
    createdAt: '2026-10-25T12:00:00.000Z',
    status: 'COMPLETED',
    entries: entries.length,
    elapsedMs: 1200,
    feasible: true,
    mode: 'solve',
    timeLimitSeconds: 30,
    lockedCount: 1,
    totalPeriods: 3,
    runMode: 'single',
    result: {
      protocolVersion: '1.0',
      status: 'COMPLETED',
      entries,
      hardConstraintViolations: [],
      softScore: 0,
      scoreBreakdown: {},
      unsatisfiedRules: [],
      explanation: '测试结果',
      elapsedMs: 1200,
      hasFeasibleSolution: true,
    },
  };
}

function entry(overrides) {
  return {
    id: 'e1',
    coursePlanId: 'p1',
    classId: 'c1',
    teacherId: 't1',
    roomId: 'r1',
    slotId: 'd2-p1',
    source: 'AUTO',
    locked: false,
    ...overrides,
  };
}

test('short-run rows are ordered by weekday/period and resolve names', async () => {
  const { shortRunEntryRows } = await load();
  const data = fixture();
  const run = record([
    entry({ id: 'e1', weeks: 'odd' }),
    entry({ id: 'e2', coursePlanId: 'p2', classId: 'c2', teacherId: 't2', slotId: 'd1-p2' }),
  ]);
  const rows = shortRunEntryRows(data, run);
  assert.deepEqual(rows.map((row) => row.id), ['e2', 'e1']);
  assert.equal(rows[0].time, '周一 第2节');
  assert.equal(rows[0].className, '二年级1班');
  assert.equal(rows[0].subject, '数学');
  assert.equal(rows[0].teacher, '李老师');
  assert.equal(rows[0].weeks, '每周');
  assert.equal(rows[1].weeks, '单周');
  assert.equal(rows[1].room, '101 教室');
});

test('short-run rows fall back to raw ids when workspace data was removed', async () => {
  const { shortRunEntryRows, shortRunMissingRefs } = await load();
  const data = fixture();
  const run = record([
    entry({ id: 'gone', coursePlanId: 'gone-plan', classId: 'gone-class', teacherId: 'gone-teacher', roomId: 'gone-room', slotId: 'gone-slot' }),
  ]);
  const rows = shortRunEntryRows(data, run);
  assert.equal(rows[0].time, 'gone-slot');
  assert.equal(rows[0].className, 'gone-class');
  assert.equal(rows[0].subject, '未知课程');
  assert.equal(rows[0].teacher, 'gone-teacher');
  assert.equal(rows[0].room, 'gone-room');
  assert.equal(shortRunMissingRefs(data, run), 1);
  assert.equal(shortRunMissingRefs(data, record([entry({})])), 0);
});

test('short-run status labels are shared with the history list', async () => {
  const { runStatusText } = await import('../apps/renderer/src/runConfig.ts');
  assert.equal(runStatusText('COMPLETED'), '已完成');
  assert.equal(runStatusText('TIMEOUT'), '超时');
  assert.equal(runStatusText('CUSTOM'), 'CUSTOM');
});
