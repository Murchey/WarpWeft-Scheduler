export const PROTOCOL_VERSION = '1.0';

export type SolverStatus = 'QUEUED'|'PREPARING'|'SOLVING'|'FEASIBLE'|'IMPROVED'|'COMPLETED'|'CANCELLED'|'TIMEOUT'|'FAILED';
export type SoftRuleKind = 'SUBJECT_DISTRIBUTION'|'TEACHER_CONTINUOUS'|'TEACHER_GAPS'|'TEACHER_WORKLOAD_BALANCE';

export interface TimeSlot { id: string; day: number; period: number; label: string; }
export interface ClassRoom { id: string; name: string; capacity: number; type: string; }
export interface CoursePlan { id: string; classId: string; subjectId: string; teacherId: string; weeklyPeriods: number; roomType?: string; fixedSlotId?: string; consecutive?: number; locked?: boolean; }
export interface SolverInput {
  protocolVersion: string; dataSnapshotVersion: string; timeSlots: TimeSlot[]; classes: {id:string; name:string; size:number}[];
  teachers: {id:string; name:string}[]; rooms: ClassRoom[]; coursePlans: CoursePlan[];
  unavailableSlots: {teacherId:string; slotId:string}[]; lockedEntries: ScheduleEntry[];
  hardConstraints: string[]; softConstraints: {kind:SoftRuleKind; weight:number}[]; timeLimitSeconds:number; randomSeed:number;
}
export interface ScheduleEntry { id:string; coursePlanId:string; classId:string; teacherId:string; roomId:string; slotId:string; source:'AUTO'|'MANUAL'; locked:boolean; }
export interface SolverOutput { protocolVersion:string; status:SolverStatus; entries:ScheduleEntry[]; hardConstraintViolations:string[]; softScore:number; scoreBreakdown:Record<string,number>; unsatisfiedRules:string[]; explanation:string; elapsedMs:number; hasFeasibleSolution:boolean; }
