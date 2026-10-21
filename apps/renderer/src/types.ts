export interface School {
  id: string;
  name: string;
}

export interface ClassRoom {
  id: string;
  name: string;
  size: number;
  grade: string;
}

export interface Teacher {
  id: string;
  name: string;
}

export interface Subject {
  id: string;
  name: string;
}

export interface Room {
  id: string;
  name: string;
  capacity: number;
  type: string;
}

export interface TimeSlot {
  id: string;
  day: number;
  period: number;
  label: string;
}

export interface CoursePlan {
  id: string;
  classId: string;
  subjectId: string;
  teacherId: string;
  weeklyPeriods: number;
  roomType?: string;
  fixedSlotId?: string;
  consecutive?: number;
  locked?: boolean;
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

export interface SolverInput {
  protocolVersion: string;
  dataSnapshotVersion: string;
  timeSlots: TimeSlot[];
  classes: { id: string; name: string; size: number }[];
  teachers: Teacher[];
  rooms: Room[];
  coursePlans: CoursePlan[];
  unavailableSlots: { teacherId: string; slotId: string }[];
  lockedEntries: ScheduleEntry[];
  hardConstraints: string[];
  softConstraints: {
    kind:
      | 'SUBJECT_DISTRIBUTION'
      | 'TEACHER_CONTINUOUS'
      | 'TEACHER_GAPS'
      | 'TEACHER_WORKLOAD_BALANCE';
    weight: number;
  }[];
  timeLimitSeconds: number;
  randomSeed: number;
}

export interface SchoolData {
  school: School;
  classes: ClassRoom[];
  teachers: Teacher[];
  subjects: Subject[];
  rooms: Room[];
  timeSlots: TimeSlot[];
  coursePlans: CoursePlan[];
  unavailableSlots?: { teacherId: string; slotId: string }[];
  softConstraints?: { kind: SolverInput['softConstraints'][number]['kind']; weight: number }[];
  publishedVersions?: { id: string; createdAt: string; result: SolverOutput; note?: string }[];
  auditLog?: { id: string; at: string; action: string; detail: string }[];
  candidate?: SolverOutput | null;
  published?: SolverOutput | null;
  updatedAt?: string;
}

export type RunMode = 'single' | 'lan-server' | 'lan-client' | 'cloud';
