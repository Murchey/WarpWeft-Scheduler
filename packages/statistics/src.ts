/**
 * Plan-vs-placed statistics.
 *
 * Two numbers are shown side by side on purpose: the *plan* (what the teaching
 * plans ask for) and the *placed* lessons (what the candidate timetable
 * actually contains). Neither is "the" truth — the report labels which is
 * which, so a half-solved timetable cannot be mistaken for a light workload.
 */

export interface StatsInput {
  timeSlots: { id: string; day: number; period: number; label: string; kind?: string }[];
  classes: { id: string; name: string; grade?: string }[];
  teachers: { id: string; name: string }[];
  subjects: { id: string; name: string }[];
  coursePlans: {
    id: string;
    classId: string;
    subjectId: string;
    teacherId: string;
    weeklyPeriods: number;
    roomType?: string;
    weeks?: string;
    kind?: string;
  }[];
  entries: { id: string; coursePlanId: string; classId: string; teacherId: string; roomId: string; slotId: string; groupId?: string; blockId?: string }[];
  electiveGroups?: { id: string; name?: string; subjectId: string; weeklyPeriods: number; classIds: string[]; blocks: { id: string; teacherId: string }[] }[];
  unavailableSlots?: { teacherId: string; slotId: string }[];
}

export interface SubjectSplit {
  subjectId: string;
  subjectName: string;
  planned: number;
  placed: number;
}

export interface TeacherRow {
  id: string;
  name: string;
  planned: number;
  placed: number;
  missing: number;
  capacity: number;
  ratio: number;
  /** Elective block lessons taught by this teacher. */
  elective: number;
  subjects: SubjectSplit[];
}

export interface SubjectRow {
  id: string;
  name: string;
  planned: number;
  placed: number;
  missing: number;
  classCount: number;
  teacherCount: number;
}

export interface ClassRow {
  id: string;
  name: string;
  grade: string;
  planned: number;
  placed: number;
  missing: number;
  capacity: number;
  freeSlots: number;
  /** Free periods between the first and last regular day lesson, summed over days. */
  dayGaps: number;
  byDay: { day: number; planned: number; placed: number }[];
}

export interface DayRow {
  day: number;
  slots: number;
  capacity: number;
  placed: number;
  ratio: number;
}

export interface KindRow {
  kind: string;
  label: string;
  planned: number;
  placed: number;
}

export interface StatsReport {
  generatedAt: string;
  summary: {
    classes: number;
    teachers: number;
    subjects: number;
    slots: number;
    planned: number;
    averagePlanned: number;
    placed: number;
    missing: number;
    utilization: number;
    electivePlaced: number;
  };
  teachers: TeacherRow[];
  subjects: SubjectRow[];
  classes: ClassRow[];
  days: DayRow[];
  byKind: KindRow[];
}

function ratio(used: number, capacity: number): number {
  if (capacity <= 0) return 0;
  return Math.round((used / capacity) * 1000) / 1000;
}

export function buildStats(input: StatsInput): StatsReport {
  const classes = new Map(input.classes.map((item) => [item.id, item]));
  const teachers = new Map(input.teachers.map((item) => [item.id, item]));
  const subjects = new Map(input.subjects.map((item) => [item.id, item]));
  const plans = new Map(input.coursePlans.map((item) => [item.id, item]));
  const slots = new Map(input.timeSlots.map((item) => [item.id, item]));
  const days = Array.from(new Set(input.timeSlots.map((slot) => slot.day))).sort((a, b) => a - b);

  const unavailableByTeacher = new Map<string, number>();
  for (const item of input.unavailableSlots ?? []) {
    unavailableByTeacher.set(item.teacherId, (unavailableByTeacher.get(item.teacherId) ?? 0) + 1);
  }

  // Only count entries that still point at a real plan: a dangling entry would
  // otherwise inflate one bucket and hide the plan's real missing lessons.
  const placedEntries = input.entries.filter((entry) => plans.has(entry.coursePlanId));
  // Elective block lessons are taught by a teacher but are not course plans.
  const electiveEntries = input.entries.filter((entry) => Boolean(entry.groupId));

  const teacherRows = new Map<string, TeacherRow>();
  const ensureTeacher = (teacherId: string): TeacherRow => {
    const existing = teacherRows.get(teacherId);
    if (existing) return existing;
    const row: TeacherRow = {
      id: teacherId,
      name: teachers.get(teacherId)?.name ?? teacherId,
      planned: 0,
      placed: 0,
      missing: 0,
      capacity: Math.max(0, input.timeSlots.length - (unavailableByTeacher.get(teacherId) ?? 0)),
      ratio: 0,
      elective: 0,
      subjects: [],
    };
    teacherRows.set(teacherId, row);
    return row;
  };

  const subjectRows = new Map<string, SubjectRow>();
  const ensureSubject = (subjectId: string): SubjectRow => {
    const existing = subjectRows.get(subjectId);
    if (existing) return existing;
    const row: SubjectRow = {
      id: subjectId,
      name: subjects.get(subjectId)?.name ?? subjectId,
      planned: 0,
      placed: 0,
      missing: 0,
      classCount: 0,
      teacherCount: 0,
    };
    subjectRows.set(subjectId, row);
    return row;
  };

  const classRows = new Map<string, ClassRow>();
  const ensureClass = (classId: string): ClassRow => {
    const existing = classRows.get(classId);
    if (existing) return existing;
    const klass = classes.get(classId);
    const row: ClassRow = {
      id: classId,
      name: klass?.name ?? classId,
      grade: klass?.grade ?? '',
      planned: 0,
      placed: 0,
      missing: 0,
      capacity: input.timeSlots.length,
      freeSlots: input.timeSlots.length,
      dayGaps: 0,
      byDay: days.map((day) => ({ day, planned: 0, placed: 0 })),
    };
    classRows.set(classId, row);
    return row;
  };

  // ---- plan side -----------------------------------------------------------
  const plannedByTeacherSubject = new Map<string, number>();
  const teacherSubjectPairs: { teacherId: string; subjectId: string }[] = [];
  for (const plan of input.coursePlans) {
    const weekly = Number(plan.weeklyPeriods) || 0;
    const teacher = ensureTeacher(plan.teacherId);
    teacher.planned += weekly;

    const subject = ensureSubject(plan.subjectId);
    subject.planned += weekly;

    const klass = ensureClass(plan.classId);
    klass.planned += weekly;

    const key = plan.teacherId + '|' + plan.subjectId;
    if (!plannedByTeacherSubject.has(key)) {
      plannedByTeacherSubject.set(key, 0);
      teacherSubjectPairs.push({ teacherId: plan.teacherId, subjectId: plan.subjectId });
    }
    plannedByTeacherSubject.set(key, (plannedByTeacherSubject.get(key) ?? 0) + weekly);
  }

  // ---- placed side ---------------------------------------------------------
  const placedByTeacherSubject = new Map<string, number>();
  const placedByDay = new Map<number, number>();
  for (const entry of placedEntries) {
    const plan = plans.get(entry.coursePlanId)!;
    const slot = slots.get(entry.slotId);
    if (!slot) continue;
    const teacher = ensureTeacher(plan.teacherId);
    teacher.placed += 1;
    const subject = ensureSubject(plan.subjectId);
    subject.placed += 1;
    const klass = ensureClass(plan.classId);
    klass.placed += 1;
    const key = plan.teacherId + '|' + plan.subjectId;
    placedByTeacherSubject.set(key, (placedByTeacherSubject.get(key) ?? 0) + 1);
    placedByDay.set(slot.day, (placedByDay.get(slot.day) ?? 0) + 1);

    if (!klass.byDay.some((row) => row.day === slot.day)) klass.byDay.push({ day: slot.day, planned: 0, placed: 0 });
    const dayRow = klass.byDay.find((row) => row.day === slot.day);
    if (dayRow) dayRow.placed += 1;
  }

  // Class-per-day planned usage: distribute the plan's weekly lessons evenly so
  // the table answers "how full is this class each day" before solving too.
  for (const row of classRows.values()) {
    const perDay = days.length > 0 ? Math.floor(row.planned / days.length) : 0;
    const remainder = days.length > 0 ? row.planned % days.length : 0;
    row.byDay = days.map((day, index) => ({
      day,
      planned: perDay + (index < remainder ? 1 : 0),
      placed: row.byDay.find((item) => item.day === day)?.placed ?? 0,
    }));
    row.byDay.sort((a, b) => a.day - b.day);
  }

  // Day gaps: only the regular daytime block (regular/study/aftercare).
  // Morning/evening/makeup lessons are separated by real breaks and must not
  // make an otherwise compact class look broken.
  const electiveById = new Map((input.electiveGroups ?? []).map((group) => [group.id, group]));
  const classDayPeriods = new Map<string, Set<number>>();
  for (const entry of input.entries) {
    const slot = slots.get(entry.slotId);
    if (!slot) continue;
    if (!plans.has(entry.coursePlanId) && !(entry.groupId && electiveById.has(entry.groupId))) continue;
    const kind = slot.kind ?? 'regular';
    if (kind !== 'regular' && kind !== 'study' && kind !== 'aftercare') continue;
    const classIds = entry.groupId ? (electiveById.get(entry.groupId)?.classIds ?? []) : [entry.classId];
    for (const classId of classIds) {
      if (!classRows.has(classId)) continue;
      const key = classId + '|' + slot.day;
      if (!classDayPeriods.has(key)) classDayPeriods.set(key, new Set());
      classDayPeriods.get(key)!.add(slot.period);
    }
  }
  for (const row of classRows.values()) {
    let gaps = 0;
    for (const day of days) {
      const occupied = classDayPeriods.get(row.id + '|' + day);
      if (!occupied || occupied.size < 2) continue;
      const periods = Array.from(occupied).sort((a, b) => a - b);
      gaps += (periods[periods.length - 1] - periods[0] + 1) - periods.length;
    }
    row.dayGaps = gaps;
  }

  // ---- derive --------------------------------------------------------------
  const teacherSubjectSplits = new Map<string, SubjectSplit[]>();
  for (const pair of teacherSubjectPairs) {
    const key = pair.teacherId + '|' + pair.subjectId;
    const splits = teacherSubjectSplits.get(pair.teacherId) ?? [];
    splits.push({
      subjectId: pair.subjectId,
      subjectName: subjects.get(pair.subjectId)?.name ?? pair.subjectId,
      planned: plannedByTeacherSubject.get(key) ?? 0,
      placed: placedByTeacherSubject.get(key) ?? 0,
    });
    teacherSubjectSplits.set(pair.teacherId, splits);
  }

  for (const entry of electiveEntries) {
    ensureTeacher(entry.teacherId).elective += 1;
  }
  for (const row of teacherRows.values()) {
    row.subjects = (teacherSubjectSplits.get(row.id) ?? []).sort((a, b) => b.planned - a.planned);
    row.missing = Math.max(0, row.planned - row.placed);
    row.ratio = ratio(row.placed + row.elective, row.capacity);
  }
  for (const row of subjectRows.values()) {
    row.missing = Math.max(0, row.planned - row.placed);
    const classIds = new Set<string>();
    const teacherIds = new Set<string>();
    for (const plan of input.coursePlans) {
      if (plan.subjectId !== row.id) continue;
      classIds.add(plan.classId);
      teacherIds.add(plan.teacherId);
    }
    row.classCount = classIds.size;
    row.teacherCount = teacherIds.size;
  }
  for (const row of classRows.values()) {
    row.missing = Math.max(0, row.planned - row.placed);
    row.freeSlots = Math.max(0, input.timeSlots.length - row.placed);
  }

  const planned = input.coursePlans.reduce((sum, plan) => sum + (Number(plan.weeklyPeriods) || 0), 0);
  // Odd/even plans run every other week: half the average weekly load.
  const averagePlanned = input.coursePlans.reduce((sum, plan) => {
    const weight = plan.weeks === 'odd' || plan.weeks === 'even' ? 0.5 : 1;
    return sum + (Number(plan.weeklyPeriods) || 0) * weight;
  }, 0);
  const placed = placedEntries.length;
  const dayRows: DayRow[] = days.map((day) => {
    const slotsPerDay = input.timeSlots.filter((slot) => slot.day === day).length;
    const used = placedByDay.get(day) ?? 0;
    const capacity = slotsPerDay * Math.max(1, input.classes.length);
    return { day, slots: slotsPerDay, capacity, placed: used, ratio: ratio(used, capacity) };
  });

  // Workload split by course kind (early reading / regular / study / aftercare / evening / makeup).
  const KIND_ORDER = ['morning', 'regular', 'study', 'aftercare', 'evening', 'makeup'];
  const KIND_LABELS: Record<string, string> = { morning: '早读', regular: '常规', study: '自习', aftercare: '课后服务', evening: '晚自习', makeup: '补课' };
  const kindPlanned = new Map<string, number>();
  const kindPlaced = new Map<string, number>();
  for (const plan of input.coursePlans) {
    const kind = plan.kind ?? 'regular';
    kindPlanned.set(kind, (kindPlanned.get(kind) ?? 0) + (Number(plan.weeklyPeriods) || 0));
  }
  for (const entry of placedEntries) {
    const kind = plans.get(entry.coursePlanId)?.kind ?? 'regular';
    kindPlaced.set(kind, (kindPlaced.get(kind) ?? 0) + 1);
  }
  const kindKeys = Array.from(new Set([...kindPlanned.keys(), ...kindPlaced.keys()])).sort(
    (a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b),
  );
  const byKind = kindKeys.map((kind) => ({
    kind,
    label: KIND_LABELS[kind] ?? kind,
    planned: kindPlanned.get(kind) ?? 0,
    placed: kindPlaced.get(kind) ?? 0,
  }));

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      classes: input.classes.length,
      teachers: input.teachers.length,
      subjects: input.subjects.length,
      slots: input.timeSlots.length,
      planned,
      averagePlanned: Math.round(averagePlanned * 10) / 10,
      placed,
      missing: Math.max(0, planned - placed),
      utilization: ratio(placed, input.timeSlots.length * Math.max(1, input.classes.length)),
      electivePlaced: electiveEntries.length,
    },
    teachers: Array.from(teacherRows.values()).sort((a, b) => b.placed - a.placed || b.planned - a.planned),
    subjects: Array.from(subjectRows.values()).sort((a, b) => b.planned - a.planned),
    classes: Array.from(classRows.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    days: dayRows,
    byKind,
  };
}

export function teacherRowsForExport(report: StatsReport): Record<string, string | number>[] {
  return report.teachers.map((row) => ({
    教师: row.name,
    任教学科: row.subjects.map((item) => item.subjectName).join('、'),
    计划周课时: row.planned,
    已排课时: row.placed,
    走班课时: row.elective,
    未排课时: row.missing,
    可用时段: row.capacity,
    占用率: Math.round(row.ratio * 1000) / 10 + '%',
  }));
}

export function subjectRowsForExport(report: StatsReport): Record<string, string | number>[] {
  return report.subjects.map((row) => ({
    学科: row.name,
    班级数: row.classCount,
    教师数: row.teacherCount,
    计划周课时: row.planned,
    已排课时: row.placed,
    未排课时: row.missing,
  }));
}

export function classRowsForExport(report: StatsReport): Record<string, string | number>[] {
  return report.classes.map((row) => ({
    班级: row.name,
    年级: row.grade,
    计划周课时: row.planned,
    已排课时: row.placed,
    未排课时: row.missing,
    可用时间格: row.capacity,
    剩余容量: row.freeSlots,
    日内空档: row.dayGaps,
  }));
}





