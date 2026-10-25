export interface School {
  id: string;
  name: string;
}

export interface ClassRoom {
  id: string;
  name: string;
  size: number;
  grade: string;
  /** Homeroom teacher; must teach at least one lesson in this class unless exempt. */
  homeroomTeacherId?: string;
}

export type RoomMode = 'simplified' | 'full';

export interface Teacher {
  id: string;
  name: string;
  /** Optional metadata imported from the teacher sheet. */
  grade?: string;
  subject?: string;
  subject2?: string;
  /** Class names this teacher is responsible for; empty means all classes. */
  classes?: string;
}

export type SubjectTimePreference = 'morning' | 'afternoon';

export interface Subject {
  id: string;
  name: string;
  /** Default time-of-day preference used by the solver's soft objective. */
  preference?: SubjectTimePreference;
}

export interface Room {
  id: string;
  name: string;
  capacity: number;
  type: string;
}

export type SlotKind = 'morning' | 'regular' | 'study' | 'aftercare' | 'evening' | 'makeup';

export interface ElectiveBlock {
  id: string;
  name: string;
  teacherId: string;
  roomType?: string;
}

export interface ElectiveGroup {
  id: string;
  name: string;
  subjectId: string;
  weeklyPeriods: number;
  classIds: string[];
  blocks: ElectiveBlock[];
}

export interface TimeSlot {
  id: string;
  day: number;
  period: number;
  label: string;
  /** morning = 早读, regular = 常规, study = 自习, aftercare = 课后服务, evening = 晚自习, makeup = 补课. */
  kind?: SlotKind;
  /** HH:MM. Without it the "current period" cannot be computed. */
  start?: string;
  /** Minutes; regular slots default to 45 when a start exists. */
  duration?: number;
}

export type WeekType = 'all' | 'odd' | 'even';

export interface CoursePlan {
  id: string;
  classId: string;
  subjectId: string;
  teacherId: string;
  weeklyPeriods: number;
  roomType?: string;
  /** Legacy single fixed slot; use fixedSlotIds for new data. */
  fixedSlotId?: string;
  /** Per-occurrence fixed slots: lesson i is pinned to fixedSlotIds[i]. */
  fixedSlotIds?: string[];
  /** Desired adjacent run length (连堂): 2 = two lessons in a row. */
  consecutive?: number;
  /** Plans sharing a pairId must occupy the same slot (odd/even pairing). */
  pairId?: string;
  locked?: boolean;
  /** all = every week (default), odd/even = alternating weeks. */
  weeks?: WeekType;
  /** Which kind of slot the plan belongs to (default regular). */
  kind?: SlotKind;
}

export type SolverStatus =
  | 'QUEUED'
  | 'PREPARING'
  | 'SOLVING'
  | 'FEASIBLE'
  | 'IMPROVED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'FAILED';

export interface ScheduleEntry {
  id: string;
  coursePlanId: string;
  classId: string;
  teacherId: string;
  roomId: string;
  slotId: string;
  source: 'AUTO' | 'MANUAL';
  locked: boolean;
  weeks?: WeekType;
  groupId?: string;
  blockId?: string;
}

export interface SolverOutput {
  protocolVersion: string;
  status: SolverStatus | string;
  entries: ScheduleEntry[];
  hardConstraintViolations: string[];
  softScore: number;
  scoreBreakdown: Record<string, number>;
  unsatisfiedRules: string[];
  explanation: string;
  elapsedMs: number;
  hasFeasibleSolution: boolean;
}


import type { RuleInstance } from '../../../packages/constraints/src';
import type { Adjustment, LessonLog } from '../../../packages/adjustments/src';
export type { RuleImportance, RuleKind, RuleScope, RuleTime, RuleInstance } from '../../../packages/constraints/src';
export type { Adjustment, AdjustmentType, LessonLog, LessonStatus } from '../../../packages/adjustments/src';

export interface SolverInput {
  protocolVersion: string;
  dataSnapshotVersion: string;
  dataSchemaVersion?: number;
  timeSlots: TimeSlot[];
  classes: { id: string; name: string; size: number; homeroomTeacherId?: string }[];
  teachers: (Teacher & { classIds?: string[]; subjectIds?: string[] })[];
  subjects: Subject[];
  rooms: Room[];
  coursePlans: CoursePlan[];
  unavailableSlots: { teacherId: string; slotId: string }[];
  lockedEntries: ScheduleEntry[];
  electiveGroups?: ElectiveGroup[];
  hardConstraints: string[];
  rules?: RuleInstance[];
  softConstraints: {
    kind:
      | 'SUBJECT_DISTRIBUTION'
      | 'TEACHER_CONTINUOUS'
      | 'TEACHER_GAPS'
      | 'TEACHER_WORKLOAD_BALANCE'
      | 'CLASS_GAPS'
      | 'SUBJECT_TIME_PREFERENCE';
    weight: number;
  }[];
  timeLimitSeconds: number;
  randomSeed: number;
}

export type SoftRuleKind = SolverInput['softConstraints'][number]['kind'];

export interface SchoolData {
  school: School;
  classes: ClassRoom[];
  teachers: Teacher[];
  subjects: Subject[];
  rooms: Room[];
  timeSlots: TimeSlot[];
  coursePlans: CoursePlan[];
  unavailableSlots?: { teacherId: string; slotId: string }[];
  rules?: RuleInstance[];
  softConstraints?: { kind: SolverInput['softConstraints'][number]['kind']; weight: number }[];
  auditLog?: { id: string; at: string; action: string; detail: string }[];
  candidate?: SolverOutput | null;
  published?: SolverOutput | null;
  semester?: { startDate: string; endDate: string };
  /** simplified = one fixed room per class, no room sheet; full = room pool scheduling. */
  roomMode?: RoomMode;
  dataSchemaVersion?: number;
  adjustments?: Adjustment[];
  electiveGroups?: ElectiveGroup[];
  lessonLogs?: LessonLog[];
  updatedAt?: string;
}

export type RunMode = 'single' | 'lan-server' | 'lan-client' | 'cloud';

export type Commit = (next: SchoolData, options?: { invalidate?: boolean; immediate?: boolean }) => void;







