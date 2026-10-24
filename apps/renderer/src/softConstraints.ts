import type { SchoolData, SoftRuleKind } from './types';

export interface SoftConstraintDefinition {
  kind: SoftRuleKind;
  label: string;
  description: string;
  defaultWeight: number;
}

/** The four constraints the solver actually scores today. TEACHER_CONTINUOUS is
 *  kept in existing data but not exposed because its score is always 0. */
export const SOFT_CONSTRAINT_DEFINITIONS: SoftConstraintDefinition[] = [
  {
    kind: 'SUBJECT_DISTRIBUTION',
    label: '学科分散',
    description: '同一班同一天尽量不重复同一学科。',
    defaultWeight: 3,
  },
  {
    kind: 'TEACHER_GAPS',
    label: '教师空档',
    description: '减少教师两节课之间的空节。',
    defaultWeight: 1,
  },
  {
    kind: 'TEACHER_WORKLOAD_BALANCE',
    label: '教师工作量均衡',
    description: '教师周课时尽量接近平均值。',
    defaultWeight: 2,
  },
  {
    kind: 'CLASS_GAPS',
    label: '班级空档',
    description: '减少班级常规日间时段第一和最后一节之间的空节，让同班课程更集中。',
    defaultWeight: 2,
  },
];

/** Old workspaces and old clients keep exactly the previous four defaults. */
export const BASE_SOFT_CONSTRAINTS: { kind: SoftRuleKind; weight: number }[] = [
  { kind: 'SUBJECT_DISTRIBUTION', weight: 3 },
  { kind: 'TEACHER_CONTINUOUS', weight: 2 },
  { kind: 'TEACHER_GAPS', weight: 1 },
  { kind: 'TEACHER_WORKLOAD_BALANCE', weight: 2 },
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
