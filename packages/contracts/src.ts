export const PROTOCOL_VERSION = '1.0';

export type SolverStatus = 'QUEUED'|'PREPARING'|'SOLVING'|'FEASIBLE'|'IMPROVED'|'COMPLETED'|'CANCELLED'|'TIMEOUT'|'FAILED';
export type SoftRuleKind = 'SUBJECT_DISTRIBUTION'|'TEACHER_CONTINUOUS'|'TEACHER_GAPS'|'TEACHER_WORKLOAD_BALANCE'|'CLASS_GAPS'|'SUBJECT_TIME_PREFERENCE';
export type SubjectTimePreference = 'morning'|'afternoon';
export type RuleImportance = 'must'|'prefer'|'avoid';
export type RuleKind = 'TEACHER_MAX_DAILY'|'TEACHER_MAX_CONSECUTIVE'|'TEACHER_FREE_HALF_DAY'|'SUBJECT_MAX_PER_DAY'|'SUBJECT_TIME_PREFERENCE'|'SUBJECT_AVOID_FIRST_LAST'|'SUBJECT_SPREAD'|'DOUBLE_PERIOD';
export interface RuleScope { type: 'all'|'grade'|'class'|'teacher'|'subject'|'room'; teacherId?: string; subjectId?: string; classId?: string; grade?: string; roomId?: string; }
export interface RuleTime { type: 'all'|'weekday'|'periodRange'; days?: number[]; from?: number; to?: number; }
export interface RuleInput { id: string; kind: RuleKind; scope: RuleScope; time: RuleTime; importance: RuleImportance; params: Record<string,string|number>; enabled: boolean; note?: string; createdAt: string; source: 'preset'|'manual'|'import'|'migration'; }

export type SlotKind = 'morning' | 'regular' | 'study' | 'aftercare' | 'evening' | 'makeup';
export interface TimeSlot { id: string; day: number; period: number; label: string; kind?: SlotKind; start?: string; duration?: number; }
export interface ClassRoom { id: string; name: string; capacity: number; type: string; }
export type WeekType = 'all' | 'odd' | 'even';
export interface ElectiveBlock { id: string; name?: string; teacherId: string; roomType?: string; }
export interface ElectiveGroup { id: string; name?: string; subjectId: string; weeklyPeriods: number; classIds: string[]; blocks: ElectiveBlock[]; }
export interface CoursePlan {
  id: string; classId: string; subjectId: string; teacherId: string; weeklyPeriods: number;
  roomType?: string;
  /** Legacy single fixed slot; kept so old workspaces keep working. */
  fixedSlotId?: string;
  /** Per-occurrence fixed slots: lesson i is pinned to fixedSlotIds[i]. */
  fixedSlotIds?: string[];
  /** Desired adjacent run length (连堂): 2 means two lessons in a row. 0/1 = no run. */
  consecutive?: number;
  /** Plans sharing a pairId must occupy the same slot (odd/even week pairing). */
  pairId?: string;
  locked?: boolean; weeks?: WeekType; kind?: SlotKind;
}
export interface SolverInput {
  protocolVersion: string; dataSnapshotVersion: string; dataSchemaVersion?: number; timeSlots: TimeSlot[]; classes: {id:string; name:string; size:number; homeroomTeacherId?:string}[];
  teachers: {id:string; name:string; classIds?:string[]; subjectIds?:string[]}[];
  subjects: {id:string; name:string; preference?: SubjectTimePreference}[]; rooms: ClassRoom[]; coursePlans: CoursePlan[];
  unavailableSlots: {teacherId:string; slotId:string}[]; lockedEntries: ScheduleEntry[]; electiveGroups?: ElectiveGroup[];
  hardConstraints: string[]; rules?: RuleInput[]; softConstraints: {kind:SoftRuleKind; weight:number}[]; timeLimitSeconds:number; randomSeed:number;
}
export interface ScheduleEntry { id:string; coursePlanId:string; classId:string; teacherId:string; roomId:string; slotId:string; source:'AUTO'|'MANUAL'; locked:boolean; weeks?:WeekType; groupId?:string; blockId?:string; }
export interface SolverOutput { protocolVersion:string; status:SolverStatus; entries:ScheduleEntry[]; hardConstraintViolations:string[]; softScore:number; scoreBreakdown:Record<string,number>; unsatisfiedRules:string[]; explanation:string; elapsedMs:number; hasFeasibleSolution:boolean; }

/** Fixed slots of a plan, new list form first, legacy single value as fallback. */
export function fixedSlotIdsOf(plan: { fixedSlotId?: string; fixedSlotIds?: string[] }): string[] {
  const list = Array.isArray(plan.fixedSlotIds) ? plan.fixedSlotIds.filter((id) => typeof id === 'string' && id.trim() !== '') : [];
  if (list.length > 0) return Array.from(new Set(list));
  return plan.fixedSlotId ? [plan.fixedSlotId] : [];
}

export const SUBJECT_PREFERENCE_LABELS: Record<SubjectTimePreference, string> = {
  morning: '上午',
  afternoon: '下午',
};

export function subjectPreferenceLabel(value: string | undefined): string {
  return value === 'morning' ? '上午' : value === 'afternoon' ? '下午' : '不限';
}

export function parseSubjectPreference(value: unknown): SubjectTimePreference | undefined {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === '上午' || text === '上午为主' || text === 'morning' || text === 'morning_block') return 'morning';
  if (text === '下午' || text === '下午为主' || text === 'afternoon' || text === 'afternoon_block') return 'afternoon';
  return undefined;
}

/** Exact subject names that normally belong in the morning block. */
const MORNING_SUBJECTS = new Set(['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理']);
/** Exact subject names that normally belong in the afternoon block. */
const AFTERNOON_SUBJECTS = new Set([
  '书香阅读', '数学益智', '作文', '班会健康', '班会', '健康', '阅读', '写字', '劳动',
  '道德', '道法', '科学', '美术', '音乐', '体育', '信息科技', '信息技术', '综合实践', '社团', '心理',
]);

/** Suggested default used when the import sheet leaves the preference blank. */
export function suggestedSubjectPreference(name: string): SubjectTimePreference | undefined {
  const text = String(name ?? '').trim();
  if (!text) return undefined;
  if (AFTERNOON_SUBJECTS.has(text)) return 'afternoon';
  if (MORNING_SUBJECTS.has(text)) return 'morning';
  return undefined;
}

/** Run length (连堂) of a plan; values below 2 mean "no run". */
export function consecutiveOf(plan: { consecutive?: number }): number {
  const value = Number(plan.consecutive ?? 0);
  return Number.isInteger(value) && value >= 2 ? Math.min(4, value) : 0;
}
