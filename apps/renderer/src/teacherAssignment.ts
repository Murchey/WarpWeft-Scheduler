import type { CoursePlan, SchoolData, Teacher } from './types';

const CHINESE_GRADE: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/** "七年级"/"7"/"初一" -> 7; semicolon lists are handled by the caller. */
export function gradeNumber(value: string | undefined): number | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  if (text.includes('初')) return text.includes('一') ? 7 : text.includes('二') ? 8 : text.includes('三') ? 9 : null;
  if (text.includes('高')) return text.includes('一') ? 10 : text.includes('二') ? 11 : text.includes('三') ? 12 : null;
  const digit = text.match(/\d+/);
  if (digit) return Number(digit[0]);
  const chinese = text.match(/[一二三四五六七八九十]/);
  return chinese ? CHINESE_GRADE[chinese[0]] ?? null : null;
}

function listGradeNumbers(value: string | undefined): number[] {
  return (value ?? '')
    .split(/[;；,，、\s]+/)
    .map((part) => gradeNumber(part))
    .filter((grade): grade is number => grade !== null);
}

export function splitClassNames(value: string | undefined): string[] {
  return String(value ?? '')
    .split(/[,，;；、]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Class IDs a teacher is bound to. An empty list means "no restriction". */
export function classIdsForTeacher(
  teacher: Pick<Teacher, 'classes'>,
  classes: { id: string; name: string }[],
): string[] {
  const names = splitClassNames(teacher.classes);
  if (names.length === 0) return [];
  const byName = new Map(classes.map((klass) => [klass.name.trim().toLowerCase(), klass.id]));
  return Array.from(
    new Set(names.map((name) => byName.get(name.toLowerCase())).filter((id): id is string => Boolean(id))),
  );
}

export function subjectIdsForTeacher(
  teacher: Pick<Teacher, 'subject' | 'subject2'>,
  subjects: { id: string; name: string }[],
): string[] {
  const names = listSubjects(teacher as Teacher).map((name) => name.trim().toLowerCase());
  if (names.length === 0) return [];
  const byName = new Map(subjects.map((subject) => [subject.name.trim().toLowerCase(), subject.id]));
  return Array.from(new Set(names.map((name) => byName.get(name)).filter((id): id is string => Boolean(id))));
}

export function teacherCanTeachClass(
  teacher: Pick<Teacher, 'classes'>,
  classes: { id: string; name: string }[],
  classId: string,
): boolean {
  if (splitClassNames(teacher.classes).length === 0) return true;
  return classIdsForTeacher(teacher, classes).includes(classId);
}

function listSubjects(teacher: Teacher): string[] {
  return [teacher.subject, teacher.subject2]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/[、,，;；/]+/))
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Resolve plans that intentionally leave the teacher blank. The result is used
 * only for one solve; the source plan keeps its blank teacher so the user can
 * still treat the teacher as a soft condition.
 *
 * The assignment is capacity-aware: a teacher is skipped when their weekly
 * load would exceed either their available time slots or a "教师每日上限"
 * rule, and teachers who already teach the class are preferred so a class does
 * not end up with a different teacher for every lesson.
 */
export function assignMissingTeachers(data: SchoolData): {
  plans: CoursePlan[];
  assigned: number;
  unresolved: number;
  unresolvedReasons: { planId: string; reason: string }[];
} {
  const subjectName = new Map(data.subjects.map((subject) => [subject.id, subject.name.trim()]));
  const classGrade = new Map(data.classes.map((klass) => [klass.id, gradeNumber(klass.grade)]));
  const slotsByKey = data.timeSlots.length;
  const dayCount = new Set(data.timeSlots.map((slot) => slot.day)).size || 5;
  const load = new Map<string, number>();
  const classLoad = new Map<string, number>();
  for (const teacher of data.teachers) load.set(teacher.id, 0);
  for (const plan of data.coursePlans) {
    if (!plan.teacherId) continue;
    load.set(plan.teacherId, (load.get(plan.teacherId) ?? 0) + Number(plan.weeklyPeriods || 0));
    const key = plan.teacherId + '|' + plan.classId;
    classLoad.set(key, (classLoad.get(key) ?? 0) + Number(plan.weeklyPeriods || 0));
  }

  /** Weekly capacity: available slots and (when a rule exists) daily cap × days. */
  const weeklyLimit = (teacherId: string): number => {
    let maxDaily: number | null = null;
    for (const rule of data.rules ?? []) {
      if (!rule.enabled || rule.kind !== 'TEACHER_MAX_DAILY') continue;
      const scope = rule.scope;
      if (scope.type !== 'all' && !(scope.type === 'teacher' && scope.teacherId === teacherId)) continue;
      const value = Number(rule.params?.maxPerDay ?? 0);
      if (value >= 1) maxDaily = maxDaily === null ? value : Math.min(maxDaily, value);
    }
    const unavailable = (data.unavailableSlots ?? []).filter((item) => item.teacherId === teacherId).length;
    const available = slotsByKey > 0 ? Math.max(0, slotsByKey - unavailable) : Number.POSITIVE_INFINITY;
    const byDaily = maxDaily === null ? Number.POSITIVE_INFINITY : maxDaily * dayCount;
    return Math.min(available, byDaily);
  };

  let assigned = 0;
  let unresolved = 0;
  const unresolvedReasons: { planId: string; reason: string }[] = [];
  const plans = data.coursePlans.map((plan) => ({ ...plan }));

  // First pass: every homeroom teacher gets one lesson in their own class when
  // a blank plan covers a subject they can teach. This makes the homeroom rule
  // satisfiable without silently stealing a non-blank plan from another teacher.
  for (const klass of data.classes) {
    if (!klass.homeroomTeacherId) continue;
    const teacher = data.teachers.find((item) => item.id === klass.homeroomTeacherId);
    if (!teacher || !teacherCanTeachClass(teacher, data.classes, klass.id)) continue;
    const subjects = listSubjects(teacher);
    if (subjects.length === 0) continue;
    const index = plans.findIndex((plan) => {
      if (plan.classId !== klass.id || plan.teacherId?.trim()) return false;
      return subjects.includes(subjectName.get(plan.subjectId) ?? '');
    });
    if (index < 0) continue;
    const periods = Number(plans[index].weeklyPeriods || 0);
    if ((load.get(teacher.id) ?? 0) + periods > weeklyLimit(teacher.id)) continue;
    plans[index] = { ...plans[index], teacherId: teacher.id };
    load.set(teacher.id, (load.get(teacher.id) ?? 0) + periods);
    classLoad.set(teacher.id + '|' + klass.id, (classLoad.get(teacher.id + '|' + klass.id) ?? 0) + periods);
    assigned += 1;
  }

  // Second pass: remaining blank plans use the existing subject/grade/load logic.
  for (const [index, plan] of plans.entries()) {
    if (plan.teacherId?.trim()) continue;
    const subject = subjectName.get(plan.subjectId) ?? '';
    const grade = classGrade.get(plan.classId) ?? null;
    const candidates = data.teachers.filter((teacher) => {
      if (!teacherCanTeachClass(teacher, data.classes, plan.classId)) return false;
      const subjects = listSubjects(teacher);
      if (subjects.length > 0 && !subjects.some((item) => item === subject)) return false;
      const grades = listGradeNumbers(teacher.grade);
      if (grades.length > 0 && grade !== null && !grades.includes(grade)) return false;
      return true;
    });
    const periods = Number(plan.weeklyPeriods || 0);
    const withCapacity = candidates.filter((teacher) => (load.get(teacher.id) ?? 0) + periods <= weeklyLimit(teacher.id));
    if (withCapacity.length === 0) {
      unresolved += 1;
      unresolvedReasons.push({
        planId: plan.id,
        reason: candidates.length === 0 ? '没有符合学科/年级/负责班级条件的教师' : '符合条件的教师周课时或可用时段已满',
      });
      continue;
    }
    const chosen = withCapacity.slice().sort((a, b) => {
      // Prefer continuity: a teacher already teaching this class.
      const continuity = Number((classLoad.get(b.id + '|' + plan.classId) ?? 0) > 0)
        - Number((classLoad.get(a.id + '|' + plan.classId) ?? 0) > 0);
      if (continuity !== 0) return continuity;
      const difference = (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0);
      return difference !== 0 ? difference : a.id.localeCompare(b.id);
    })[0];
    load.set(chosen.id, (load.get(chosen.id) ?? 0) + periods);
    classLoad.set(chosen.id + '|' + plan.classId, (classLoad.get(chosen.id + '|' + plan.classId) ?? 0) + periods);
    assigned += 1;
    plans[index] = { ...plan, teacherId: chosen.id };
  }
  return { plans, assigned, unresolved, unresolvedReasons };
}

