import type { SolverInput, ScheduleEntry } from '../contracts/src';

export interface ValidationIssue { code:string; message:string; entity?:string; field?:string; }

export function validateInput(input: SolverInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = <T extends {id:string}>(items:T[], label:string) => {
    const seen = new Set<string>(); for (const item of items) { if (seen.has(item.id)) issues.push({code:'DUPLICATE_ID',message:`${label} 编码重复：${item.id}`,entity:item.id}); seen.add(item.id); }
  };
  ids(input.classes,'班级'); ids(input.teachers,'教师'); ids(input.rooms,'教室'); ids(input.timeSlots,'时间段'); ids(input.coursePlans,'课程计划');
  const teacherIds = new Set(input.teachers.map(x=>x.id)); const classIds = new Set(input.classes.map(x=>x.id));
  for (const p of input.coursePlans) {
    if (!classIds.has(p.classId)) issues.push({code:'MISSING_REFERENCE',message:`课程计划 ${p.id} 引用了不存在的班级`,entity:p.id});
    if (!teacherIds.has(p.teacherId)) issues.push({code:'MISSING_REFERENCE',message:`课程计划 ${p.id} 引用了不存在的教师`,entity:p.id});
    if (p.weeklyPeriods <= 0) issues.push({code:'INVALID_VALUE',message:`课程计划 ${p.id} 的周课时必须大于 0`,entity:p.id,field:'weeklyPeriods'});
  }
  return issues;
}

export function findConflicts(entries: ScheduleEntry[]): string[] {
  const conflicts:string[]=[]; const occupied = new Map<string,string>();
  for (const e of entries) for (const key of [`class:${e.classId}:${e.slotId}`,`teacher:${e.teacherId}:${e.slotId}`,`room:${e.roomId}:${e.slotId}`]) {
    const prior=occupied.get(key); if (prior) conflicts.push(`${key} 被 ${prior} 与 ${e.id} 同时占用`); else occupied.set(key,e.id);
  }
  return conflicts;
}
