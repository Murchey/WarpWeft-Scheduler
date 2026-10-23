const test = require('node:test');
const assert = require('node:assert/strict');

async function loadPreview() {
  return import('../apps/renderer/src/timetablePreview.ts');
}

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    dump: () => Object.fromEntries(data),
  };
}

const PREF_KEY = 'warpweft-timetable-preview-v1';
const LEGACY_KEY = 'warpweft-adjust-date';

test('preview preferences round-trip and normalize the week parity', async () => {
  const { savePreviewPrefs, readPreviewPrefs } = await loadPreview();
  const storage = memoryStorage();
  savePreviewPrefs(storage, {
    view: 'teacher',
    entityId: 't1',
    weekFilter: 'odd',
    weekNo: 4,
    overlayDate: '2026-09-16',
  });
  const prefs = readPreviewPrefs(storage);
  assert.deepEqual(prefs, {
    view: 'teacher',
    entityId: 't1',
    weekFilter: 'even',
    weekNo: 4,
    overlayDate: '2026-09-16',
  });
});

test('missing or corrupt preferences fall back to safe defaults', async () => {
  const { readPreviewPrefs } = await loadPreview();
  assert.deepEqual(readPreviewPrefs(memoryStorage()), {
    view: 'class',
    entityId: '',
    weekFilter: 'all',
    weekNo: null,
    overlayDate: '',
  });

  const corrupt = memoryStorage({ [PREF_KEY]: '{not-json' });
  assert.equal(readPreviewPrefs(corrupt).view, 'class');
  assert.equal(readPreviewPrefs(corrupt).overlayDate, '');

  const invalid = memoryStorage({
    [PREF_KEY]: JSON.stringify({
      version: 1,
      view: 'school',
      entityId: 42,
      weekFilter: 'odd',
      weekNo: -3,
      overlayDate: '2026-02-30',
    }),
  });
  assert.deepEqual(readPreviewPrefs(invalid), {
    view: 'class',
    entityId: '',
    weekFilter: 'odd',
    weekNo: null,
    overlayDate: '',
  });
});

test('legacy overlay date migrates once and clearing it does not bring it back', async () => {
  const { savePreviewPrefs, readPreviewPrefs } = await loadPreview();
  const legacy = memoryStorage({ [LEGACY_KEY]: '2026-09-16' });
  assert.equal(readPreviewPrefs(legacy).overlayDate, '2026-09-16');

  savePreviewPrefs(legacy, {
    view: 'class',
    entityId: '',
    weekFilter: 'all',
    weekNo: null,
    overlayDate: '',
  });
  assert.equal(readPreviewPrefs(legacy).overlayDate, '');
});

test('storage failures never break the page', async () => {
  const { savePreviewPrefs, readPreviewPrefs } = await loadPreview();
  const broken = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('full');
    },
  };
  assert.equal(readPreviewPrefs(broken).view, 'class');
  assert.doesNotThrow(() =>
    savePreviewPrefs(broken, {
      view: 'class',
      entityId: '',
      weekFilter: 'all',
      weekNo: null,
      overlayDate: '',
    }),
  );
});

test('header dates follow the selected week for a Monday-start term', async () => {
  const { weekDatesForHeader } = await loadPreview();
  const semester = { startDate: '2026-09-07', endDate: '2026-10-02' };
  const dates = weekDatesForHeader(semester, { weekNo: 2, overlayDate: '', today: '2026-09-01' });
  assert.equal(dates[1], '2026-09-14');
  assert.equal(dates[2], '2026-09-15');
  assert.equal(dates[3], '2026-09-16');
  assert.equal(dates[4], '2026-09-17');
  assert.equal(dates[5], '2026-09-18');
});

test('an overlay date wins over the selected week', async () => {
  const { weekDatesForHeader } = await loadPreview();
  const semester = { startDate: '2026-09-07', endDate: '2026-10-02' };
  const dates = weekDatesForHeader(semester, { weekNo: 1, overlayDate: '2026-09-16', today: '2026-09-01' });
  assert.equal(dates[1], '2026-09-14');
  assert.equal(dates[3], '2026-09-16');
});

test('a mid-week term shows an ordered week and hides the pre-term Monday', async () => {
  const { weekDatesForHeader } = await loadPreview();
  const semester = { startDate: '2026-09-01', endDate: '2026-09-30' };
  const dates = weekDatesForHeader(semester, { weekNo: 1, overlayDate: '', today: '2026-09-01' });
  // Week 1 starts Tuesday; its Monday (08-31) is before the term and is omitted.
  assert.equal(dates[1], undefined);
  assert.equal(dates[2], '2026-09-01');
  assert.equal(dates[3], '2026-09-02');
  assert.equal(dates[4], '2026-09-03');
  assert.equal(dates[5], '2026-09-04');
  assert.equal(dates[6], '2026-09-05');
});

test('an overlaid Monday shows its own calendar week', async () => {
  const { weekDatesForHeader } = await loadPreview();
  const semester = { startDate: '2026-09-01', endDate: '2027-01-20' };
  const dates = weekDatesForHeader(semester, { weekNo: 8, overlayDate: '2026-10-26', today: '2026-10-23' });
  assert.equal(dates[1], '2026-10-26');
  assert.equal(dates[2], '2026-10-27');
  assert.equal(dates[5], '2026-10-30');
});

test('fallbacks cover an unknown week, an out-of-term today and a clipped last week', async () => {
  const { weekDatesForHeader } = await loadPreview();
  const semester = { startDate: '2026-09-07', endDate: '2026-09-30' };

  const unknownWeek = weekDatesForHeader(semester, { weekNo: 99, overlayDate: '', today: '2026-09-23' });
  assert.equal(unknownWeek[1], '2026-09-21');

  const beforeTerm = weekDatesForHeader(semester, { weekNo: null, overlayDate: '', today: '2026-08-01' });
  assert.equal(beforeTerm[1], '2026-09-07');

  const clipped = weekDatesForHeader(
    { startDate: '2026-09-07', endDate: '2026-09-11' },
    { weekNo: 1, overlayDate: '', today: '2026-09-08' },
  );
  assert.equal(clipped[5], '2026-09-11');
  assert.equal(clipped[6], undefined);
  assert.equal(clipped[7], undefined);
});

test('no semester means no header dates', async () => {
  const { weekDatesForHeader } = await loadPreview();
  assert.deepEqual(weekDatesForHeader(null, { weekNo: 1, overlayDate: '', today: '2026-09-08' }), {});
  assert.deepEqual(weekDatesForHeader({ startDate: '', endDate: '' }, { weekNo: null, overlayDate: '', today: '' }), {});
});
