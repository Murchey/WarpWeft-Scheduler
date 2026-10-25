import { consecutiveOf, fixedSlotIdsOf } from '../contracts/src.ts';
import type { SolverInput, ScheduleEntry } from '../contracts/src';

export interface ValidationIssue { code:string; message:string; entity?:string; field?:string; }

export function validateInput(input: SolverInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = <T extends {id:string}>(items:T[], label:string) => {
    const seen = new Set<string>(); for (const item of items) { if (seen.has(item.id)) issues.push({code:'DUPLICATE_ID',message:`${label} 编码重复：${item.id}`,entity:item.id}); seen.add(item.id); }
  };
  ids(input.classes,'班级'); ids(input.teachers,'教师'); ids(input.rooms,'教室'); ids(input.timeSlots,'时间段'); ids(input.coursePlans,'课程计划');
  const teacherIds = new Set(input.teachers.map(x=>x.id)); const classIds = new Set(input.classes.map(x=>x.id));
  const teacherById = new Map(input.teachers.map(x=>[x.id,x]));
  const classById = new Map(input.classes.map(x=>[x.id,x]));
  const classNameById = new Map(input.classes.map(x=>[x.id,x.name]));
  const subjectNameById = new Map(input.subjects.map(x=>[x.id,x.name]));
  for (const teacher of input.teachers) {
    for (const classId of teacher.classIds ?? []) {
      if (!classIds.has(classId)) issues.push({code:'MISSING_REFERENCE',message:`教师 ${teacher.name} 的负责班级引用了不存在的班级`,entity:teacher.id,field:'classIds'});
    }
  }
  for (const p of input.coursePlans) {
    if (!classIds.has(p.classId)) issues.push({code:'MISSING_REFERENCE',message:`课程计划 ${p.id} 引用了不存在的班级`,entity:p.id});
    if (p.teacherId && !teacherIds.has(p.teacherId)) issues.push({code:'MISSING_REFERENCE',message:`课程计划 ${p.id} 引用了不存在的教师`,entity:p.id});
    const teacher = p.teacherId ? teacherById.get(p.teacherId) : undefined;
    if (teacher?.classIds?.length && !teacher.classIds.includes(p.classId)) {
      issues.push({
        code:'TEACHER_CLASS_BINDING',
        message:`教师 ${teacher.name} 只负责指定班级，不能排 ${classNameById.get(p.classId) ?? p.classId}`,
        entity:p.id,
        field:'teacherId',
      });
    }
    if (p.weeklyPeriods <= 0) issues.push({code:'INVALID_VALUE',message:`课程计划 ${p.id} 的周课时必须大于 0`,entity:p.id,field:'weeklyPeriods'});
    const fixedSlotIds = fixedSlotIdsOf(p);
    const slotIds = new Set(input.timeSlots.map((slot) => slot.id));
    if (fixedSlotIds.some((slotId) => !slotIds.has(slotId))) {
      issues.push({code:'MISSING_REFERENCE',message:`课程计划 ${p.id} 的固定时间引用了不存在的时间段`,entity:p.id,field:'fixedSlotIds'});
    }
    if (fixedSlotIds.length > p.weeklyPeriods) {
      issues.push({code:'INVALID_VALUE',message:`课程计划 ${p.id} 的固定时间超过周课时`,entity:p.id,field:'fixedSlotIds'});
    }
    const consecutive = consecutiveOf(p);
    if (consecutive >= 2 && consecutive > p.weeklyPeriods) {
      issues.push({code:'INVALID_VALUE',message:`课程计划 ${p.id} 的连堂节数超过周课时`,entity:p.id,field:'consecutive'});
    }
  }
  const pairGroups = new Map<string, SolverInput['coursePlans']>();
  for (const plan of input.coursePlans) {
    if (!plan.pairId) continue;
    pairGroups.set(plan.pairId, [...(pairGroups.get(plan.pairId) ?? []), plan]);
  }
  for (const [pairId, group] of pairGroups) {
    if (group.length < 2) {
      issues.push({code:'INVALID_VALUE',message:`配对组 ${pairId} 至少需要两条计划`,entity:group[0]?.id,field:'pairId'});
      continue;
    }
    for (const plan of group) {
      const overlap = group.some((other) => other.id !== plan.id
        && other.classId === plan.classId
        && (other.weeks ?? 'all') === (plan.weeks ?? 'all'));
      if (overlap) {
        issues.push({code:'INVALID_VALUE',message:`配对组 ${pairId} 的周次重叠，无法共用同一时段`,entity:plan.id,field:'pairId'});
        break;
      }
    }
  }
  const homeroomTeachers = new Map<string, string[]>();
  for (const klass of input.classes) {
    if (!klass.homeroomTeacherId) continue;
    const teacher = teacherById.get(klass.homeroomTeacherId);
    if (!teacher) {
      issues.push({code:'MISSING_REFERENCE',message:`班级 ${klass.name} 的班主任不存在`,entity:klass.id,field:'homeroomTeacherId'});
      continue;
    }
    const assignedClasses = homeroomTeachers.get(teacher.id) ?? [];
    assignedClasses.push(klass.name);
    homeroomTeachers.set(teacher.id, assignedClasses);
    if (teacher.classIds?.length && !teacher.classIds.includes(klass.id)) {
      issues.push({code:'TEACHER_CLASS_BINDING',message:`班主任 ${teacher.name} 不负责班级 ${klass.name}`,entity:klass.id,field:'homeroomTeacherId'});
    }
    const classPlans = input.coursePlans.filter((plan) => plan.classId === klass.id);
    const teacherSubjects = teacher.subjectIds ?? [];
    const qualified = teacherSubjects.length === 0
      ? classPlans
      : classPlans.filter((plan) => teacherSubjects.includes(plan.subjectId));
    if (qualified.length > 0 && !classPlans.some((plan) => plan.teacherId === teacher.id)) {
      issues.push({
        code:'HOMEROOM_TEACHER_NO_LESSON',
        message:`班主任 ${teacher.name} 必须在本班 ${klass.name} 承担至少一节课`,
        entity:klass.id,
        field:'homeroomTeacherId',
      });
    }
  }
  for (const [teacherId, classNames] of homeroomTeachers) {
    if (classNames.length > 1) {
      const teacher = teacherById.get(teacherId);
      issues.push({code:'HOMEROOM_TEACHER_DUPLICATE',message:`教师 ${teacher?.name ?? teacherId} 同时担任多个班的班主任：${classNames.join('、')}`,entity:teacherId});
    }
  }
  return issues;
}

export function findConflicts(entries: ScheduleEntry[]): string[] {
  const conflicts:string[]=[]; const occupied = new Map<string,string>();
  for (const e of entries) {
    const keys = [`class:${e.classId}:${e.slotId}`, `room:${e.roomId}:${e.slotId}`];
    if (e.teacherId) keys.push(`teacher:${e.teacherId}:${e.slotId}`);
    for (const key of keys) {
      const prior=occupied.get(key); if (prior) conflicts.push(`${key} 被 ${prior} 与 ${e.id} 同时占用`); else occupied.set(key,e.id);
    }
  }
  return conflicts;
}
