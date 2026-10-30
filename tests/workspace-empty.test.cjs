const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * isWorkspaceEmpty 决定「切换/新建工程时是否需要提示会丢弃数据」，
 * 判断错误会导致静默覆盖用户工作区，因此单独覆盖边界。
 */
async function load() {
  return import('../apps/renderer/src/newWorkspace.ts');
}

test('isWorkspaceEmpty：三类主数据全空才算空', async () => {
  const { isWorkspaceEmpty } = await load();
  assert.equal(isWorkspaceEmpty({ classes: [], teachers: [], coursePlans: [] }), true);
});

test('isWorkspaceEmpty：只有教师也算非空', async () => {
  const { isWorkspaceEmpty } = await load();
  assert.equal(isWorkspaceEmpty({ classes: [], teachers: [{ id: 't1' }], coursePlans: [] }), false);
});

test('isWorkspaceEmpty：只有教学计划也算非空', async () => {
  const { isWorkspaceEmpty } = await load();
  assert.equal(isWorkspaceEmpty({ classes: [], teachers: [], coursePlans: [{ id: 'p1' }] }), false);
});

test('isWorkspaceEmpty：有班级即为非空', async () => {
  const { isWorkspaceEmpty } = await load();
  assert.equal(isWorkspaceEmpty({ classes: [{ id: 'c1' }], teachers: [], coursePlans: [] }), false);
});

test('createEmptyWorkspace 产出的是空工作区且带默认软约束', async () => {
  const { createEmptyWorkspace, isWorkspaceEmpty } = await load();
  const workspace = createEmptyWorkspace('测试工程');
  assert.equal(isWorkspaceEmpty(workspace), true);
  assert.equal(workspace.school.name, '测试工程');
  assert.equal(workspace.roomMode, 'simplified');
  assert.ok(Array.isArray(workspace.softConstraints) && workspace.softConstraints.length > 0);
});
