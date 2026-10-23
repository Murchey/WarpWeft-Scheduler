import type { Room, ScheduleEntry, SchoolData, SolverOutput } from './types';

/**
 * Many schools treat the room named "<class name>教室" as that class's fixed
 * homeroom. The importer creates exactly that room when the room sheet is
 * empty, but the solver only sees rooms as a shared capacity/type pool. This
 * helper restores the missing class -> room binding in three places:
 * - data loaded from the API,
 * - freshly solved candidates,
 * - locked entries sent back into the solver.
 *
 * Only regular plans (no roomType, or "普通教室") are pinned. Lessons that
 * explicitly ask for a special room type (lab, gym, ...) keep the solver's
 * assignment. Entries without a matching room, or whose room is too small,
 * are left untouched.
 */
function keyOf(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

export function fixedRoomForClass(
  data: Pick<SchoolData, 'classes' | 'rooms'>,
  classId: string,
): Room | undefined {
  const klass = data.classes.find((item) => item.id === classId);
  if (!klass) return undefined;
  const homeroom = keyOf(klass.name + '教室');
  return data.rooms.find(
    (room) =>
      keyOf(room.name) === homeroom &&
      (!room.type || room.type === '普通教室') &&
      Number(room.capacity ?? 0) >= Number(klass.size ?? 0),
  );
}

function normalizeEntries(data: SchoolData, entries: ScheduleEntry[]): ScheduleEntry[] {
  const plans = new Map(data.coursePlans.map((plan) => [plan.id, plan]));
  return entries.map((entry) => {
    // Elective groups deliberately share special rooms across classes.
    if (entry.groupId) return entry;
    const plan = plans.get(entry.coursePlanId);
    if (!plan) return entry;
    if (plan.roomType && plan.roomType !== '普通教室') return entry;
    const room = fixedRoomForClass(data, entry.classId);
    if (!room || room.id === entry.roomId) return entry;
    return { ...entry, roomId: room.id };
  });
}

export function withFixedClassRoomsResult(data: SchoolData, output: SolverOutput): SolverOutput {
  return { ...output, entries: normalizeEntries(data, output.entries) };
}

export function withFixedClassRooms(data: SchoolData): SchoolData {
  return {
    ...data,
    candidate: data.candidate ? withFixedClassRoomsResult(data, data.candidate) : data.candidate,
    published: data.published ? withFixedClassRoomsResult(data, data.published) : data.published,
    publishedVersions: data.publishedVersions?.map((version) => ({
      ...version,
      result: withFixedClassRoomsResult(data, version.result),
    })),
  };
}
