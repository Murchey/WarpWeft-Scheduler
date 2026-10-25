const test = require('node:test');
const assert = require('node:assert/strict');

async function loadHelpers() {
  return import('../packages/contracts/src.ts');
}

test('subject names map to a sensible default time-of-day preference', async () => {
  const { suggestedSubjectPreference } = await loadHelpers();
  assert.equal(suggestedSubjectPreference('语文'), 'morning');
  assert.equal(suggestedSubjectPreference('数学'), 'morning');
  assert.equal(suggestedSubjectPreference('英语'), 'morning');
  assert.equal(suggestedSubjectPreference('书香阅读'), 'afternoon');
  assert.equal(suggestedSubjectPreference('数学益智'), 'afternoon');
  assert.equal(suggestedSubjectPreference('班会健康'), 'afternoon');
  assert.equal(suggestedSubjectPreference('校本课程'), undefined);
});

test('labels and parsing accept Chinese and English values', async () => {
  const { parseSubjectPreference, subjectPreferenceLabel } = await loadHelpers();
  assert.equal(parseSubjectPreference('上午'), 'morning');
  assert.equal(parseSubjectPreference('下午'), 'afternoon');
  assert.equal(parseSubjectPreference('morning'), 'morning');
  assert.equal(parseSubjectPreference('不限'), undefined);
  assert.equal(parseSubjectPreference(''), undefined);
  assert.equal(subjectPreferenceLabel('morning'), '上午');
  assert.equal(subjectPreferenceLabel('afternoon'), '下午');
  assert.equal(subjectPreferenceLabel(undefined), '不限');
});

test('fixed slot lists keep backward compatibility with the single field', async () => {
  const { fixedSlotIdsOf, consecutiveOf } = await loadHelpers();
  assert.deepEqual(fixedSlotIdsOf({ fixedSlotId: 's1' }), ['s1']);
  assert.deepEqual(fixedSlotIdsOf({ fixedSlotIds: ['s1', 's2'] }), ['s1', 's2']);
  assert.deepEqual(fixedSlotIdsOf({ fixedSlotId: 's1', fixedSlotIds: ['s2'] }), ['s2']);
  assert.deepEqual(fixedSlotIdsOf({}), []);
  assert.equal(consecutiveOf({ consecutive: 2 }), 2);
  assert.equal(consecutiveOf({ consecutive: 1 }), 0);
  assert.equal(consecutiveOf({}), 0);
});
