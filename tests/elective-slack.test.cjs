const test = require('node:test');
const assert = require('node:assert/strict');

async function load() {
  return import('../apps/renderer/src/electiveSlack.ts');
}

function workspace(overrides = {}) {
  const slots = Array.from({ length: 15 }, (_, index) => ({
    id: 's' + index, day: Math.floor(index / 3) + 1, period: (index % 3) + 1, label: 'slot' + index,
  }));
  return {
    school: { id: 's', name: '测试学校' },
    classes: [
      { id: 'c1', name: '一年级1班', size: 40, grade: '一年级' },
      { id: 'c2', name: '一年级2班', size: 40, grade: '一年级' },
    ],
    teachers: [{ id: 't1', name: '王老师' }, { id: 't2', name: '李老师' }],
    subjects: [{ id: 'sub1', name: '数学' }],
    rooms: [],
    timeSlots: slots,
    coursePlans: [],
    electiveGroups: [],
    ...overrides,
  };
}

/** 每班每周 hours 节常规课，平均分给两门课。 */
function plansFor(classId, hours, weeks) {
  const half = Math.ceil(hours / 2);
  return [
    { id: classId + '-a', classId, subjectId: 'sub1', teacherId: 't1', weeklyPeriods: half, weeks },
    { id: classId + '-b', classId, subjectId: 'sub1', teacherId: 't2', weeklyPeriods: hours - half, weeks },
  ].filter((plan) => plan.weeklyPeriods > 0);
}

function group(classIds, weeklyPeriods = 1) {
  return {
    id: 'g1', name: '班会', subjectId: 'sub1', weeklyPeriods, classIds,
    blocks: [{ id: 'b1', name: '班会', teacherId: 't1', roomType: '' }],
  };
}

test('没有走班组时不产生任何余量问题', async () => {
  const { electiveSlack } = await load();
  const data = workspace({ coursePlans: plansFor('c1', 15, 'all') });
  const report = electiveSlack(data);
  assert.deepEqual(report.rows, []);
});

test('常规课时占满全部时间格时标记为 blocked（对应反馈中的班会排不了）', async () => {
  const { electiveSlack } = await load();
  const data = workspace({
    coursePlans: [...plansFor('c1', 15, 'all'), ...plansFor('c2', 12, 'all')],
    electiveGroups: [group(['c1', 'c2'])],
  });
  const report = electiveSlack(data);
  const blockedClasses = Array.from(new Set(report.blocked.map((row) => row.classId)));
  assert.deepEqual(blockedClasses, ['c1'], '只有占满 15 格的 c1 应被判为零余量');
  assert.equal(report.blocked.every((row) => row.slack === 0), true);
});

test('单双周分别计算余量：奇数周占满、偶数周有空位时只报奇数周', async () => {
  const { electiveSlack } = await load();
  // c1 单周 15 节（占满），双周 10 节（余 5 格）
  const plans = [
    { id: 'odd', classId: 'c1', subjectId: 'sub1', teacherId: 't1', weeklyPeriods: 15, weeks: 'odd' },
    { id: 'even', classId: 'c1', subjectId: 'sub1', teacherId: 't1', weeklyPeriods: 10, weeks: 'even' },
  ];
  const report = electiveSlack(workspace({ coursePlans: plans, electiveGroups: [group(['c1'])] }));
  const blocked = report.blocked.filter((row) => row.classId === 'c1');
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].parity, '单周');
  assert.equal(blocked[0].slack, 0);
});

test('余量不足但非零时归入 tight 而不是 blocked', async () => {
  const { electiveSlack } = await load();
  const data = workspace({
    coursePlans: plansFor('c1', 14, 'all'),
    // 每周需要 3 格，但只剩 1 格
    electiveGroups: [group(['c1'], 3)],
  });
  const report = electiveSlack(data);
  assert.equal(report.blocked.length, 0);
  assert.equal(report.tight.length, 2, '单周与双周各一行');
  assert.ok(report.tight.every((row) => row.slack === 1 && row.need === 3));
});

test('多个走班组时需求累加', async () => {
  const { electiveSlack } = await load();
  const data = workspace({
    // 只剩 1 格，但两个各 1 节的走班组共需 2 格
    coursePlans: plansFor('c1', 14, 'all'),
    electiveGroups: [group(['c1'], 1), { ...group(['c1'], 1), id: 'g2', name: '合班课' }],
  });
  const report = electiveSlack(data);
  assert.equal(report.tight.length, 2);
  assert.equal(report.tight[0].need, 2, '该班参与两个各 1 节的走班组');
});

test('提示文案区分「必然排不进」与「可能排不满」', async () => {
  const { electiveSlackMessages } = await load();
  const blocked = electiveSlackMessages(workspace({
    coursePlans: plansFor('c1', 15, 'all'),
    electiveGroups: [group(['c1'])],
  }));
  assert.equal(blocked.length, 1);
  assert.match(blocked[0], /占满全部时间格/);
  assert.match(blocked[0], /固定时间/, '应给出可操作建议');

  const tight = electiveSlackMessages(workspace({
    coursePlans: plansFor('c1', 14, 'all'),
    electiveGroups: [group(['c1'], 3)],
  }));
  assert.equal(tight.length, 1);
  assert.match(tight[0], /余量偏紧/);
  assert.doesNotMatch(tight[0], /占满全部时间格/);
});

test('没有时间格时不做除法，返回空报告', async () => {
  const { electiveSlack } = await load();
  const report = electiveSlack(workspace({ timeSlots: [], electiveGroups: [group(['c1'])] }));
  assert.deepEqual(report.rows, []);
});
