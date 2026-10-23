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
  const classNameById = new Map(input.classes.map(x=>[x.id,x.name]));
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
