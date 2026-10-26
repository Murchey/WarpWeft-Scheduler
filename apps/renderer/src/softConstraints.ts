import type { SchoolData, SoftRuleKind } from './types';

export interface SoftConstraintDefinition {
  kind: SoftRuleKind;
  label: string;
  description: string;
  defaultWeight: number;
}

/** The constraints the solver actually scores today. TEACHER_CONTINUOUS is
 *  kept in existing data but not exposed because its score is always 0. */
export const SOFT_CONSTRAINT_DEFINITIONS: SoftConstraintDefinition[] = [
  {
    kind: 'SUBJECT_DISTRIBUTION',
    label: '学科分散',
    description: '数字越大，越优先把同一学科分散到不同天；不保证绝对不重复。',
    defaultWeight: 3,
  },
  {
    kind: 'TEACHER_GAPS',
    label: '教师空档',
    description: '数字越大，越优先减少教师两节课之间的空节；不保证教师完全没有空节。',
    defaultWeight: 1,
  },
  {
    kind: 'TEACHER_WORKLOAD_BALANCE',
    label: '教师工作量均衡',
    description: '数字越大，越优先让教师周课时接近平均值。',
    defaultWeight: 2,
  },
  {
    kind: 'CLASS_GAPS',
    label: '班级空档',
    description: '数字越大，越优先把同班课程排成连续块；受教师/教室约束，不保证空档为 0。',
    defaultWeight: 2,
  },
  {
    kind: 'SUBJECT_TIME_PREFERENCE',
    label: '学科时段偏好',
    description: '按学科的「上午 / 下午」偏好排课：在「学科」表把主科设为上午、副科设为下午，再用这里的权重控制优先程度。',
    defaultWeight: 2,
  },
];

/** Old workspaces and old clients keep the previous defaults plus the new time-of-day objective. */
export const BASE_SOFT_CONSTRAINTS: { kind: SoftRuleKind; weight: number }[] = [
  { kind: 'SUBJECT_DISTRIBUTION', weight: 3 },
  { kind: 'TEACHER_CONTINUOUS', weight: 2 },
  { kind: 'TEACHER_GAPS', weight: 1 },
  { kind: 'TEACHER_WORKLOAD_BALANCE', weight: 2 },
  { kind: 'SUBJECT_TIME_PREFERENCE', weight: 2 },
];

/** Brand-new workspaces start with class gaps on; existing data stays opt-in. */
export const NEW_WORKSPACE_SOFT_CONSTRAINTS: { kind: SoftRuleKind; weight: number }[] = [
  ...BASE_SOFT_CONSTRAINTS,
  { kind: 'CLASS_GAPS', weight: 2 },
];

export function normalizeSoftConstraints(data: SchoolData): { kind: SoftRuleKind; weight: number }[] {
  const source = data.softConstraints ?? BASE_SOFT_CONSTRAINTS;
  const seen = new Set<SoftRuleKind>();
  const result: { kind: SoftRuleKind; weight: number }[] = [];
  for (const item of source) {
    if (!item || seen.has(item.kind)) continue;
    seen.add(item.kind);
    result.push({
      kind: item.kind,
      weight: Math.max(0, Math.min(5, Number(item.weight) || 0)),
    });
  }
  return result;
}

export function softWeight(data: SchoolData, kind: SoftRuleKind): number {
  return normalizeSoftConstraints(data).find((item) => item.kind === kind)?.weight ?? 0;
}

export function withSoftWeight(data: SchoolData, kind: SoftRuleKind, weight: number): SchoolData {
  const next = normalizeSoftConstraints(data).map((item) =>
    item.kind === kind ? { ...item, weight } : item,
  );
  if (!next.some((item) => item.kind === kind) && weight > 0) {
    next.push({ kind, weight });
  }
  return {
    ...data,
    softConstraints: next
      .map((item) => ({ ...item, weight: Math.max(0, Math.min(5, Math.round(Number(item.weight) || 0))) }))
      .filter((item) => item.weight > 0),
  };
}
