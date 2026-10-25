const test = require('node:test');
const assert = require('node:assert/strict');

async function load() {
  return import('../apps/renderer/src/planTableView.ts');
}

function fixture() {
  return {
    school: { id: 's', name: '测试学校' },
    classes: [
      { id: 'c1', name: '一年级1班', grade: '一年级', size: 40 },
      { id: 'c2', name: '二年级1班', grade: '二年级', size: 40 },
      { id: 'c3', name: '未分年级班', grade: '', size: 40 },
    ],
    teachers: [
      { id: 't1', name: '王老师' },
      { id: 't2', name: '李老师' },
    ],
    subjects: [
      { id: 's1', name: '语文' },
      { id: 's2', name: '数学' },
    ],
    rooms: [],
    timeSlots: [
      { id: 'd1-p1', day: 1, period: 1, label: '周一 第1节' },
      { id: 'd4-p6', day: 4, period: 6, label: '周四 第6节' },
    ],
    coursePlans: [
      { id: 'p1', classId: 'c1', subjectId: 's1', teacherId: 't1', weeklyPeriods: 5, fixedSlotIds: ['d1-p1'], consecutive: 2, pairId: '语数间周' },
      { id: 'p2', classId: 'c2', subjectId: 's2', teacherId: 't2', weeklyPeriods: 4, weeks: 'odd', kind: 'morning', roomType: '实验室' },
      { id: 'p3', classId: 'c3', subjectId: 's2', teacherId: '', weeklyPeriods: 2, weeks: 'even' },
    ],
  };
}

test('default view shows six core columns and keeps optional fields hidden', async () => {
  const { defaultPlanView } = await load();
  const view = defaultPlanView();
  const visible = Object.entries(view.columns).filter(([, item]) => item.visible).map(([key]) => key);
  assert.deepEqual(visible, ['classId', 'subjectId', 'teacherId', 'weeklyPeriods', 'constraints', 'actions']);
  assert.equal(view.density, 'standard');
  assert.equal(view.height, 'standard');
  assert.equal(view.tab, 'detail');
  assert.equal(view.pageSize, 50);
});

test('view normalization tolerates corrupt data, forces required columns and clamps widths', async () => {
  const { normalizePlanView } = await load();
  const view = normalizePlanView({
    columns: {
      classId: { visible: false, width: 10 },
      actions: { visible: false },
      weeks: { visible: true, width: 9999 },
      mystery: { visible: true, width: 200 },
    },
    density: 'huge',
    height: 'giant',
    tab: 'nope',
    pageSize: 999,
  });
  assert.equal(view.columns.classId.visible, true);
  assert.equal(view.columns.actions.visible, true);
  assert.equal(view.columns.weeks.visible, true);
  assert.equal(view.columns.classId.width, 108);
  assert.equal(view.columns.weeks.width, 800);
  assert.equal(view.columns.mystery, undefined);
  assert.equal(view.density, 'standard');
  assert.equal(view.pageSize, 50);
  assert.equal(normalizePlanView(null).version, 2);
});

test('filters combine search, grade, class, subject, weeks and unassigned teacher', async () => {
  const { filterPlans, planLookups, planFixedLabels } = await load();
  const data = fixture();
  const lookups = planLookups(data);
  assert.deepEqual(filterPlans(data.coursePlans, lookups, { query: '', grade: '', classId: '', subjectId: '', weeks: '', teacherUnset: false }).map((plan) => plan.id), ['p1', 'p2', 'p3']);
  assert.deepEqual(filterPlans(data.coursePlans, lookups, { query: '王老师', grade: '', classId: '', subjectId: '', weeks: '', teacherUnset: false }).map((plan) => plan.id), ['p1']);
  assert.deepEqual(filterPlans(data.coursePlans, lookups, { query: '周一 第1节', grade: '', classId: '', subjectId: '', weeks: '', teacherUnset: false }).map((plan) => plan.id), ['p1']);
  assert.deepEqual(filterPlans(data.coursePlans, lookups, { query: '', grade: '二年级', classId: '', subjectId: '', weeks: '', teacherUnset: false }).map((plan) => plan.id), ['p2']);
  assert.deepEqual(filterPlans(data.coursePlans, lookups, { query: '', grade: '未分年级', classId: '', subjectId: '', weeks: '', teacherUnset: false }).map((plan) => plan.id), ['p3']);
  assert.deepEqual(filterPlans(data.coursePlans, lookups, { query: '', grade: '', classId: '', subjectId: 's2', weeks: 'even', teacherUnset: false }).map((plan) => plan.id), ['p3']);
  assert.deepEqual(filterPlans(data.coursePlans, lookups, { query: '', grade: '', classId: '', subjectId: '', weeks: '', teacherUnset: true }).map((plan) => plan.id), ['p3']);
  assert.deepEqual(planFixedLabels(data.coursePlans[0], lookups), ['周一 第1节']);
});

test('sorting is stable and numeric for weekly periods', async () => {
  const { sortPlans, planLookups } = await load();
  const data = fixture();
  const lookups = planLookups(data);
  assert.deepEqual(sortPlans(data.coursePlans, { key: 'weeklyPeriods', dir: 'desc' }, lookups).map((plan) => plan.id), ['p1', 'p2', 'p3']);
  assert.deepEqual(sortPlans(data.coursePlans, { key: null, dir: 'asc' }, lookups).map((plan) => plan.id), ['p1', 'p2', 'p3']);
  assert.deepEqual(sortPlans(data.coursePlans, { key: 'classId', dir: 'asc' }, lookups).map((plan) => plan.id), ['p2', 'p3', 'p1']);
});

test('pagination clamps to a valid page and reports counts', async () => {
  const { paginatePlans } = await load();
  const plans = Array.from({ length: 120 }, (_, index) => ({ id: 'p' + index, classId: 'c1', subjectId: 's1', teacherId: 't1', weeklyPeriods: 1 }));
  const page = paginatePlans(plans, 99, 50);
  assert.equal(page.page, 3);
  assert.equal(page.pageCount, 3);
  assert.equal(page.items.length, 20);
  assert.equal(page.start, 100);
  assert.equal(page.end, 120);
  assert.equal(paginatePlans(plans, -4, 50).page, 1);
  assert.equal(paginatePlans([], 5, 50).pageCount, 1);
});

test('constraint summary describes fixed, consecutive, pairing, parity, kind and room', async () => {
  const { planConstraintSummary, planLookups } = await load();
  const data = fixture();
  const lookups = planLookups(data);
  assert.deepEqual(planConstraintSummary(data.coursePlans[0], lookups).map((badge) => badge.label), ['固定 1', '连堂 2', '配对 语数间周']);
  assert.deepEqual(planConstraintSummary(data.coursePlans[1], lookups).map((badge) => badge.label), ['单周', '早读', '实验室']);
  assert.deepEqual(planConstraintSummary(data.coursePlans[2], lookups).map((badge) => badge.label), ['双周']);
});

test('view persistence handles missing storage and removes legacy keys', async () => {
  const { loadPlanView, savePlanView, resetPlanView, PLAN_VIEW_KEY, LEGACY_PLAN_VIEW_KEYS, defaultPlanView } = await load();
  const store = new Map();
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
  LEGACY_PLAN_VIEW_KEYS.forEach((key) => store.set(key, 'old'));
  assert.deepEqual(loadPlanView(storage), defaultPlanView());
  assert.equal(store.has(LEGACY_PLAN_VIEW_KEYS[0]), false);
  const custom = defaultPlanView();
  custom.density = 'compact';
  custom.columns.classId.width = 222;
  savePlanView(custom, storage);
  assert.equal(store.has(PLAN_VIEW_KEY), true);
  assert.deepEqual(loadPlanView(storage), custom);
  assert.deepEqual(resetPlanView(storage), defaultPlanView());
  assert.equal(store.has(PLAN_VIEW_KEY), false);
  assert.deepEqual(loadPlanView(null), defaultPlanView());
});
