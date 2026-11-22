const test = require('node:test');
const assert = require('node:assert/strict');

async function load() {
  return import('../apps/renderer/src/nextAction.ts');
}

function base(overrides = {}) {
  return {
    issues: [],
    hasCandidate: true,
    outcome: 'feasible',
    hasReport: true,
    reportOk: true,
    hardConflicts: 0,
    unplaced: 0,
    hasPublished: false,
    ...overrides,
  };
}

test('预检问题优先级最高', async () => {
  const { resolveNextAction } = await load();
  const action = resolveNextAction(base({ issues: ['缺班级', '缺教师'], hardConflicts: 3, unplaced: 5 }));
  assert.equal(action.kind, 'prepare');
  assert.equal(action.tone, 'blocking');
  assert.match(action.title, /2 项/);
  assert.equal(action.detail, '缺班级');
});

test('硬冲突排第二：只有存在候选时才生效', async () => {
  const { resolveNextAction } = await load();
  const withCandidate = resolveNextAction(base({ hardConflicts: 2 }));
  assert.equal(withCandidate.kind, 'inspect');
  assert.equal(withCandidate.tone, 'blocking');
  assert.match(withCandidate.title, /2 项硬冲突/);

  const noCandidate = resolveNextAction(base({ hasCandidate: false, hardConflicts: 2 }));
  assert.equal(noCandidate.kind, 'run');
});

test('未排满 / 超时走排课任务，而不是检测', async () => {
  const { resolveNextAction } = await load();
  for (const outcome of ['partial', 'timeout']) {
    const action = resolveNextAction(base({ outcome, unplaced: 4 }));
    assert.equal(action.kind, 'run');
    assert.equal(action.tone, 'attention');
    assert.match(action.detail, /4 课时未排/);
  }
});

test('unplaced > 0 即使 outcome 是 feasible 也提示未排满', async () => {
  const { resolveNextAction } = await load();
  const action = resolveNextAction(base({ outcome: 'feasible', unplaced: 1 }));
  assert.equal(action.kind, 'run');
  assert.equal(action.tone, 'attention');
});

test('没有候选时先去排课', async () => {
  const { resolveNextAction } = await load();
  const action = resolveNextAction(base({ hasCandidate: false, hasReport: false, reportOk: false }));
  assert.equal(action.kind, 'run');
  assert.equal(action.tone, 'ready');
});

test('有候选但没报告时去检测', async () => {
  const { resolveNextAction } = await load();
  const action = resolveNextAction(base({ hasReport: false, reportOk: false }));
  assert.equal(action.kind, 'inspect');
  assert.equal(action.tone, 'ready');
});

test('检测未通过时留在检测页', async () => {
  const { resolveNextAction } = await load();
  const action = resolveNextAction(base({ reportOk: false }));
  assert.equal(action.kind, 'inspect');
  assert.equal(action.tone, 'blocking');
});

test('通过检测未发布时提示保存正式版', async () => {
  const { resolveNextAction } = await load();
  const action = resolveNextAction(base({ hasPublished: false }));
  assert.equal(action.kind, 'publish');
  assert.equal(action.tone, 'ready');
});

test('已发布进入完成态', async () => {
  const { resolveNextAction } = await load();
  const action = resolveNextAction(base({ hasPublished: true }));
  assert.equal(action.kind, 'export');
  assert.equal(action.tone, 'done');
});

test('每个 kind 都有按钮文案', async () => {
  const { NEXT_ACTION_LABELS } = await load();
  for (const kind of ['prepare', 'rules', 'run', 'inspect', 'publish', 'export']) {
    assert.equal(typeof NEXT_ACTION_LABELS[kind], 'string');
    assert.ok(NEXT_ACTION_LABELS[kind].length > 0);
  }
});
