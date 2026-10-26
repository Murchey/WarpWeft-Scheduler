const test = require('node:test');
const assert = require('node:assert/strict');

async function loadRules() {
  return import('../packages/constraints/src.ts');
}

function rule(overrides = {}) {
  return {
    id: 'rule-1',
    kind: 'SUBJECT_AVOID_FIRST_LAST',
    scope: { type: 'subject', subjectId: 's1' },
    time: { type: 'all' },
    importance: 'avoid',
    params: { avoid: 'first' },
    enabled: true,
    createdAt: '2026-10-26T00:00:00.000Z',
    source: 'manual',
    ...overrides,
  };
}

const data = {
  classes: [{ id: 'c1', name: '七年级1班' }],
  teachers: [{ id: 't1', name: '王老师' }],
  subjects: [{ id: 's1', name: '语文' }],
  rooms: [],
  timeSlots: [],
  coursePlans: [],
};

test('avoid-first-last and time-preference rules expose coherent importance choices', async () => {
  const { definitionOf, describeRule } = await loadRules();
  const avoid = definitionOf('SUBJECT_AVOID_FIRST_LAST');
  assert.deepEqual(avoid.importanceOptions, ['avoid']);
  assert.equal(avoid.defaultImportance, 'avoid');
  assert.equal(describeRule(rule(), data), '语文 避开第一节');
  assert.equal(describeRule(rule({ importance: 'prefer', params: { avoid: 'last' } }), data), '语文 尽量避开最后一节');

  const preference = definitionOf('SUBJECT_TIME_PREFERENCE');
  assert.deepEqual(preference.importanceOptions, ['prefer']);
  assert.equal(preference.defaultImportance, 'prefer');
  assert.equal(
    describeRule(rule({
      kind: 'SUBJECT_TIME_PREFERENCE',
      importance: 'prefer',
      params: { preference: 'afternoon' },
    }), data),
    '语文 尽量安排在下午',
  );
  // Old data may still carry the retired avoid value; it remains readable.
  assert.equal(
    describeRule(rule({
      kind: 'SUBJECT_TIME_PREFERENCE',
      importance: 'avoid',
      params: { preference: 'morning' },
    }), data),
    '语文 避免安排在上午',
  );
});
