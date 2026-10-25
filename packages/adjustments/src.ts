/**
 * Date-level adjustments on top of the weekly timetable: move a lesson, swap in
 * a substitute teacher, or cancel it for one specific date. The weekly template
 * is never mutated — adjustments are an overlay, which is what makes "下周三第
 * 2 节临时调课" expressible and auditable.
 *
 * No imports on purpose: the renderer, the API and the node tests all execute
 * this file as-is (Node ≥ 22.6 strips the types).
 */

export type AdjustmentType = 'move' | 'swap' | 'substitute' | 'cancel';

export interface Adjustment {
  id: string;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  type: AdjustmentType;
  /** The lesson's original slot. */
  slotId: string;
  classId: string;
  originalEntryId: string;
  /** For type=move: the slot the lesson moved to. For type=swap: the other lesson's slot. */
  targetSlotId?: string;
  /** For type=swap: the other lesson's date and entry (the date is the other side of the swap). */
  targetDate?: string;
  targetEntryId?: string;
  /** For type=substitute: the teacher who takes over. */
  substituteTeacherId?: string;
  /** Optional room change (move/substitute). */
  roomId?: string;
  reason?: string;
  createdBy?: string;
  createdAt: string;
  /** Set when an existing adjustment is retargeted in place. */
  updatedAt?: string;
  updatedBy?: string;
  status: 'active' | 'revoked';
  revokedAt?: string;
  revokedBy?: string;
}

export interface AdjustmentEntry {
  id: string;
  coursePlanId: string;
  classId: string;
  teacherId: string;
  roomId: string;
  slotId: string;
  source: string;
  locked: boolean;
  weeks?: string;
}

export interface AdjustmentData {
  timeSlots: { id: string; day: number; period: number; label: string }[];
  classes: { id: string; name: string }[];
  teachers: { id: string; name: string }[];
  /** Optional; used to name the room in conflict messages. */
  rooms?: { id: string; name: string }[];
  unavailableSlots?: { teacherId: string; slotId: string }[];
  adjustments?: Adjustment[];
}

export interface AdjustmentDraft {
  date: string;
  type: AdjustmentType;
  originalEntryId: string;
  targetSlotId?: string;
  targetDate?: string;
  targetEntryId?: string;
  substituteTeacherId?: string;
  roomId?: string;
  reason?: string;
  createdBy?: string;
}

export interface AdjustmentResult {
  ok: boolean;
  errors: string[];
}

/** JS weekday (0=Sunday) → timetable day number (1=Monday … 7=Sunday). */
export function weekdayOf(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return 0;
  const value = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(value.getTime())) return 0;
  const day = value.getDay();
  return day === 0 ? 7 : day;
}

export function activeAdjustments(adjustments: Adjustment[] | undefined, date: string): Adjustment[] {
  return (adjustments ?? []).filter((item) => item.status === 'active' && item.date === date);
}

/** The single active adjustment of one lesson on one date. */
export function activeAdjustmentOf(
  adjustments: Adjustment[] | undefined,
  date: string,
  originalEntryId: string,
): Adjustment | undefined {
  return (adjustments ?? []).find((item) => {
    if (item.status !== 'active') return false;
    if (item.type === 'swap') {
      const onDate = item.date === date || item.targetDate === date;
      return onDate && (item.originalEntryId === originalEntryId || item.targetEntryId === originalEntryId);
    }
    return item.date === date && item.originalEntryId === originalEntryId;
  });
}

/**
 * A move whose target is its own original slot. It changes nothing, so it must
 * never count as a change: old data may still contain such records, and the UI
 * keeps them visible only for cleanup.
 */
export function isNoopMove(adjustment: Adjustment): boolean {
  return adjustment.type === 'move' && (!adjustment.targetSlotId || adjustment.targetSlotId === adjustment.slotId);
}

/**
 * Active adjustments that actually change the day. Use this for counts, badges
 * and the effective timetable; keep activeAdjustments raw for the
 * one-adjustment-per-lesson rule.
 */
export function effectiveAdjustments(adjustments: Adjustment[] | undefined, date: string): Adjustment[] {
  return (adjustments ?? []).filter(
    (item) =>
      item.status === 'active' &&
      !isNoopMove(item) &&
      (item.date === date || (item.type === 'swap' && item.targetDate === date)),
  );
}

function slotDay(slots: AdjustmentData['timeSlots'], slotId: string): number {
  return slots.find((slot) => slot.id === slotId)?.day ?? 0;
}

function slotLabel(slots: AdjustmentData['timeSlots'], slotId: string): string {
  return slots.find((slot) => slot.id === slotId)?.label ?? slotId;
}

function classNameOf(data: AdjustmentData, classId: string): string {
  return data.classes.find((item) => item.id === classId)?.name ?? classId;
}

function teacherNameOf(data: AdjustmentData, teacherId: string): string {
  return data.teachers.find((item) => item.id === teacherId)?.name ?? teacherId;
}

/**
 * The timetable that actually happens on `date`: the base entries of that
 * weekday with every active adjustment applied in creation order.
 */
export function effectiveEntries(
  data: AdjustmentData & { entries: AdjustmentEntry[] },
  date: string,
  adjustments: Adjustment[] = data.adjustments ?? [],
): AdjustmentEntry[] {
  const weekday = weekdayOf(date);
  if (weekday === 0) return [];
  const active = effectiveAdjustments(adjustments, date)
    .slice()
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const result = new Map<string, AdjustmentEntry>();
  for (const entry of data.entries) {
    if (slotDay(data.timeSlots, entry.slotId) !== weekday) continue;
    result.set(entry.id, { ...entry });
  }
  const byId = new Map(data.entries.map((entry) => [entry.id, entry]));
  // Same-date operations first; cross-date swaps then move one lesson out and
  // the other lesson in, so both dates keep the class's single room.
  for (const adjustment of active) {
    if (adjustment.type === 'swap') continue;
    const entry = result.get(adjustment.originalEntryId);
    if (!entry) continue;
    if (adjustment.type === 'cancel') {
      result.delete(entry.id);
      continue;
    }
    if (adjustment.type === 'move' && adjustment.targetSlotId) {
      entry.slotId = adjustment.targetSlotId;
    }
    if (adjustment.type === 'substitute' && adjustment.substituteTeacherId) {
      entry.teacherId = adjustment.substituteTeacherId;
    }
    if (adjustment.roomId) entry.roomId = adjustment.roomId;
  }
  for (const adjustment of active) {
    if (adjustment.type !== 'swap' || !adjustment.targetEntryId || !adjustment.targetDate) continue;
    if (adjustment.date === date && adjustment.targetDate === date) {
      const left = result.get(adjustment.originalEntryId);
      const right = result.get(adjustment.targetEntryId);
      if (left && right) {
        const leftSlot = left.slotId;
        left.slotId = right.slotId;
        right.slotId = leftSlot;
      }
      continue;
    }
    if (adjustment.date === date) {
      const outgoing = result.get(adjustment.originalEntryId);
      const incoming = byId.get(adjustment.targetEntryId);
      if (!outgoing || !incoming) continue;
      result.delete(outgoing.id);
      result.set(incoming.id, { ...incoming, slotId: outgoing.slotId, roomId: outgoing.roomId });
    } else if (adjustment.targetDate === date) {
      const outgoing = result.get(adjustment.targetEntryId);
      const incoming = byId.get(adjustment.originalEntryId);
      if (!outgoing || !incoming) continue;
      result.delete(outgoing.id);
      result.set(incoming.id, { ...incoming, slotId: outgoing.slotId, roomId: outgoing.roomId });
    }
  }
  return Array.from(result.values());
}

/** Machine-readable reason why a target slot is unavailable. */
export type MoveBlockerCode =
  | 'no-target'
  | 'invalid-date'
  | 'other-day'
  | 'missing-entry'
  | 'existing-adjustment'
  | 'class-busy'
  | 'teacher-busy'
  | 'teacher-unavailable'
  | 'room-busy'
  | 'same-lesson'
  | 'class-mismatch'
  | 'target-date';

export interface MoveBlocker {
  code: MoveBlockerCode;
  text: string;
}

interface OccupancyBlocker {
  code: 'class-busy' | 'teacher-busy' | 'room-busy';
  text: string;
}

function occupancyBlockers(
  entries: AdjustmentEntry[],
  data: AdjustmentData,
  candidate: { classId: string; teacherId: string; roomId: string; slotId: string },
): OccupancyBlocker[] {
  const blockers: OccupancyBlocker[] = [];
  const seen = new Set<string>();
  const add = (blocker: OccupancyBlocker) => {
    const key = blocker.code + '|' + blocker.text;
    if (seen.has(key)) return;
    seen.add(key);
    blockers.push(blocker);
  };
  for (const entry of entries) {
    if (entry.slotId !== candidate.slotId) continue;
    if (entry.classId === candidate.classId) {
      add({ code: 'class-busy', text: classNameOf(data, entry.classId) + ' 在该时段已有课程' });
    }
    if (entry.teacherId === candidate.teacherId) {
      add({ code: 'teacher-busy', text: teacherNameOf(data, entry.teacherId) + ' 在该时段已有课程' });
    }
    if (candidate.roomId && entry.roomId === candidate.roomId) {
      const room = data.rooms?.find((item) => item.id === candidate.roomId)?.name;
      const occupant =
        classNameOf(data, entry.classId) +
        (entry.teacherId ? '（' + teacherNameOf(data, entry.teacherId) + '）' : '');
      add({
        code: 'room-busy',
        text: (room ? '教室「' + room + '」' : '教室') + '在该时段已被 ' + occupant + ' 占用',
      });
    }
  }
  return blockers;
}

function moveBlockers(
  data: AdjustmentData,
  weekday: number,
  base: AdjustmentEntry,
  effective: AdjustmentEntry[],
  targetSlotId: string,
  roomId: string,
): MoveBlocker[] {
  if (!targetSlotId) return [{ code: 'no-target', text: '请选择调课后的时间' }];
  if (slotDay(data.timeSlots, targetSlotId) !== weekday) {
    return [{ code: 'other-day', text: '调课目标必须与调整日期同一天' }];
  }
  const blockers: MoveBlocker[] = occupancyBlockers(
    effective.filter((entry) => entry.id !== base.id),
    data,
    { classId: base.classId, teacherId: base.teacherId, roomId, slotId: targetSlotId },
  );
  if ((data.unavailableSlots ?? []).some((item) => item.teacherId === base.teacherId && item.slotId === targetSlotId)) {
    blockers.push({ code: 'teacher-unavailable', text: teacherNameOf(data, base.teacherId) + ' 在目标时间不可用' });
  }
  return blockers;
}

function adjustmentTouchesDate(
  adjustments: Adjustment[],
  date: string,
  entryId: string,
): boolean {
  return adjustments.some((item) => {
    if (item.status !== 'active') return false;
    const onDate = item.date === date || (item.type === 'swap' && item.targetDate === date);
    return onDate && (item.originalEntryId === entryId || item.targetEntryId === entryId);
  });
}

export interface SwapPlan {
  kind: 'apply' | 'blocked';
  targetDate: string;
  targetEntryId: string;
  targetSlotId: string;
  blockers: MoveBlocker[];
}

/**
 * Validate swapping one lesson with another lesson of the same class on a
 * different date. A class normally has one fixed room, so the room is carried
 * with the class; the decision is based on the two teachers' availability and
 * the two days' schedules, not on room capacity.
 */
export function planSwap(
  data: AdjustmentData & { entries: AdjustmentEntry[] },
  input: {
    date: string;
    originalEntryId: string;
    targetDate: string;
    targetEntryId: string;
    adjustments?: Adjustment[];
  },
): SwapPlan {
  const adjustments = input.adjustments ?? data.adjustments ?? [];
  const targetDate = input.targetDate;
  const targetEntryId = input.targetEntryId;
  const empty: SwapPlan = { kind: 'blocked', targetDate, targetEntryId, targetSlotId: '', blockers: [] };
  const source = data.entries.find((entry) => entry.id === input.originalEntryId);
  if (!source) {
    return { ...empty, blockers: [{ code: 'missing-entry', text: '找不到这节课程，可能课表已更新' }] };
  }
  const target = data.entries.find((entry) => entry.id === targetEntryId);
  if (!target) {
    return { ...empty, blockers: [{ code: 'no-target', text: '请选择要与之对调的课程' }] };
  }
  const targetSlotId = target.slotId;
  const sourceWeekday = weekdayOf(input.date);
  const targetWeekday = weekdayOf(targetDate);
  if (!sourceWeekday || !targetWeekday) {
    return { ...empty, targetSlotId, blockers: [{ code: 'invalid-date', text: '日期格式无效（应为 YYYY-MM-DD）' }] };
  }
  if (targetDate < input.date) {
    return { ...empty, targetSlotId, blockers: [{ code: 'target-date', text: '对调目标必须晚于当前日期' }] };
  }
  if (targetDate === input.date) {
    return { ...empty, targetSlotId, blockers: [{ code: 'target-date', text: '对调目标必须是另一天' }] };
  }
  if (sourceWeekday === targetWeekday) {
    return { ...empty, targetSlotId, blockers: [{ code: 'target-date', text: '目标日期与所选日期同星期，周课表会重复；请选择不同星期的课程' }] };
  }
  if (source.id === target.id) {
    return { ...empty, targetSlotId, blockers: [{ code: 'same-lesson', text: '不能与同一节课对调' }] };
  }
  if (source.classId !== target.classId) {
    return { ...empty, targetSlotId, blockers: [{ code: 'class-mismatch', text: '只能与同一班级的课程对调' }] };
  }
  if (slotDay(data.timeSlots, source.slotId) !== sourceWeekday) {
    return { ...empty, targetSlotId, blockers: [{ code: 'invalid-date', text: '这节课程不在所选日期' }] };
  }
  if (slotDay(data.timeSlots, target.slotId) !== targetWeekday) {
    return { ...empty, targetSlotId, blockers: [{ code: 'invalid-date', text: '目标课程不在目标日期' }] };
  }
  if (!data.timeSlots.some((slot) => slot.day === targetWeekday)) {
    return { ...empty, targetSlotId, blockers: [{ code: 'invalid-date', text: '目标日期没有可用时间段' }] };
  }
  if (adjustmentTouchesDate(adjustments, input.date, source.id) || adjustmentTouchesDate(adjustments, targetDate, target.id)) {
    return { ...empty, targetSlotId, blockers: [{ code: 'existing-adjustment', text: '这两节课中至少一节当天已有调整，请先撤销原调整' }] };
  }

  const effectiveSource = effectiveEntries({ ...data, adjustments }, input.date, adjustments);
  const effectiveTarget = effectiveEntries({ ...data, adjustments }, targetDate, adjustments);
  if (!effectiveSource.some((entry) => entry.id === source.id) || !effectiveTarget.some((entry) => entry.id === target.id)) {
    return { ...empty, targetSlotId, blockers: [{ code: 'missing-entry', text: '这节课程当天不在课表中，无法对调' }] };
  }
  const sourceOthers = effectiveSource.filter((entry) => entry.id !== source.id);
  const targetOthers = effectiveTarget.filter((entry) => entry.id !== target.id);
  const blockers: MoveBlocker[] = [];
  const add = (code: MoveBlocker['code'], text: string) => {
    if (!blockers.some((item) => item.code === code && item.text === text)) blockers.push({ code, text });
  };
  if (sourceOthers.some((entry) => entry.slotId === source.slotId && entry.classId === source.classId)) {
    add('class-busy', classNameOf(data, source.classId) + ' 在该时段已有课程');
  }
  if (targetOthers.some((entry) => entry.slotId === target.slotId && entry.classId === source.classId)) {
    add('class-busy', classNameOf(data, source.classId) + ' 在目标时段已有课程');
  }
  if (targetOthers.some((entry) => entry.slotId === target.slotId && entry.teacherId === source.teacherId)) {
    add('teacher-busy', teacherNameOf(data, source.teacherId) + ' 在目标日期的目标时段已有课程');
  }
  if (sourceOthers.some((entry) => entry.slotId === source.slotId && entry.teacherId === target.teacherId)) {
    add('teacher-busy', teacherNameOf(data, target.teacherId) + ' 在原日期的原时段已有课程');
  }
  if ((data.unavailableSlots ?? []).some((item) => item.teacherId === source.teacherId && item.slotId === target.slotId)) {
    add('teacher-unavailable', teacherNameOf(data, source.teacherId) + ' 在目标时间不可用');
  }
  if ((data.unavailableSlots ?? []).some((item) => item.teacherId === target.teacherId && item.slotId === source.slotId)) {
    add('teacher-unavailable', teacherNameOf(data, target.teacherId) + ' 在原日期原时段不可用');
  }
  return { kind: blockers.length ? 'blocked' : 'apply', targetDate, targetEntryId, targetSlotId, blockers };
}

export type MovePlanKind = 'noop' | 'restore' | 'apply' | 'blocked';

export interface MovePlan {
  kind: MovePlanKind;
  targetSlotId: string;
  /** restore: the active move being reverted; apply: the active move being retargeted. */
  adjustment?: Adjustment;
  blockers: MoveBlocker[];
}

/**
 * Validate a draft against the base timetable, the other adjustments of that
 * day, unavailable slots and one-adjustment-per-lesson-per-day.
 */
export function validateAdjustment(
  data: AdjustmentData & { entries: AdjustmentEntry[] },
  draft: AdjustmentDraft,
  adjustments: Adjustment[] = data.adjustments ?? [],
): AdjustmentResult {
  const errors: string[] = [];
  const weekday = weekdayOf(draft.date);
  if (weekday === 0) errors.push('日期格式无效（应为 YYYY-MM-DD）');
  if (weekday > 0 && !data.timeSlots.some((slot) => slot.day === weekday)) {
    errors.push('这一天没有可用时间段（周' + weekday + '）');
  }
  const base = data.entries.find((entry) => entry.id === draft.originalEntryId);
  if (!base) {
    return { ok: false, errors: ['找不到这节课程，可能课表已更新'] };
  }
  if (draft.type === 'move' || draft.type === 'cancel' || draft.type === 'swap') {
    if (slotDay(data.timeSlots, base.slotId) !== weekday) errors.push('这节课程不在所选日期');
  }
  if (draft.type === 'substitute' && !draft.substituteTeacherId) errors.push('请选择代课教师');
  if (draft.type === 'swap') {
    if (!draft.targetDate) errors.push('请选择目标日期');
    if (!draft.targetEntryId) errors.push('请选择要对调的课程');
    if (draft.targetDate) {
      const targetWeekday = weekdayOf(draft.targetDate);
      if (!targetWeekday) errors.push('目标日期格式无效（应为 YYYY-MM-DD）');
      else if (!data.timeSlots.some((slot) => slot.day === targetWeekday)) errors.push('目标日期没有可用时间段');
    }
    if (draft.targetDate && draft.targetEntryId) {
      const plan = planSwap(
        { ...data, adjustments },
        {
          date: draft.date,
          originalEntryId: draft.originalEntryId,
          targetDate: draft.targetDate,
          targetEntryId: draft.targetEntryId,
          adjustments,
        },
      );
      if (plan.kind === 'blocked') errors.push(...plan.blockers.map((blocker) => blocker.text));
    }
    return { ok: errors.length === 0, errors: Array.from(new Set(errors)) };
  }

  const duplicate = activeAdjustmentOf(adjustments, draft.date, draft.originalEntryId);
  if (duplicate) errors.push('这节课程当天已有调整，请先撤销原调整');

  // Effective timetable of that day without the draft being created yet.
  const effective = effectiveEntries({ ...data, adjustments }, draft.date, adjustments);

  if (draft.type === 'cancel') {
    if (!effective.some((entry) => entry.id === base.id)) errors.push('这节课程当天已经被取消');
    return { ok: errors.length === 0, errors };
  }

  const roomId = draft.roomId ?? base.roomId;
  if (draft.type === 'move') {
    const targetSlotId = draft.targetSlotId;
    if (!targetSlotId) {
      errors.push('请选择调课后的时间');
    } else if (targetSlotId === base.slotId) {
      // A -> A changes nothing; it must never become an adjustment record.
      errors.push('目标时间与原时间相同，无需调课');
    } else {
      errors.push(...moveBlockers(data, weekday, base, effective, targetSlotId, roomId).map((blocker) => blocker.text));
    }
  }

  if (draft.type === 'substitute') {
    const teacherId = draft.substituteTeacherId;
    if (!teacherId) {
      errors.push('请选择代课教师');
    } else {
      if (teacherId === base.teacherId) errors.push('代课教师不能是原任课教师');
      if (!data.teachers.some((item) => item.id === teacherId)) errors.push('代课教师不存在');
      if ((data.unavailableSlots ?? []).some((item) => item.teacherId === teacherId && item.slotId === base.slotId)) {
        errors.push(teacherNameOf(data, teacherId) + ' 在该时段不可用');
      }
      errors.push(...occupancyBlockers(
        effective.filter((entry) => entry.id !== base.id),
        data,
        { classId: base.classId, teacherId, roomId, slotId: base.slotId },
      ).map((blocker) => blocker.text));
    }
  }

  return { ok: errors.length === 0, errors: Array.from(new Set(errors)) };
}

/**
 * Decide what dropping one lesson onto a slot means today:
 * - noop: it is already there (including legacy self-moves) -> write nothing;
 * - restore: the lesson was moved and the target is its original slot;
 * - apply: a free target (retargets the existing move when there is one);
 * - blocked: the target cannot take the lesson, with structured reasons.
 */
export function planMove(
  data: AdjustmentData & { entries: AdjustmentEntry[] },
  input: {
    date: string;
    originalEntryId: string;
    targetSlotId: string;
    adjustments?: Adjustment[];
  },
): MovePlan {
  const adjustments = input.adjustments ?? data.adjustments ?? [];
  const targetSlotId = input.targetSlotId;
  const base = data.entries.find((entry) => entry.id === input.originalEntryId);
  if (!base) {
    return {
      kind: 'blocked',
      targetSlotId,
      blockers: [{ code: 'missing-entry', text: '找不到这节课程，可能课表已更新' }],
    };
  }
  const weekday = weekdayOf(input.date);
  if (weekday === 0) {
    return {
      kind: 'blocked',
      targetSlotId,
      blockers: [{ code: 'invalid-date', text: '日期格式无效（应为 YYYY-MM-DD）' }],
    };
  }
  const active = activeAdjustmentOf(adjustments, input.date, base.id);
  if (active && active.type !== 'move') {
    return {
      kind: 'blocked',
      targetSlotId,
      adjustment: active,
      blockers: [
        {
          code: 'existing-adjustment',
          text: '这节课程当天已有' + ADJUSTMENT_LABELS[active.type] + '，请先撤销原调整',
        },
      ],
    };
  }
  const activeMove = active && active.type === 'move' ? active : undefined;
  const currentSlotId = activeMove?.targetSlotId ?? base.slotId;
  if (targetSlotId === currentSlotId) {
    return { kind: 'noop', targetSlotId, adjustment: activeMove, blockers: [] };
  }
  const withoutActive = activeMove
    ? adjustments.filter((item) => item.id !== activeMove.id)
    : adjustments;
  const effective = effectiveEntries({ ...data, adjustments: withoutActive }, input.date, withoutActive);
  if (targetSlotId === base.slotId) {
    if (!activeMove) return { kind: 'noop', targetSlotId, blockers: [] };
    // Another lesson may have moved into the original slot after this move.
    // Restoring is only legal when the original slot can take the lesson back.
    const restoreBlockers = moveBlockers(data, weekday, base, effective, targetSlotId, base.roomId);
    return restoreBlockers.length > 0
      ? { kind: 'blocked', targetSlotId, adjustment: activeMove, blockers: restoreBlockers }
      : { kind: 'restore', targetSlotId, adjustment: activeMove, blockers: [] };
  }
  const blockers = moveBlockers(data, weekday, base, effective, targetSlotId, base.roomId);
  if (blockers.length > 0) {
    return { kind: 'blocked', targetSlotId, adjustment: activeMove, blockers };
  }
  return { kind: 'apply', targetSlotId, adjustment: activeMove, blockers: [] };
}

/** Free teachers for a substitute pickup at a given slot on a date. */
export function substituteCandidates(
  data: AdjustmentData & { entries: AdjustmentEntry[] },
  date: string,
  originalEntryId: string,
  adjustments: Adjustment[] = data.adjustments ?? [],
): { id: string; name: string; unavailable: boolean; reason?: string }[] {
  const base = data.entries.find((entry) => entry.id === originalEntryId);
  if (!base) return [];
  const effective = effectiveEntries({ ...data, adjustments }, date, adjustments)
    .filter((entry) => entry.id !== base.id);
  return data.teachers.map((teacher) => {
    const same = teacher.id === base.teacherId;
    const busy = effective.some((entry) => entry.slotId === base.slotId && entry.teacherId === teacher.id);
    const unavailable = (data.unavailableSlots ?? []).some((item) => item.teacherId === teacher.id && item.slotId === base.slotId);
    const reason = same ? '原任课教师' : busy ? '该时段已有课' : unavailable ? '不可用时间' : '';
    return { id: teacher.id, name: teacher.name, unavailable: Boolean(reason), reason: reason || undefined };
  });
}

export interface AdjustmentSummary {
  total: number;
  move: number;
  swap: number;
  substitute: number;
  cancel: number;
  revoked: number;
  /** Active moves whose target is the original slot; they change nothing. */
  noop: number;
  /** Substitute lessons per teacher (counts only active adjustments). */
  substituteByTeacher: Record<string, number>;
}

export function summarizeAdjustments(adjustments: Adjustment[] | undefined): AdjustmentSummary {
  const summary: AdjustmentSummary = { total: 0, move: 0, swap: 0, substitute: 0, cancel: 0, revoked: 0, noop: 0, substituteByTeacher: {} };
  for (const adjustment of adjustments ?? []) {
    summary.total += 1;
    if (adjustment.status === 'revoked') {
      summary.revoked += 1;
      continue;
    }
    if (isNoopMove(adjustment)) {
      summary.noop += 1;
      continue;
    }
    summary[adjustment.type] += 1;
    if (adjustment.type === 'substitute' && adjustment.substituteTeacherId) {
      summary.substituteByTeacher[adjustment.substituteTeacherId] =
        (summary.substituteByTeacher[adjustment.substituteTeacherId] ?? 0) + 1;
    }
  }
  return summary;
}

export const ADJUSTMENT_LABELS: Record<AdjustmentType, string> = {
  move: '调课',
  swap: '对调',
  substitute: '代课',
  cancel: '停课',
};

// ---------------------------------------------------------------------------
// Clock helpers for the "today" view. A slot can only be "current" when it has
// a start time; otherwise the timetable stays a weekly template without a clock.
// ---------------------------------------------------------------------------

export interface TimedSlot {
  id: string;
  day: number;
  period: number;
  label: string;
  start?: string;
  duration?: number;
  kind?: string;
}

/** "HH:MM" → minutes since midnight, or null when unset/invalid. */
export function parseClock(value?: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function slotWindow(slot: TimedSlot): { start: number; end: number } | null {
  const start = parseClock(slot.start);
  if (start === null) return null;
  const duration = Number(slot.duration) > 0 ? Number(slot.duration) : 45;
  return { start, end: start + duration };
}

/** The slot that contains `minutesNow` on `day`, if any slot has a start time. */
export function currentSlot(slots: TimedSlot[], day: number, minutesNow: number): TimedSlot | null {
  const candidates = slots
    .filter((slot) => slot.day === day)
    .map((slot) => ({ slot, window: slotWindow(slot) }))
    .filter((item): item is { slot: TimedSlot; window: { start: number; end: number } } => item.window !== null)
    .sort((a, b) => a.window.start - b.window.start);
  return candidates.find((item) => minutesNow >= item.window.start && minutesNow < item.window.end)?.slot ?? null;
}

export function formatClock(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  return String(Math.floor(safe / 60)).padStart(2, '0') + ':' + String(safe % 60).padStart(2, '0');
}

/** Minutes since midnight in the browser's local time. */
export function minutesOfDay(date: Date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes();
}

// ---------------------------------------------------------------------------
// Actual lesson records (LessonLog). The weekly timetable plus the date's
// adjustments produce one row per lesson that was supposed to happen; a school
// can then confirm or annotate what actually happened.
// ---------------------------------------------------------------------------

export type LessonStatus = 'normal' | 'substituted' | 'moved' | 'cancelled';

export const LESSON_STATUS_LABELS: Record<LessonStatus, string> = {
  normal: '正常',
  substituted: '代课',
  moved: '调课',
  cancelled: '停课',
};

export interface LessonLog {
  id: string;
  date: string;
  /** The weekly-timetable entry this record belongs to. */
  entryId: string;
  coursePlanId: string;
  classId: string;
  subjectId: string;
  /** Where the lesson actually took place. */
  slotId: string;
  /** Who actually taught it. */
  teacherId: string;
  originalTeacherId: string;
  status: LessonStatus;
  note?: string;
  confirmed?: boolean;
  adjustmentId?: string;
  createdAt: string;
  updatedAt?: string;
  createdBy?: string;
}

export function lessonLogId(date: string, entryId: string): string {
  return 'log-' + date + '-' + entryId;
}

/**
 * One record per base lesson of that weekday, with move/substitute/cancel
 * already applied. Deterministic ids let a refresh update instead of duplicate.
 */
export function buildDayLogs(
  data: AdjustmentData & {
    coursePlans: { id: string; classId: string; subjectId: string; teacherId: string }[];
    entries: AdjustmentEntry[];
  },
  date: string,
  createdAt: string = new Date().toISOString(),
): LessonLog[] {
  const weekday = weekdayOf(date);
  if (weekday === 0) return [];
  const planById = new Map(data.coursePlans.map((plan) => [plan.id, plan]));
  const baseById = new Map(data.entries.map((entry) => [entry.id, entry]));
  const slotOrder = new Map(data.timeSlots.map((slot) => [slot.id, slot.day * 1000 + slot.period]));
  const effective = effectiveEntries(data, date);
  const effectiveById = new Map(effective.map((entry) => [entry.id, entry]));
  const logs: LessonLog[] = [];
  const logged = new Set<string>();
  const addLog = (entry: AdjustmentEntry, status: LessonStatus, adjustmentId?: string) => {
    const base = baseById.get(entry.id) ?? entry;
    const plan = planById.get(entry.coursePlanId);
    if (!plan || logged.has(entry.id)) return;
    logged.add(entry.id);
    logs.push({
      id: lessonLogId(date, entry.id),
      date,
      entryId: entry.id,
      coursePlanId: plan.id,
      classId: entry.classId,
      subjectId: plan.subjectId,
      slotId: entry.slotId,
      teacherId: entry.teacherId,
      originalTeacherId: base.teacherId,
      status,
      adjustmentId,
      createdAt,
    });
  };
  for (const base of data.entries) {
    const slot = data.timeSlots.find((item) => item.id === base.slotId);
    if (!slot || slot.day !== weekday) continue;
    const raw = activeAdjustmentOf(data.adjustments, date, base.id);
    const adjustment = raw && !isNoopMove(raw) ? raw : undefined;
    if (adjustment?.type === 'cancel') {
      addLog(base, 'cancelled', adjustment.id);
      continue;
    }
    if (adjustment?.type === 'swap' && adjustment.date === date && adjustment.targetDate !== date) {
      // This lesson leaves for the other date; it will be logged there as moved-in.
      continue;
    }
    const entry = effectiveById.get(base.id);
    if (!entry) continue;
    let status: LessonStatus = 'normal';
    if (adjustment?.type === 'move' || adjustment?.type === 'swap') status = 'moved';
    else if (adjustment?.type === 'substitute') status = 'substituted';
    addLog(entry, status, adjustment?.id);
  }
  for (const entry of effective) {
    if (logged.has(entry.id)) continue;
    const raw = activeAdjustmentOf(data.adjustments, date, entry.id);
    const adjustment = raw && !isNoopMove(raw) ? raw : undefined;
    addLog(entry, adjustment?.type === 'swap' ? 'moved' : 'normal', adjustment?.id);
  }
  return logs.sort((a, b) => (slotOrder.get(a.slotId) ?? 0) - (slotOrder.get(b.slotId) ?? 0));
}

/**
 * Keep manual edits (status/note/confirmed) but refresh the derived fields.
 * New lessons appear, disappeared lessons are dropped.
 */
export function mergeDayLogs(existing: LessonLog[], generated: LessonLog[], date: string): LessonLog[] {
  const byId = new Map(existing.filter((log) => log.date === date).map((log) => [log.id, log]));
  return generated.map((log) => {
    const previous = byId.get(log.id);
    if (!previous) return log;
    return {
      ...log,
      status: previous.status,
      note: previous.note,
      confirmed: previous.confirmed,
      updatedAt: previous.updatedAt,
      createdBy: previous.createdBy,
    };
  });
}

export interface ActualTeacherRow {
  teacherId: string;
  name: string;
  /** Lessons physically taught (normal + substituted + moved). */
  taught: number;
  /** Substituted lessons taught for someone else. */
  substitute: number;
  /** Own lessons that were covered by someone else. */
  covered: number;
  /** Own lessons cancelled. */
  cancelled: number;
  /** Own lessons moved to another slot (still taught). */
  moved: number;
}

export interface ActualStats {
  total: number;
  normal: number;
  substituted: number;
  moved: number;
  cancelled: number;
  confirmed: number;
  teachers: ActualTeacherRow[];
}

export function buildActualStats(
  logs: LessonLog[],
  teachers: { id: string; name: string }[],
  date?: string,
): ActualStats {
  const scoped = date ? logs.filter((log) => log.date === date) : logs;
  const rows = new Map<string, ActualTeacherRow>();
  const ensure = (teacherId: string): ActualTeacherRow => {
    const existing = rows.get(teacherId);
    if (existing) return existing;
    const row: ActualTeacherRow = {
      teacherId,
      name: teachers.find((item) => item.id === teacherId)?.name ?? teacherId,
      taught: 0,
      substitute: 0,
      covered: 0,
      cancelled: 0,
      moved: 0,
    };
    rows.set(teacherId, row);
    return row;
  };
  const stats: ActualStats = {
    total: scoped.length,
    normal: 0,
    substituted: 0,
    moved: 0,
    cancelled: 0,
    confirmed: 0,
    teachers: [],
  };
  for (const log of scoped) {
    stats[log.status] += 1;
    if (log.confirmed) stats.confirmed += 1;
    if (log.status !== 'cancelled') {
      ensure(log.teacherId).taught += 1;
    }
    if (log.status === 'substituted') {
      ensure(log.teacherId).substitute += 1;
      ensure(log.originalTeacherId).covered += 1;
    }
    if (log.status === 'moved') ensure(log.originalTeacherId).moved += 1;
    if (log.status === 'cancelled') ensure(log.originalTeacherId).cancelled += 1;
  }
  stats.teachers = Array.from(rows.values()).sort((a, b) => b.taught - a.taught || a.name.localeCompare(b.name, 'zh-CN'));
  return stats;
}

/** Human-readable one-liner used by the list and the CSV export. */
export function describeAdjustment(adjustment: Adjustment, data: AdjustmentData): string {
  const base = classNameOf(data, adjustment.classId) + ' ' + slotLabel(data.timeSlots, adjustment.slotId);
  if (adjustment.type === 'move') return base + ' → ' + slotLabel(data.timeSlots, adjustment.targetSlotId ?? '');
  if (adjustment.type === 'swap') {
    return base + ' ↔ ' + (adjustment.targetDate ?? '') + ' ' + slotLabel(data.timeSlots, adjustment.targetSlotId ?? '');
  }
  if (adjustment.type === 'substitute') return base + ' 由 ' + teacherNameOf(data, adjustment.substituteTeacherId ?? '') + ' 代课';
  return base + ' 停课';
}
