import type { ScheduleEntry, SchoolData, TimeSlot } from './types';
import { slotKindAcceptsPlan } from '../../../packages/inspection/src.ts';

export interface DropDecision {
  ok: boolean;
  reason: string;
}

export interface DropContext {
  data: SchoolData;
  entries: ScheduleEntry[];
  view: 'class' | 'teacher' | 'room';
  overlay?: boolean;
}

const weekMask = (value?: string): number => (value === 'odd' ? 1 : value === 'even' ? 2 : 3);
const weeksOverlap = (a?: string, b?: string): boolean => (weekMask(a) & weekMask(b)) !== 0;

function planFor(data: SchoolData, entry: ScheduleEntry) {
  return data.coursePlans.find((plan) => plan.id === entry.coursePlanId);
}

function groupFor(data: SchoolData, entry: ScheduleEntry) {
  return entry.groupId ? (data.electiveGroups ?? []).find((group) => group.id === entry.groupId) : undefined;
}

function weeksOf(data: SchoolData, entry: ScheduleEntry): string {
  return planFor(data, entry)?.weeks ?? entry.weeks ?? 'all';
}

function teacherUnavailable(data: SchoolData, teacherId: string, slotId: string): boolean {
  return (data.unavailableSlots ?? []).some((item) => item.teacherId === teacherId && item.slotId === slotId);
}

function occupiesClass(data: SchoolData, entry: ScheduleEntry, classId: string): boolean {
  if (entry.classId === classId) return true;
  if (!entry.groupId) return false;
  return Boolean(groupFor(data, entry)?.classIds.includes(classId));
}

function slotKindOf(slot: TimeSlot): string {
  return slot.kind ?? 'regular';
}

function clashesAt(ctx: DropContext, entry: ScheduleEntry, slot: TimeSlot, ignoreIds: Set<string>) {
  return ctx.entries.find(
    (other) =>
      !ignoreIds.has(other.id) &&
      other.slotId === slot.id &&
      weeksOverlap(weeksOf(ctx.data, other), weeksOf(ctx.data, entry)) &&
      (occupiesClass(ctx.data, other, entry.classId) ||
        other.teacherId === entry.teacherId ||
        other.roomId === entry.roomId),
  );
}

/** Can `entry` be dropped into the empty `slot`? */
export function checkMove(entry: ScheduleEntry, slot: TimeSlot, ctx: DropContext): DropDecision {
  if (ctx.overlay) return { ok: false, reason: '日期调整视图为只读' };
  if (ctx.view !== 'class') return { ok: false, reason: '只在班级视图移动' };
  if (entry.groupId) return { ok: false, reason: '走班课程由走班组统一安排' };
  if (entry.locked) return { ok: false, reason: '课程已锁定，先解锁再移动' };
  const plan = planFor(ctx.data, entry);
  if (plan?.fixedSlotId) {
    return plan.fixedSlotId === slot.id
      ? { ok: true, reason: '固定时间原位置' }
      : { ok: false, reason: '课程固定在其它时间' };
  }
  if (!slotKindAcceptsPlan(slotKindOf(slot), plan?.kind)) {
    return { ok: false, reason: '时段类型与课程不匹配' };
  }
  if (teacherUnavailable(ctx.data, entry.teacherId, slot.id)) {
    return { ok: false, reason: '教师在此时段不可用' };
  }
  const clash = clashesAt(ctx, entry, slot, new Set([entry.id]));
  if (!clash) return { ok: true, reason: '' };
  if (occupiesClass(ctx.data, clash, entry.classId)) return { ok: false, reason: '班级在此时段已有课' };
  if (clash.teacherId === entry.teacherId) return { ok: false, reason: '教师在此时段已有课' };
  return { ok: false, reason: '教室在此时段已被占用' };
}

/** Can two lessons in the same class swap their slots? */
export function checkSwap(a: ScheduleEntry, b: ScheduleEntry, ctx: DropContext): DropDecision {
  if (ctx.overlay) return { ok: false, reason: '日期调整视图为只读' };
  if (ctx.view !== 'class') return { ok: false, reason: '只在班级视图交换' };
  if (a.id === b.id) return { ok: false, reason: '同一节课' };
  if (a.groupId || b.groupId) return { ok: false, reason: '走班课程不能单独交换' };
  if (a.locked || b.locked) return { ok: false, reason: '锁定课程不能交换' };
  if (a.classId !== b.classId) return { ok: false, reason: '不同班级的课程不能交换' };
  if (a.coursePlanId === b.coursePlanId) return { ok: false, reason: '同一门课无需交换' };
  const planA = planFor(ctx.data, a);
  const planB = planFor(ctx.data, b);
  if (planA?.fixedSlotId || planB?.fixedSlotId) return { ok: false, reason: '固定时间课程不能交换' };
  const slotA = ctx.data.timeSlots.find((slot) => slot.id === a.slotId);
  const slotB = ctx.data.timeSlots.find((slot) => slot.id === b.slotId);
  if (!slotA || !slotB) return { ok: false, reason: '时间格不存在' };
  const reduced: DropContext = {
    ...ctx,
    entries: ctx.entries.filter((entry) => entry.id !== a.id && entry.id !== b.id),
    overlay: false,
  };
  const forward = checkMove(a, slotB, reduced);
  if (!forward.ok) return { ok: false, reason: '原课程无法进入目标时段：' + forward.reason };
  const backward = checkMove(b, slotA, reduced);
  if (!backward.ok) return { ok: false, reason: '目标课程无法进入原时段：' + backward.reason };
  return { ok: true, reason: '' };
}
