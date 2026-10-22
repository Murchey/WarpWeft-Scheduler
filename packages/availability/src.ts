export interface AvailabilityEntry {
  teacherId: string;
  slotId: string;
}

export interface AvailabilityResult<T extends AvailabilityEntry> {
  next: T[];
  added: number;
  removed: number;
  unchanged: number;
}

/**
 * Apply a batch "unavailable" / "available" operation over the cartesian
 * product of teachers × time slots.
 *
 * - Set semantics: applying the same batch twice never duplicates entries.
 * - Existing entries keep their original position/identity (important when the
 *   persistence layer later adds fields such as reason or createdAt).
 * - `unchanged` counts pairs that already matched the requested state.
 */
export function applyAvailability<T extends AvailabilityEntry>(
  current: T[],
  teacherIds: string[],
  slotIds: string[],
  mode: 'block' | 'unblock',
): AvailabilityResult<T> {
  const wanted = new Set(teacherIds);
  const wantedSlots = new Set(slotIds);
  const key = (entry: AvailabilityEntry) => entry.teacherId + '|' + entry.slotId;
  const existing = new Set(current.filter((entry) => wanted.has(entry.teacherId) && wantedSlots.has(entry.slotId)).map(key));

  let added = 0;
  let removed = 0;
  let unchanged = 0;
  const next: T[] = [];

  for (const entry of current) {
    if (!wanted.has(entry.teacherId) || !wantedSlots.has(entry.slotId)) {
      next.push(entry);
      continue;
    }
    if (mode === 'block') {
      next.push(entry);
      unchanged += 1;
    } else {
      removed += 1;
    }
  }

  if (mode === 'block') {
    for (const teacherId of teacherIds) {
      for (const slotId of slotIds) {
        if (existing.has(teacherId + '|' + slotId)) continue;
        next.push({ teacherId, slotId } as T);
        added += 1;
      }
    }
  }

  return { next, added, removed, unchanged };
}
