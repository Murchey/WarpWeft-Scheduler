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
  if (!isSimplifiedRooms(data)) return entries;
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

export function isSimplifiedRooms(data: Pick<SchoolData, 'roomMode'>): boolean {
  return (data.roomMode ?? 'simplified') !== 'full';
}

/** Simplified workspaces do not need a room sheet; one fixed room per class is enough. */
export function ensureSimplifiedRooms(data: SchoolData): SchoolData {
  if (!isSimplifiedRooms(data) || data.rooms.length > 0) return data;
  return {
    ...data,
    rooms: data.classes.map((klass) => ({
      id: 'room-auto-' + klass.id,
      name: klass.name + '教室',
      capacity: Math.max(1, Number(klass.size) || 1),
      type: '普通教室',
    })),
  };
}

export function withFixedClassRoomsResult(data: SchoolData, output: SolverOutput): SolverOutput {
  if (!isSimplifiedRooms(data)) return output;
  const roomed = ensureSimplifiedRooms(data);
  return { ...output, entries: normalizeEntries(roomed, output.entries) };
}

export function withFixedClassRooms(data: SchoolData): SchoolData {
  if (!isSimplifiedRooms(data)) return data;
  const roomed = ensureSimplifiedRooms(data);
  return {
    ...roomed,
    roomMode: roomed.roomMode ?? 'simplified',
    candidate: roomed.candidate ? withFixedClassRoomsResult(roomed, roomed.candidate) : roomed.candidate,
    published: roomed.published ? withFixedClassRoomsResult(roomed, roomed.published) : roomed.published,
    publishedVersions: roomed.publishedVersions?.map((version) => ({
      ...version,
      result: withFixedClassRoomsResult(roomed, version.result),
    })),
  };
}
