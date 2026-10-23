import { effectiveEntries, effectiveAdjustments, weekdayOf } from '../../../packages/adjustments/src.ts';
import type { Adjustment, AdjustmentEntry } from '../../../packages/adjustments/src.ts';
import type { SchoolData } from './types';

export interface ImpactChange {
  entryId: string;
  action: 'moved' | 'substituted' | 'added' | 'removed' | 'room';
  beforeSlotId?: string;
  afterSlotId?: string;
  beforeTeacherId?: string;
  afterTeacherId?: string;
  beforeRoomId?: string;
  afterRoomId?: string;
}

export interface AdjustmentImpact {
  date: string;
  type: Adjustment['type'];
  classId: string;
  teacherIds: string[];
  slotIds: string[];
  classBefore: AdjustmentEntry[];
  classAfter: AdjustmentEntry[];
  teacherBefore: AdjustmentEntry[];
  teacherAfter: AdjustmentEntry[];
  changes: ImpactChange[];
}

function entryMap(entries: AdjustmentEntry[]): Map<string, AdjustmentEntry> {
  return new Map(entries.map((entry) => [entry.id, entry]));
}

function changesBetween(before: AdjustmentEntry[], after: AdjustmentEntry[]): ImpactChange[] {
  const beforeMap = entryMap(before);
  const afterMap = entryMap(after);
  const ids = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const changes: ImpactChange[] = [];
  for (const id of ids) {
    const oldEntry = beforeMap.get(id);
    const newEntry = afterMap.get(id);
    if (!oldEntry) {
      changes.push({ entryId: id, action: 'added', afterSlotId: newEntry?.slotId, afterTeacherId: newEntry?.teacherId, afterRoomId: newEntry?.roomId });
      continue;
    }
    if (!newEntry) {
      changes.push({ entryId: id, action: 'removed', beforeSlotId: oldEntry.slotId, beforeTeacherId: oldEntry.teacherId, beforeRoomId: oldEntry.roomId });
      continue;
    }
    const slotChanged = oldEntry.slotId !== newEntry.slotId;
    const teacherChanged = oldEntry.teacherId !== newEntry.teacherId;
    const roomChanged = oldEntry.roomId !== newEntry.roomId;
    if (slotChanged || teacherChanged || roomChanged) {
      changes.push({
        entryId: id,
        action: teacherChanged ? 'substituted' : roomChanged && !slotChanged ? 'room' : 'moved',
        beforeSlotId: oldEntry.slotId,
        afterSlotId: newEntry.slotId,
        beforeTeacherId: oldEntry.teacherId,
        afterTeacherId: newEntry.teacherId,
        beforeRoomId: oldEntry.roomId,
        afterRoomId: newEntry.roomId,
      });
    }
  }
  return changes;
}

/**
 * Compare the actual day timetable before and after one adjustment. The caller
 * passes the candidate entries plus the full adjustment list on each side; this
 * keeps the calculation independent from React and testable in node --test.
 */
export function buildAdjustmentImpact(
  data: SchoolData,
  date: string,
  beforeAdjustments: Adjustment[],
  afterAdjustments: Adjustment[],
  entries: AdjustmentEntry[],
): AdjustmentImpact | null {
  const weekday = weekdayOf(date);
  if (!weekday) return null;
  const source = { ...data, entries };
  const before = (effectiveEntries(source, date, beforeAdjustments) as AdjustmentEntry[]).filter(
    (entry) => data.timeSlots.find((slot) => slot.id === entry.slotId)?.day === weekday,
  );
  const after = (effectiveEntries(source, date, afterAdjustments) as AdjustmentEntry[]).filter(
    (entry) => data.timeSlots.find((slot) => slot.id === entry.slotId)?.day === weekday,
  );
  const changes = changesBetween(before, after);
  if (changes.length === 0) return null;
  const changed = new Set(changes.map((change) => change.entryId));
  const beforeChanged = before.filter((entry) => changed.has(entry.id));
  const afterChanged = after.filter((entry) => changed.has(entry.id));
  const classId = beforeChanged[0]?.classId ?? afterChanged[0]?.classId ?? '';
  const teacherIds = Array.from(
    new Set(
      [...beforeChanged, ...afterChanged].map((entry) => entry.teacherId).filter(Boolean),
    ),
  );
  const slotIds = Array.from(
    new Set(
      changes.flatMap((change) => [change.beforeSlotId, change.afterSlotId]).filter((slot): slot is string => Boolean(slot)),
    ),
  );
  const active = effectiveAdjustments(afterAdjustments, date);
  const latest = active[active.length - 1];
  return {
    date,
    type: latest?.type ?? 'move',
    classId,
    teacherIds,
    slotIds,
    classBefore: before.filter((entry) => entry.classId === classId),
    classAfter: after.filter((entry) => entry.classId === classId),
    teacherBefore: before.filter((entry) => teacherIds.includes(entry.teacherId)),
    teacherAfter: after.filter((entry) => teacherIds.includes(entry.teacherId)),
    changes,
  };
}
