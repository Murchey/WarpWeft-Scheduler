import { formatIsoDate, parseIsoDate, semesterWeeks } from '../../../packages/semester/src.ts';
import type { Semester } from '../../../packages/semester/src.ts';

export type PreviewView = 'class' | 'teacher' | 'room';
export type PreviewWeekFilter = 'all' | 'odd' | 'even';

export interface TimetablePreviewPrefs {
  view: PreviewView;
  entityId: string;
  weekFilter: PreviewWeekFilter;
  weekNo: number | null;
  overlayDate: string;
}

/** Versioned so a future shape change can be migrated without guessing. */
export const PREVIEW_STORAGE_KEY = 'warpweft-timetable-preview-v1';
/** Old single-purpose key; read once as a migration fallback. */
export const LEGACY_OVERLAY_KEY = 'warpweft-adjust-date';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const DEFAULT_PREFS: TimetablePreviewPrefs = {
  view: 'class',
  entityId: '',
  weekFilter: 'all',
  weekNo: null,
  overlayDate: '',
};

const DAY_MS = 24 * 60 * 60 * 1000;

function viewOf(value: unknown): PreviewView | null {
  return value === 'class' || value === 'teacher' || value === 'room' ? value : null;
}

function filterOf(value: unknown): PreviewWeekFilter | null {
  return value === 'all' || value === 'odd' || value === 'even' ? value : null;
}

function dateOf(value: unknown): string {
  return typeof value === 'string' && parseIsoDate(value) ? value : '';
}

function weekNoOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

export function readPreviewPrefs(storage: StorageLike | null | undefined): TimetablePreviewPrefs {
  try {
    if (!storage) return { ...DEFAULT_PREFS };
    const raw = storage.getItem(PREVIEW_STORAGE_KEY);
    if (!raw) {
      // First run after the upgrade: keep the date the old overlay control stored.
      return { ...DEFAULT_PREFS, overlayDate: dateOf(storage.getItem(LEGACY_OVERLAY_KEY)) };
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...DEFAULT_PREFS };
    }
    const value = parsed as Record<string, unknown>;
    const weekNo = weekNoOf(value.weekNo);
    return {
      view: viewOf(value.view) ?? DEFAULT_PREFS.view,
      entityId: typeof value.entityId === 'string' ? value.entityId : '',
      // A specific week is always single or double; ignore a contradictory stored filter.
      weekFilter: weekNo ? (weekNo % 2 === 1 ? 'odd' : 'even') : (filterOf(value.weekFilter) ?? 'all'),
      weekNo,
      // The new key is authoritative even when the date is empty: clearing the
      // overlay must not be undone by the stale legacy key.
      overlayDate: dateOf(value.overlayDate),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePreviewPrefs(
  storage: StorageLike | null | undefined,
  prefs: TimetablePreviewPrefs,
): void {
  if (!storage) return;
  try {
    storage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify({ version: 1, ...prefs }));
  } catch {
    // A full/disabled localStorage must not break timetable preview.
  }
}

function weekdayOfDate(date: Date): number {
  return ((date.getUTCDay() + 6) % 7) + 1;
}

/**
 * Dates for the weekday column headers, as a normal Monday–Sunday week.
 *
 * The reference date is the overlay date when one is active (so the overlaid
 * weekday always shows its real date), then the start of the selected school
 * week, then today if it is inside the term, then week 1. Dates outside the
 * term are omitted: a term that starts on Tuesday should not show a pre-term
 * Monday. Returns no dates when the semester is not configured.
 */
export function weekDatesForHeader(
  semester: Semester | null | undefined,
  options: { weekNo: number | null; overlayDate: string; today: string },
): Record<number, string> {
  const weeks = semesterWeeks(semester);
  if (weeks.length === 0) return {};
  const start = parseIsoDate(semester?.startDate ?? '');
  const end = parseIsoDate(semester?.endDate ?? '');
  if (!start || !end) return {};
  const inTerm = (date: Date) => date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
  const overlay = parseIsoDate(options.overlayDate);
  const selectedWeek =
    options.weekNo === null ? null : weeks.find((week) => week.index === options.weekNo) ?? null;
  const today = parseIsoDate(options.today);
  const reference =
    (overlay ? options.overlayDate : '') ||
    selectedWeek?.startDate ||
    (today && inTerm(today) ? options.today : '') ||
    weeks[0].startDate;
  const date = parseIsoDate(reference);
  if (!date) return {};
  const monday = new Date(date.getTime() - (weekdayOfDate(date) - 1) * DAY_MS);
  const dates: Record<number, string> = {};
  for (let offset = 0; offset < 7; offset += 1) {
    const current = new Date(monday.getTime() + offset * DAY_MS);
    if (!inTerm(current)) continue;
    dates[weekdayOfDate(current)] = formatIsoDate(current);
  }
  return dates;
}
