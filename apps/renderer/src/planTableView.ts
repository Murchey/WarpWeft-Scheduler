import type { CoursePlan, SchoolData, TimeSlot } from './types';
import { consecutiveOf, fixedSlotIdsOf } from '../../../packages/contracts/src.ts';

/** Column keys are stable; widths are persisted by key, never by position. */
export type PlanColumnKey =
  | 'classId'
  | 'subjectId'
  | 'teacherId'
  | 'weeklyPeriods'
  | 'constraints'
  | 'weeks'
  | 'kind'
  | 'roomType'
  | 'fixed'
  | 'consecutive'
  | 'pairId'
  | 'actions';

export interface PlanColumnDef {
  key: PlanColumnKey;
  label: string;
  minWidth: number;
  defaultWidth: number;
  required?: boolean;
  defaultVisible: boolean;
  sortable?: boolean;
  align?: 'left' | 'right';
}

export const PLAN_COLUMNS: PlanColumnDef[] = [
  { key: 'classId', label: '班级', minWidth: 108, defaultWidth: 124, required: true, defaultVisible: true, sortable: true },
  { key: 'subjectId', label: '学科', minWidth: 82, defaultWidth: 96, required: true, defaultVisible: true, sortable: true },
  { key: 'teacherId', label: '教师', minWidth: 96, defaultWidth: 112, required: true, defaultVisible: true, sortable: true },
  { key: 'weeklyPeriods', label: '每周课时', minWidth: 72, defaultWidth: 84, required: true, defaultVisible: true, sortable: true, align: 'right' },
  { key: 'constraints', label: '约束', minWidth: 150, defaultWidth: 210, required: true, defaultVisible: true },
  { key: 'weeks', label: '周次', minWidth: 72, defaultWidth: 82, defaultVisible: false },
  { key: 'kind', label: '课程类型', minWidth: 88, defaultWidth: 104, defaultVisible: false },
  { key: 'roomType', label: '教室类型', minWidth: 96, defaultWidth: 112, defaultVisible: false },
  { key: 'fixed', label: '固定时间', minWidth: 130, defaultWidth: 172, defaultVisible: false },
  { key: 'consecutive', label: '连堂', minWidth: 56, defaultWidth: 64, defaultVisible: false, align: 'right' },
  { key: 'pairId', label: '配对组', minWidth: 90, defaultWidth: 116, defaultVisible: false },
  { key: 'actions', label: '操作', minWidth: 92, defaultWidth: 104, required: true, defaultVisible: true },
];

export const PLAN_COLUMN_BY_KEY = new Map(PLAN_COLUMNS.map((column) => [column.key, column]));

export type PlanDensity = 'compact' | 'standard';
export type PlanHeight = 'standard' | 'tall';
export type PlanTab = 'detail' | 'summary';

export interface PlanColumnView {
  visible: boolean;
  width?: number;
}

export interface PlanTableView {
  version: 2;
  columns: Record<PlanColumnKey, PlanColumnView>;
  density: PlanDensity;
  height: PlanHeight;
  tab: PlanTab;
  pageSize: number;
}

export const PLAN_VIEW_KEY = 'warpweft.plans.view.v2';
export const LEGACY_PLAN_VIEW_KEYS = ['warpweft.plans.columnWidths.v1', 'warpweft.plans.panelSize.v1'];

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

const PAGE_SIZES = [50, 100, 200];
export const KIND_LABELS: Record<string, string> = {
  regular: '常规',
  morning: '早读',
  study: '自习',
  aftercare: '课后服务',
  evening: '晚自习',
  makeup: '补课',
};
const WEEK_LABELS: Record<string, string> = { all: '每周', odd: '单周', even: '双周' };

export function defaultPlanView(): PlanTableView {
  const columns = {} as Record<PlanColumnKey, PlanColumnView>;
  for (const column of PLAN_COLUMNS) {
    columns[column.key] = { visible: column.defaultVisible };
  }
  return { version: 2, columns, density: 'standard', height: 'standard', tab: 'detail', pageSize: 50 };
}

function clampWidth(value: unknown, column: PlanColumnDef): number | undefined {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.max(column.minWidth, Math.min(800, Math.round(number)));
}

export function normalizePlanView(raw: unknown): PlanTableView {
  const base = defaultPlanView();
  if (!raw || typeof raw !== 'object') return base;
  const source = raw as Partial<PlanTableView> & { columns?: Record<string, unknown> };
  const columns = {} as Record<PlanColumnKey, PlanColumnView>;
  for (const column of PLAN_COLUMNS) {
    const item = source.columns && typeof source.columns === 'object' ? source.columns[column.key] : undefined;
    const view = item && typeof item === 'object' ? (item as PlanColumnView) : undefined;
    columns[column.key] = {
      visible: column.required ? true : view?.visible === true,
      ...(view?.width !== undefined ? { width: clampWidth(view.width, column) } : {}),
    };
  }
  return {
    version: 2,
    columns,
    density: source.density === 'compact' ? 'compact' : 'standard',
    height: source.height === 'tall' ? 'tall' : 'standard',
    tab: source.tab === 'summary' ? 'summary' : 'detail',
    pageSize: PAGE_SIZES.includes(Number(source.pageSize)) ? Number(source.pageSize) : 50,
  };
}

export function loadPlanView(storage?: StorageLike | null): PlanTableView {
  const target = storage === undefined ? (typeof window === 'undefined' ? null : window.localStorage) : storage;
  if (!target) return defaultPlanView();
  try {
    for (const key of LEGACY_PLAN_VIEW_KEYS) target.removeItem(key);
    const raw = target.getItem(PLAN_VIEW_KEY);
    return raw ? normalizePlanView(JSON.parse(raw)) : defaultPlanView();
  } catch {
    return defaultPlanView();
  }
}

export function savePlanView(view: PlanTableView, storage?: StorageLike | null): void {
  const target = storage === undefined ? (typeof window === 'undefined' ? null : window.localStorage) : storage;
  if (!target) return;
  try {
    target.setItem(PLAN_VIEW_KEY, JSON.stringify(view));
    for (const key of LEGACY_PLAN_VIEW_KEYS) target.removeItem(key);
  } catch {
    // Private windows may reject storage; the in-memory view still works.
  }
}

export function resetPlanView(storage?: StorageLike | null): PlanTableView {
  const target = storage === undefined ? (typeof window === 'undefined' ? null : window.localStorage) : storage;
  try {
    target?.removeItem(PLAN_VIEW_KEY);
  } catch {
    // Ignore storage failures.
  }
  return defaultPlanView();
}

export interface PlanLookups {
  classById: Map<string, { id: string; name: string; grade?: string }>;
  subjectById: Map<string, { id: string; name: string }>;
  teacherById: Map<string, { id: string; name: string }>;
  slotById: Map<string, TimeSlot>;
}

export function planLookups(data: SchoolData): PlanLookups {
  return {
    classById: new Map(data.classes.map((item) => [item.id, item])),
    subjectById: new Map(data.subjects.map((item) => [item.id, item])),
    teacherById: new Map(data.teachers.map((item) => [item.id, item])),
    slotById: new Map(data.timeSlots.map((item) => [item.id, item])),
  };
}

export function planFixedLabels(plan: CoursePlan, lookups: PlanLookups): string[] {
  return fixedSlotIdsOf(plan).map((slotId) => lookups.slotById.get(slotId)?.label ?? slotId);
}

export interface PlanBadge {
  key: string;
  label: string;
  tone?: 'muted' | 'accent';
}

export function planConstraintSummary(plan: CoursePlan, lookups: PlanLookups): PlanBadge[] {
  const badges: PlanBadge[] = [];
  const fixedCount = fixedSlotIdsOf(plan).length;
  if (fixedCount > 0) badges.push({ key: 'fixed', label: '固定 ' + fixedCount });
  const consecutive = consecutiveOf(plan);
  if (consecutive >= 2) badges.push({ key: 'consecutive', label: '连堂 ' + consecutive });
  if (plan.pairId) badges.push({ key: 'pair', label: '配对 ' + plan.pairId });
  const weeks = plan.weeks ?? 'all';
  if (weeks !== 'all') badges.push({ key: 'weeks', label: WEEK_LABELS[weeks] });
  const kind = plan.kind ?? 'regular';
  if (kind !== 'regular') badges.push({ key: 'kind', label: KIND_LABELS[kind] ?? kind });
  if (plan.roomType) badges.push({ key: 'room', label: plan.roomType });
  return badges;
}

export interface PlanFilters {
  query: string;
  grade: string;
  classId: string;
  subjectId: string;
  weeks: '' | 'all' | 'odd' | 'even';
  teacherUnset: boolean;
}

export const EMPTY_PLAN_FILTERS: PlanFilters = {
  query: '',
  grade: '',
  classId: '',
  subjectId: '',
  weeks: '',
  teacherUnset: false,
};

export function planSearchText(plan: CoursePlan, lookups: PlanLookups): string {
  return [
    lookups.classById.get(plan.classId)?.name,
    lookups.subjectById.get(plan.subjectId)?.name,
    lookups.teacherById.get(plan.teacherId)?.name,
    plan.teacherId ? '' : '未指定教师',
    plan.pairId,
    plan.roomType,
    KIND_LABELS[plan.kind ?? 'regular'],
    WEEK_LABELS[plan.weeks ?? 'all'],
    planFixedLabels(plan, lookups).join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function filterPlans(plans: CoursePlan[], lookups: PlanLookups, filters: PlanFilters): CoursePlan[] {
  const query = filters.query.trim().toLowerCase();
  return plans.filter((plan) => {
    if (filters.classId && plan.classId !== filters.classId) return false;
    if (filters.subjectId && plan.subjectId !== filters.subjectId) return false;
    if (filters.weeks && (plan.weeks ?? 'all') !== filters.weeks) return false;
    if (filters.teacherUnset && plan.teacherId) return false;
    if (filters.grade) {
      const grade = lookups.classById.get(plan.classId)?.grade?.trim() || '未分年级';
      if (grade !== filters.grade) return false;
    }
    if (query && !planSearchText(plan, lookups).includes(query)) return false;
    return true;
  });
}

export type PlanSortKey = 'classId' | 'subjectId' | 'teacherId' | 'weeklyPeriods';

export interface PlanSort {
  key: PlanSortKey | null;
  dir: 'asc' | 'desc';
}

export const EMPTY_PLAN_SORT: PlanSort = { key: null, dir: 'asc' };

export function sortPlans(plans: CoursePlan[], sort: PlanSort, lookups: PlanLookups): CoursePlan[] {
  if (!sort.key) return plans;
  const order = new Map(plans.map((plan, index) => [plan.id, index]));
  const valueOf = (plan: CoursePlan): string | number => {
    if (sort.key === 'weeklyPeriods') return Number(plan.weeklyPeriods) || 0;
    if (sort.key === 'classId') return lookups.classById.get(plan.classId)?.name ?? plan.classId;
    if (sort.key === 'subjectId') return lookups.subjectById.get(plan.subjectId)?.name ?? plan.subjectId;
    return lookups.teacherById.get(plan.teacherId)?.name ?? (plan.teacherId ? plan.teacherId : '未指定教师');
  };
  return [...plans].sort((a, b) => {
    const left = valueOf(a);
    const right = valueOf(b);
    const compared = typeof left === 'number' && typeof right === 'number'
      ? left - right
      : String(left).localeCompare(String(right), 'zh-CN');
    if (compared !== 0) return sort.dir === 'asc' ? compared : -compared;
    return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  });
}

export interface PlanPage {
  items: CoursePlan[];
  page: number;
  pageCount: number;
  total: number;
  start: number;
  end: number;
}

export function paginatePlans(plans: CoursePlan[], page: number, pageSize: number): PlanPage {
  const size = PAGE_SIZES.includes(pageSize) ? pageSize : 50;
  const total = plans.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Number(page) || 1), pageCount);
  const start = (current - 1) * size;
  const end = Math.min(total, start + size);
  return { items: plans.slice(start, end), page: current, pageCount, total, start, end };
}

