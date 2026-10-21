import type {
  ClassRoom,
  CoursePlan,
  Room,
  ScheduleEntry,
  SchoolData,
  SolverOutput,
  Subject,
  Teacher,
} from './types';

export function findClass(data: SchoolData, id: string): ClassRoom | undefined {
  return data.classes.find((item) => item.id === id);
}
export function findTeacher(data: SchoolData, id: string): Teacher | undefined {
  return data.teachers.find((item) => item.id === id);
}
export function findRoom(data: SchoolData, id: string): Room | undefined {
  return data.rooms.find((item) => item.id === id);
}
export function findSubject(data: SchoolData, id: string): Subject | undefined {
  return data.subjects.find((item) => item.id === id);
}
export function planOf(data: SchoolData, entry: ScheduleEntry): CoursePlan | undefined {
  return data.coursePlans.find((item) => item.id === entry.coursePlanId);
}
export function planSubjectName(data: SchoolData, plan?: CoursePlan): string {
  if (!plan) return '未命名课程';
  return findSubject(data, plan.subjectId)?.name ?? '未命名课程';
}

export function missingPlans(
  data: SchoolData,
  result: SolverOutput,
): { plan: CoursePlan; missing: number }[] {
  return data.coursePlans
    .map((plan) => ({
      plan,
      missing:
        Number(plan.weeklyPeriods || 0) -
        result.entries.filter((entry) => entry.coursePlanId === plan.id).length,
    }))
    .filter((item) => item.missing > 0);
}
