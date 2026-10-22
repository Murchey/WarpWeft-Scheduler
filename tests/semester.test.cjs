const test = require('node:test');
const assert = require('node:assert/strict');

async function loadSemester() {
  return import('../packages/semester/src.ts');
}

test('a semester is split into 7-day weeks with the last week clipped', async () => {
  const { semesterWeeks, semesterWeekCount } = await loadSemester();
  // 2026-09-01 (Tue) .. 2026-09-20 (Sun) = 20 days -> 3 weeks (last 6 days).
  const weeks = semesterWeeks({ startDate: '2026-09-01', endDate: '2026-09-20' });
  assert.equal(weeks.length, 3);
  assert.deepEqual(weeks[0], {
    index: 1,
    startDate: '2026-09-01',
    endDate: '2026-09-07',
    parity: 'odd',
    label: '第1周（09-01 ~ 09-07）',
  });
  assert.equal(weeks[2].startDate, '2026-09-15');
  assert.equal(weeks[2].endDate, '2026-09-20');
  assert.equal(weeks[2].parity, 'odd');
  assert.equal(semesterWeekCount({ startDate: '2026-09-01', endDate: '2026-09-20' }), 3);
});

test('week parity alternates and a 20-week term ends on an even week', async () => {
  const { semesterWeeks, parityOfWeek } = await loadSemester();
  const weeks = semesterWeeks({ startDate: '2026-09-01', endDate: '2027-01-18' });
  assert.equal(weeks.length, 20);
  assert.equal(weeks[0].parity, 'odd');
  assert.equal(weeks[19].parity, 'even');
  assert.equal(parityOfWeek(7), 'odd');
  assert.equal(parityOfWeek(8), 'even');
});

test('weekOfDate maps dates to weeks and rejects dates outside the term', async () => {
  const { weekOfDate } = await loadSemester();
  const semester = { startDate: '2026-09-01', endDate: '2026-10-12' };
  assert.equal(weekOfDate(semester, '2026-09-01'), 1);
  assert.equal(weekOfDate(semester, '2026-09-07'), 1);
  assert.equal(weekOfDate(semester, '2026-09-08'), 2);
  assert.equal(weekOfDate(semester, '2026-10-12'), 6);
  assert.equal(weekOfDate(semester, '2026-08-31'), null);
  assert.equal(weekOfDate(semester, '2026-10-13'), null);
});

test('invalid or inverted dates produce no weeks', async () => {
  const { semesterWeeks, isValidSemester } = await loadSemester();
  assert.deepEqual(semesterWeeks(null), []);
  assert.deepEqual(semesterWeeks({ startDate: '2026-02-30', endDate: '2026-03-01' }), []);
  assert.deepEqual(semesterWeeks({ startDate: '2026-09-10', endDate: '2026-09-01' }), []);
  assert.equal(isValidSemester({ startDate: '2026-09-01', endDate: '2026-09-01' }), true);
});

