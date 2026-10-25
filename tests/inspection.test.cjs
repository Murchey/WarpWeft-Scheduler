const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// The inspection engine is plain TypeScript with no runtime imports, so Node's
// built-in type stripping can load it directly. That keeps the report tested
// against exactly the code the renderer ships.
async function loadInspection() {
  return import('../packages/inspection/src.ts');
}

function baseInput() {
  return {
    timeSlots: [
      { id: 'd1-p1', day: 1, period: 1, label: '周一 第1节' },
      { id: 'd1-p2', day: 1, period: 2, label: '周一 第2节' },
      { id: 'd2-p1', day: 2, period: 1, label: '周二 第1节' },
      { id: 'd2-p2', day: 2, period: 2, label: '周二 第2节' },
    ],
    classes: [
      { id: 'c1', name: '一班', size: 30 },
      { id: 'c2', name: '二班', size: 30 },
    ],
    teachers: [
      { id: 't1', name: '甲老师' },
      { id: 't2', name: '乙老师' },
    ],
    subjects: [
      { id: 's1', name: '数学' },
      { id: 's2', name: '语文' },
    ],
    rooms: [
      { id: 'r1', name: '一号教室', capacity: 40, type: '普通教室' },
      { id: 'r2', name: '二号教室', capacity: 40, type: '普通教室' },
    ],
    coursePlans: [
      { id: 'p1', classId: 'c1', subjectId: 's1', teacherId: 't1', weeklyPeriods: 1 },
      { id: 'p2', classId: 'c1', subjectId: 's2', teacherId: 't2', weeklyPeriods: 1 },
      { id: 'p3', classId: 'c2', subjectId: 's1', teacherId: 't2', weeklyPeriods: 1 },
      { id: 'p4', classId: 'c2', subjectId: 's2', teacherId: 't1', weeklyPeriods: 1 },
    ],
    entries: [
      { id: 'e1', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'd1-p1' },
      { id: 'e2', coursePlanId: 'p2', classId: 'c1', teacherId: 't2', roomId: 'r1', slotId: 'd1-p2' },
      { id: 'e3', coursePlanId: 'p3', classId: 'c2', teacherId: 't2', roomId: 'r2', slotId: 'd2-p1' },
      { id: 'e4', coursePlanId: 'p4', classId: 'c2', teacherId: 't1', roomId: 'r2', slotId: 'd2-p2' },
    ],
    unavailableSlots: [],
    rules: [],
  };
}

function entry(overrides) {
  return {
    id: 'e9',
    coursePlanId: 'p1',
    classId: 'c1',
    teacherId: 't1',
    roomId: 'r1',
    slotId: 'd1-p1',
    ...overrides,
  };
}

test('clean timetable has no issues and is publishable', async () => {
  const { inspectTimetable } = await loadInspection();
  const report = inspectTimetable(baseInput());
  assert.equal(report.summary.hard, 0);
  assert.equal(report.issues.length, 0);
  assert.equal(report.ok, true);
  assert.equal(report.summary.planned, 4);
  assert.equal(report.summary.placed, 4);
  assert.equal(report.summary.unplaced, 0);
  // one room type: 4 lessons over 2 rooms × 4 slots
  assert.equal(report.utilization.rooms[0].used, 4);
  assert.equal(report.utilization.rooms[0].capacity, 8);
  assert.equal(report.utilization.rooms[0].ratio, 0.5);
});

test('class, teacher and room double booking are hard conflicts', async () => {
  const { inspectTimetable, CATEGORY_LABELS } = await loadInspection();
  const input = baseInput();
  // two lessons in the same slot: same teacher and same room, different classes
  input.entries = [
    entry({ id: 'x1', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'd1-p1' }),
    entry({ id: 'x2', coursePlanId: 'p2', classId: 'c2', teacherId: 't1', roomId: 'r1', slotId: 'd1-p1' }),
  ];
  const report = inspectTimetable(input);
  const categories = report.issues.map((item) => item.category);
  assert.ok(categories.includes('TEACHER_CONFLICT'));
  assert.ok(categories.includes('ROOM_CONFLICT'));
  assert.equal(report.ok, false);
  assert.deepEqual(new Set(report.summary.conflictEntryIds), new Set(['x1', 'x2']));
  assert.equal(CATEGORY_LABELS.TEACHER_CONFLICT, '教师冲突');
});

test('class double booking alone is reported as a class conflict', async () => {
  const { inspectTimetable } = await loadInspection();
  const input = baseInput();
  // same class, same slot, different teachers and rooms
  input.entries[1] = { ...input.entries[1], slotId: 'd1-p1', roomId: 'r2' };
  const report = inspectTimetable(input);
  assert.equal(report.issues.filter((item) => item.category === 'CLASS_CONFLICT').length, 1);
  assert.equal(report.summary.hard, 1);
});

test('capacity, room type and fixed-time violations are reported', async () => {
  const { inspectTimetable } = await loadInspection();
  const input = baseInput();
  input.rooms[0] = { ...input.rooms[0], capacity: 10 };
  input.coursePlans[0] = { ...input.coursePlans[0], roomType: '实验室', fixedSlotId: 'd2-p2' };
  // e1 is in r1 (capacity 10 < 30), wrong room type and the wrong fixed slot
  const report = inspectTimetable(input);
  const mismatches = report.issues.filter((item) => item.category === 'ROOM_MISMATCH' && item.refs.entryIds?.[0] === 'e1');
  const fixed = report.issues.filter((item) => item.category === 'FIXED_SLOT');
  assert.equal(mismatches.length, 2); // capacity + room type, both on e1
  assert.equal(fixed.length, 1);
  assert.equal(report.ok, false);
});

test('teacher unavailable slot is a hard conflict', async () => {
  const { inspectTimetable } = await loadInspection();
  const input = baseInput();
  input.unavailableSlots = [{ teacherId: 't1', slotId: 'd1-p1' }];
  const report = inspectTimetable(input);
  assert.ok(report.issues.some((item) => item.category === 'TEACHER_UNAVAILABLE'));
});

test('missing entries become unplaced rows and block publication', async () => {
  const { inspectTimetable } = await loadInspection();
  const input = baseInput();
  input.entries = input.entries.filter((item) => item.id !== 'e4');
  const report = inspectTimetable(input);
  assert.equal(report.summary.unplaced, 1);
  assert.equal(report.unplaced.length, 1);
  assert.equal(report.unplaced[0].planId, 'p4');
  assert.equal(report.unplaced[0].missing, 1);
  assert.equal(report.ok, false);
});

test('must rules block publication, prefer rules only warn', async () => {
  const { inspectTimetable } = await loadInspection();
  const rule = (importance) => ({
    id: 'rule-1',
    kind: 'TEACHER_MAX_DAILY',
    scope: { type: 'teacher', teacherId: 't1' },
    time: { type: 'all' },
    importance,
    params: { maxPerDay: 1 },
    enabled: true,
  });
  const input = baseInput();
  // t1 teaches on Monday and Tuesday, one lesson per day → no violation yet
  let report = inspectTimetable({ ...input, rules: [rule('must')] });
  assert.equal(report.summary.must, 0);

  // add a second t1 lesson on Monday
  input.coursePlans.push({ id: 'p5', classId: 'c2', subjectId: 's1', teacherId: 't1', weeklyPeriods: 1 });
  input.entries.push(entry({ id: 'x3', coursePlanId: 'p5', classId: 'c2', teacherId: 't1', roomId: 'r2', slotId: 'd1-p2' }));
  report = inspectTimetable({ ...input, rules: [rule('must')] });
  assert.equal(report.summary.must, 1);
  assert.equal(report.ok, false);
  assert.match(report.issues.find((item) => item.severity === 'must').title, /甲老师/);

  const preferReport = inspectTimetable({ ...input, rules: [rule('prefer')] });
  assert.equal(preferReport.summary.must, 0);
  assert.equal(preferReport.summary.prefer, 1);
  assert.equal(preferReport.ok, true);
});

test('subject spread and double-period rules are evaluated', async () => {
  const { inspectTimetable } = await loadInspection();
  const input = baseInput();
  // two math lessons for class 一班 on the same day, adjacent
  input.coursePlans[0] = { ...input.coursePlans[0], weeklyPeriods: 2 };
  input.entries = [
    entry({ id: 'm1', coursePlanId: 'p1', slotId: 'd1-p1' }),
    entry({ id: 'm2', coursePlanId: 'p1', slotId: 'd1-p2' }),
  ];
  input.rules = [{
    id: 'rule-spread',
    kind: 'SUBJECT_SPREAD',
    scope: { type: 'subject', subjectId: 's1' },
    time: { type: 'all' },
    importance: 'prefer',
    params: { maxPerDay: 1 },
    enabled: true,
  }];
  let report = inspectTimetable(input);
  assert.equal(report.issues.filter((item) => item.refs.ruleIds?.includes('rule-spread')).length, 1);

  input.rules = [{
    id: 'rule-double',
    kind: 'DOUBLE_PERIOD',
    scope: { type: 'subject', subjectId: 's1' },
    time: { type: 'all' },
    importance: 'must',
    params: { periods: 2 },
    enabled: true,
  }];
  report = inspectTimetable(input);
  // the adjacent pair satisfies the double-period rule
  assert.equal(report.issues.filter((item) => item.refs.ruleIds?.includes('rule-double')).length, 0);
  // must rules are satisfied; only hard unplaced lessons remain
  assert.equal(report.summary.must, 0);
});

test('odd and even lessons may share a slot, an all-week lesson may not', async () => {
  const { inspectTimetable } = await loadInspection();
  const input = baseInput();
  // 一班 has math in odd weeks and Chinese in even weeks, same slot.
  input.coursePlans[0] = { ...input.coursePlans[0], weeks: 'odd' };
  input.coursePlans[1] = { ...input.coursePlans[1], weeks: 'even' };
  input.entries[0] = { ...input.entries[0], slotId: 'd1-p1' };
  input.entries[1] = { ...input.entries[1], slotId: 'd1-p1', roomId: 'r2' };

  let report = inspectTimetable(input);
  assert.equal(report.issues.filter((item) => item.category === 'CLASS_CONFLICT').length, 0);
  assert.equal(report.ok, true);

  // A third plan that runs every week cannot share the slot.
  input.coursePlans[2] = { ...input.coursePlans[2], classId: 'c1', weeks: 'all' };
  input.entries[2] = { ...input.entries[2], classId: 'c1', slotId: 'd1-p1', roomId: 'r2' };
  report = inspectTimetable(input);
  const clash = report.issues.find((item) => item.category === 'CLASS_CONFLICT');
  assert.ok(clash);
  assert.equal(clash.refs.entryIds.length, 3);
  assert.match(clash.title, /同时排了 3 门课/);
});

test('same teacher can teach odd and even lessons in the same slot', async () => {
  const { inspectTimetable } = await loadInspection();
  const input = baseInput();
  // 甲老师 teaches 一班 in odd weeks and 二班 in even weeks at the same time.
  input.coursePlans[0] = { ...input.coursePlans[0], weeks: 'odd' };
  input.coursePlans[2] = { ...input.coursePlans[2], teacherId: 't1', weeks: 'even' };
  input.entries[0] = { ...input.entries[0], slotId: 'd1-p1' };
  input.entries[2] = { ...input.entries[2], slotId: 'd1-p1', roomId: 'r2' };
  const report = inspectTimetable(input);
  assert.equal(report.issues.filter((item) => item.category === 'TEACHER_CONFLICT').length, 0);
  assert.equal(report.ok, true);
});

test('a lesson placed in the wrong slot kind is a hard conflict', async () => {
  const { inspectTimetable } = await loadInspection();
  const input = baseInput();
  input.timeSlots[0] = { ...input.timeSlots[0], kind: 'morning' };
  // e1 is regular Chinese but sits in a morning slot.
  const report = inspectTimetable(input);
  const issue = report.issues.find((item) => item.category === 'SLOT_KIND');
  assert.ok(issue);
  assert.equal(issue.severity, 'hard');
  assert.match(issue.title, /被排进了早读时段/);
  assert.equal(report.ok, false);

  // Declaring the plan as a morning plan resolves it.
  input.coursePlans[0] = { ...input.coursePlans[0], kind: 'morning' };
  const fixed = inspectTimetable(input);
  assert.equal(fixed.issues.filter((item) => item.category === 'SLOT_KIND').length, 0);
});

test('study/aftercare plans may use regular slots but regular plans may not use their slots', async () => {
  const { inspectTimetable } = await loadInspection();
  const study = baseInput();
  study.coursePlans[0] = { ...study.coursePlans[0], kind: 'study' };
  assert.equal(inspectTimetable(study).issues.filter((item) => item.category === 'SLOT_KIND').length, 0);

  const aftercare = baseInput();
  aftercare.coursePlans[0] = { ...aftercare.coursePlans[0], kind: 'aftercare' };
  assert.equal(inspectTimetable(aftercare).issues.filter((item) => item.category === 'SLOT_KIND').length, 0);

  const wrong = baseInput();
  wrong.timeSlots[0] = { ...wrong.timeSlots[0], kind: 'aftercare' };
  assert.equal(inspectTimetable(wrong).issues.filter((item) => item.category === 'SLOT_KIND').length, 1);
});

test('elective group blocks occupy member classes as one lesson', async () => {
  const { inspectTimetable } = await loadInspection();
  const input = baseInput();
  input.electiveGroups = [{
    id: 'g1',
    name: '分层走班',
    subjectId: 's1',
    classIds: ['c1', 'c2'],
    blocks: [
      { id: 'b1', teacherId: 't1' },
      { id: 'b2', teacherId: 't2' },
    ],
  }];
  input.entries = [
    { id: 'g1-b1', coursePlanId: 'elective:b1', classId: 'g1', teacherId: 't1', roomId: 'r1', slotId: 'd1-p1', groupId: 'g1', blockId: 'b1' },
    { id: 'g1-b2', coursePlanId: 'elective:b2', classId: 'g1', teacherId: 't2', roomId: 'r2', slotId: 'd1-p1', groupId: 'g1', blockId: 'b2' },
  ];
  let report = inspectTimetable(input);
  assert.equal(report.issues.filter((item) => item.category === 'MISSING_REFERENCE').length, 0);
  // The two blocks are one group lesson, not a class double-booking.
  assert.equal(report.issues.filter((item) => item.category === 'CLASS_CONFLICT').length, 0);

  // A regular lesson for a member class in the same slot is a real conflict.
  input.entries.push({ id: 'e1', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'd1-p1' });
  report = inspectTimetable(input);
  const clash = report.issues.find((item) => item.category === 'CLASS_CONFLICT');
  assert.ok(clash, 'group slot must be released for member classes');
  assert.match(clash.title, /一班/);
});

test('export rows mirror the reported issues', async () => {
  const { inspectTimetable, reportRows } = await loadInspection();
  const input = baseInput();
  input.entries = input.entries.filter((item) => item.id !== 'e4');
  const rows = reportRows(inspectTimetable(input));
  assert.ok(rows.length >= 1);
  assert.ok(rows.some((row) => row.级别 === '硬冲突' && row.类型 === '未排课时'));
  assert.deepEqual(Object.keys(rows[0]), ['级别', '类型', '说明', '详情', '条目数']);
});

test('a real solver output passes inspection', async () => {
  const { inspectTimetable } = await loadInspection();
  const { solve } = require('./java-solver-helper.cjs');
  const seed = JSON.parse(fs.readFileSync('database/seeds/demo.json', 'utf8'));
  const input = {
    ...seed,
    protocolVersion: '1.0',
    dataSnapshotVersion: 'inspection-integration',
    hardConstraints: [],
    softConstraints: [],
    unavailableSlots: [],
    lockedEntries: [],
    rules: [],
    timeLimitSeconds: 10,
    randomSeed: 3,
  };
  const result = solve(input);
  assert.equal(result.status, 0, result.stderr || 'Java solver process failed');
  const output = JSON.parse(result.stdout);
  assert.equal(output.hasFeasibleSolution, true);
  const report = inspectTimetable({ ...seed, entries: output.entries });
  assert.equal(report.summary.hard, 0);
  assert.equal(report.ok, true);
  assert.equal(report.summary.placed, 21);
});


test('multi fixed slots allow surplus lessons and flag excess ones', async () => {
  const { inspectTimetable } = await loadInspection();
  const input = baseInput();
  input.coursePlans[0] = { ...input.coursePlans[0], weeklyPeriods: 3, fixedSlotIds: ['d1-p1'] };
  input.entries = [
    { id: 'e1', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'd1-p1' },
    { id: 'e1b', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'd2-p1' },
    { id: 'e1c', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'd2-p2' },
    { id: 'e2', coursePlanId: 'p2', classId: 'c1', teacherId: 't2', roomId: 'r2', slotId: 'd1-p2' },
    { id: 'e3', coursePlanId: 'p3', classId: 'c2', teacherId: 't2', roomId: 'r2', slotId: 'd1-p1' },
    { id: 'e4', coursePlanId: 'p4', classId: 'c2', teacherId: 't1', roomId: 'r2', slotId: 'd1-p2' },
  ];
  assert.equal(inspectTimetable(input).issues.filter((item) => item.category === 'FIXED_SLOT').length, 0);

  // Two free lessons but only one surplus slot: one must be flagged.
  input.coursePlans[0] = { ...input.coursePlans[0], weeklyPeriods: 2 };
  const report = inspectTimetable(input);
  assert.equal(report.issues.filter((item) => item.category === 'FIXED_SLOT').length, 1);
});

test('consecutive runs are checked next to the fixed-time check', async () => {
  const { inspectTimetable } = await loadInspection();
  const input = baseInput();
  input.coursePlans[0] = { ...input.coursePlans[0], weeklyPeriods: 2, consecutive: 2 };
  input.entries = [
    { id: 'e1', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'd1-p1' },
    { id: 'e1b', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'd1-p2' },
    { id: 'e2', coursePlanId: 'p2', classId: 'c1', teacherId: 't2', roomId: 'r2', slotId: 'd2-p1' },
    { id: 'e3', coursePlanId: 'p3', classId: 'c2', teacherId: 't2', roomId: 'r2', slotId: 'd1-p1' },
    { id: 'e4', coursePlanId: 'p4', classId: 'c2', teacherId: 't1', roomId: 'r2', slotId: 'd2-p2' },
  ];
  const paired = inspectTimetable(input);
  assert.equal(paired.issues.filter((item) => item.category === 'CONSECUTIVE').length, 0);

  input.entries[1] = { ...input.entries[1], slotId: 'd2-p1' };
  input.entries[2] = { ...input.entries[2], slotId: 'd1-p2' };
  const broken = inspectTimetable(input);
  assert.equal(broken.issues.filter((item) => item.category === 'CONSECUTIVE').length, 1);
});

test('paired odd/even plans must share a slot', async () => {
  const { inspectTimetable } = await loadInspection();
  const input = baseInput();
  input.coursePlans = [
    { id: 'pa', classId: 'c1', subjectId: 's1', teacherId: 't1', weeklyPeriods: 1, weeks: 'odd', pairId: 'g1' },
    { id: 'pb', classId: 'c1', subjectId: 's2', teacherId: 't2', weeklyPeriods: 1, weeks: 'even', pairId: 'g1' },
  ];
  input.entries = [
    { id: 'ea', coursePlanId: 'pa', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'd1-p1' },
    { id: 'eb', coursePlanId: 'pb', classId: 'c1', teacherId: 't2', roomId: 'r2', slotId: 'd2-p1' },
  ];
  const broken = inspectTimetable(input);
  assert.equal(broken.issues.filter((item) => item.category === 'PAIR_SLOT').length, 1);
  input.entries[1] = { ...input.entries[1], slotId: 'd1-p1' };
  assert.equal(inspectTimetable(input).issues.filter((item) => item.category === 'PAIR_SLOT').length, 0);
});
