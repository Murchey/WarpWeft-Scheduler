export const PROTOCOL_VERSION = '1.0';

export type SolverStatus = 'QUEUED'|'PREPARING'|'SOLVING'|'FEASIBLE'|'IMPROVED'|'COMPLETED'|'CANCELLED'|'TIMEOUT'|'FAILED';
export type SoftRuleKind = 'SUBJECT_DISTRIBUTION'|'TEACHER_CONTINUOUS'|'TEACHER_GAPS'|'TEACHER_WORKLOAD_BALANCE';
export type RuleImportance = 'must'|'prefer'|'avoid';
export type RuleKind = 'TEACHER_MAX_DAILY'|'TEACHER_MAX_CONSECUTIVE'|'TEACHER_FREE_HALF_DAY'|'SUBJECT_MAX_PER_DAY'|'SUBJECT_TIME_PREFERENCE'|'SUBJECT_AVOID_FIRST_LAST'|'SUBJECT_SPREAD'|'DOUBLE_PERIOD';
export interface RuleScope { type: 'all'|'grade'|'class'|'teacher'|'subject'|'room'; teacherId?: string; subjectId?: string; classId?: string; grade?: string; roomId?: string; }
export interface RuleTime { type: 'all'|'weekday'|'periodRange'; days?: number[]; from?: number; to?: number; }
export interface RuleInput { id: string; kind: RuleKind; scope: RuleScope; time: RuleTime; importance: RuleImportance; params: Record<string,string|number>; enabled: boolean; note?: string; createdAt: string; source: 'preset'|'manual'|'import'|'migration'; }

export interface TimeSlot { id: string; day: number; period: number; label: string; }
export interface ClassRoom { id: string; name: string; capacity: number; type: string; }
export interface CoursePlan { id: string; classId: string; subjectId: string; teacherId: string; weeklyPeriods: number; roomType?: string; fixedSlotId?: string; consecutive?: number; locked?: boolean; }
export interface SolverInput {
  protocolVersion: string; dataSnapshotVersion: string; timeSlots: TimeSlot[]; classes: {id:string; name:string; size:number}[];
  teachers: {id:string; name:string}[]; subjects: {id:string; name:string}[]; rooms: ClassRoom[]; coursePlans: CoursePlan[];
  unavailableSlots: {teacherId:string; slotId:string}[]; lockedEntries: ScheduleEntry[];
  hardConstraints: string[]; rules?: RuleInput[]; softConstraints: {kind:SoftRuleKind; weight:number}[]; timeLimitSeconds:number; randomSeed:number;
}
export interface ScheduleEntry { id:string; coursePlanId:string; classId:string; teacherId:string; roomId:string; slotId:string; source:'AUTO'|'MANUAL'; locked:boolean; }
export interface SolverOutput { protocolVersion:string; status:SolverStatus; entries:ScheduleEntry[]; hardConstraintViolations:string[]; softScore:number; scoreBreakdown:Record<string,number>; unsatisfiedRules:string[]; explanation:string; elapsedMs:number; hasFeasibleSolution:boolean; }
