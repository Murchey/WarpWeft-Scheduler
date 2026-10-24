const test = require('node:test');
const assert = require('node:assert/strict');

async function loadTemplate() {
  return import('../apps/renderer/src/slotTemplate.ts');
}

function sourceSlots() {
  return [
    { id: 'mon-1', day: 1, period: 1, label: '周一 第1节', kind: 'morning', start: '07:30', duration: 20 },
    { id: 'mon-2', day: 1, period: 2, label: '周一 第2节', kind: 'regular', start: '08:00', duration: 45 },
  ];
}

test('copy one day to selected weekdays with relabelled slots', async () => {
  const { applyDayTemplate } = await loadTemplate();
  let sequence = 0;
  const result = applyDayTemplate(sourceSlots(), 1, [2, 3, 3, 1], 'skip', () => 'copy-' + (++sequence));
  assert.deepEqual(result.targetDays, [2, 3]);
  assert.equal(result.additions, 4);
  assert.equal(result.overwrites, 0);
  assert.equal(result.skips, 0);
  const tuesday = result.slots.filter((slot) => slot.day === 2);
  assert.equal(tuesday.length, 2);
  assert.deepEqual(tuesday.map((slot) => slot.label), ['周二 第1节', '周二 第2节']);
  assert.deepEqual(tuesday.map((slot) => slot.id), ['copy-1', 'copy-2']);
  assert.equal(tuesday[0].kind, 'morning');
  assert.equal(tuesday[0].start, '07:30');
  assert.equal(tuesday[0].duration, 20);
});

test('skip mode keeps target slots and does not delete extra periods', async () => {
  const { planDayTemplate, applyDayTemplate } = await loadTemplate();
  const slots = [
    ...sourceSlots(),
    { id: 'tue-1', day: 2, period: 1, label: '周二 早读', kind: 'study', start: '07:40', duration: 15 },
    { id: 'tue-9', day: 2, period: 9, label: '周二 第9节', kind: 'evening' },
  ];
  const plan = planDayTemplate(slots, 1, [2], 'skip');
  assert.equal(plan.additions, 1);
  assert.equal(plan.overwrites, 0);
  assert.equal(plan.skips, 1);
  const result = applyDayTemplate(slots, 1, [2], 'skip', () => 'copy');
  assert.equal(result.slots.length, 5);
  assert.equal(result.slots.find((slot) => slot.id === 'tue-1').kind, 'study');
  assert.equal(result.slots.find((slot) => slot.id === 'tue-9').period, 9);
});

test('overwrite mode updates same periods in place and keeps ids', async () => {
  const { applyDayTemplate } = await loadTemplate();
  const slots = [
    ...sourceSlots(),
    { id: 'tue-1', day: 2, period: 1, label: '周二 早读', kind: 'study', start: '07:40', duration: 15 },
    { id: 'tue-2', day: 2, period: 2, label: '周二 第2节', kind: 'study' },
  ];
  const result = applyDayTemplate(slots, 1, [2], 'overwrite', () => 'copy');
  assert.equal(result.additions, 0);
  assert.equal(result.overwrites, 2);
  const first = result.slots.find((slot) => slot.id === 'tue-1');
  assert.deepEqual(first, { id: 'tue-1', day: 2, period: 1, label: '周二 第1节', kind: 'morning', start: '07:30', duration: 20 });
  const second = result.slots.find((slot) => slot.id === 'tue-2');
  assert.deepEqual(second, { id: 'tue-2', day: 2, period: 2, label: '周二 第2节', kind: 'regular', start: '08:00', duration: 45 });
  assert.equal(slots[2].kind, 'study');
});

test('overwrite clears optional fields that the source day does not define', async () => {
  const { applyDayTemplate } = await loadTemplate();
  const source = [{ id: 'mon-3', day: 1, period: 3, label: '周一 第3节' }];
  const slots = [...source, { id: 'tue-3', day: 2, period: 3, label: '周二 第3节', kind: 'study', start: '10:00', duration: 40 }];
  const result = applyDayTemplate(slots, 1, [2], 'overwrite', () => 'copy');
  assert.deepEqual(result.slots.find((slot) => slot.id === 'tue-3'), {
    id: 'tue-3', day: 2, period: 3, label: '周二 第3节', kind: undefined, start: undefined, duration: undefined,
  });
});

test('weekday labels are rewritten but custom labels are preserved', async () => {
  const { relabelForDay } = await loadTemplate();
  assert.equal(relabelForDay('周一 第1节', 1, 4, 1), '周四 第1节');
  assert.equal(relabelForDay('星期一 早读', 1, 4, 1), '星期四 早读');
  assert.equal(relabelForDay('晨读', 1, 4, 1), '晨读');
  assert.equal(relabelForDay('', 1, 4, 3), '周四 第3节');
  assert.equal(relabelForDay('周日 第1节', 7, 1, 1), '周一 第1节');
});
