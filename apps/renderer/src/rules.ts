import type {
  ClassRoom,
  CoursePlan,
  RuleImportance,
  RuleInstance,
  RuleKind,
  RuleScope,
  RuleTime,
  SchoolData,
  Subject,
  Teacher,
  TimeSlot,
} from './types';

export interface RuleParamField {
  key: string;
  label: string;
  type: 'number' | 'select';
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
}

export interface RuleDefinition {
  kind: RuleKind;
  category: 'teacher' | 'subject' | 'structure';
  label: string;
  description: string;
  scopeType: 'teacher' | 'subject';
  importanceOptions: RuleImportance[];
  defaultImportance: RuleImportance;
  paramFields: RuleParamField[];
  available: boolean;
  supportNote?: string;
}

export const IMPORTANCE_LABELS: Record<RuleImportance, string> = {
  must: '必须',
  prefer: '尽量',
  avoid: '避免',
};

export const SYSTEM_RULES = [
  ['班级不撞课', '同一班级同一时间只安排一门课'],
  ['教师不撞课', '同一教师同一时间只安排一门课'],
  ['教室匹配', '教室类型和容量必须满足班级'],
  ['固定时间', '教学计划指定的时间优先占用'],
  ['教师不可用时间', '教师时间表中标记的不可用格不会排课'],
  ['锁定课程', '已锁定课程在重新排课时保留位置'],
];

export const RULE_DEFINITIONS: RuleDefinition[] = [
  {
    kind: 'TEACHER_MAX_DAILY',
    category: 'teacher',
    label: '教师每日上限',
    description: '限制一位教师一天最多上几节课。',
    scopeType: 'teacher',
    importanceOptions: ['must', 'prefer'],
    defaultImportance: 'prefer',
    paramFields: [{ key: 'maxPerDay', label: '每天最多', type: 'number', min: 1, max: 12 }],
    available: true,
  },
  {
    kind: 'TEACHER_MAX_CONSECUTIVE',
    category: 'teacher',
    label: '教师连续上限',
    description: '避免教师连续上太多节课。',
    scopeType: 'teacher',
    importanceOptions: ['must', 'prefer'],
    defaultImportance: 'prefer',
    paramFields: [{ key: 'maxConsecutive', label: '连续最多', type: 'number', min: 1, max: 8 }],
    available: true,
  },
  {
    kind: 'TEACHER_FREE_HALF_DAY',
    category: 'teacher',
    label: '教师半天无课',
    description: '每周为教师保留至少几个半天不排课。',
    scopeType: 'teacher',
    importanceOptions: ['prefer'],
    defaultImportance: 'prefer',
    paramFields: [{ key: 'minFreeHalfDays', label: '每周至少', type: 'number', min: 1, max: 10 }],
    available: false,
    supportNote: '当前版本先记录规则，半天无课优化在下一阶段接入。',
  },
  {
    kind: 'SUBJECT_MAX_PER_DAY',
    category: 'subject',
    label: '学科每日上限',
    description: '限制同一班级一天内同一学科最多几节。',
    scopeType: 'subject',
    importanceOptions: ['must', 'prefer'],
    defaultImportance: 'prefer',
    paramFields: [{ key: 'maxPerDay', label: '每天最多', type: 'number', min: 1, max: 8 }],
    available: true,
  },
  {
    kind: 'SUBJECT_TIME_PREFERENCE',
    category: 'subject',
    label: '学科时间偏好',
    description: '让学科尽量安排在上午或下午。',
    scopeType: 'subject',
    importanceOptions: ['prefer', 'avoid'],
    defaultImportance: 'prefer',
    paramFields: [{
      key: 'preference',
      label: '偏向',
      type: 'select',
      options: [{ value: 'morning', label: '上午' }, { value: 'afternoon', label: '下午' }],
    }],
    available: true,
  },
  {
    kind: 'SUBJECT_AVOID_FIRST_LAST',
    category: 'subject',
    label: '避开首末节',
    description: '让学科尽量避开每天第一节或最后一节。',
    scopeType: 'subject',
    importanceOptions: ['avoid', 'prefer'],
    defaultImportance: 'avoid',
    paramFields: [{
      key: 'avoid',
      label: '避开',
      type: 'select',
      options: [{ value: 'first', label: '第一节' }, { value: 'last', label: '最后一节' }],
    }],
    available: true,
  },
  {
    kind: 'SUBJECT_SPREAD',
    category: 'subject',
    label: '学科分散',
    description: '让同一学科分散到一周，而不是集中在同一天。',
    scopeType: 'subject',
    importanceOptions: ['prefer'],
    defaultImportance: 'prefer',
    paramFields: [{ key: 'maxPerDay', label: '每天最多', type: 'number', min: 1, max: 8 }],
    available: true,
  },
  {
    kind: 'DOUBLE_PERIOD',
    category: 'structure',
    label: '连堂/双节',
    description: '为指定学科安排连续两节。',
    scopeType: 'subject',
    importanceOptions: ['must'],
    defaultImportance: 'must',
    paramFields: [{ key: 'periods', label: '连续节数', type: 'number', min: 2, max: 4 }],
    available: false,
    supportNote: '连堂涉及课表结构，当前版本先记录规则，下一阶段接入求解器。',
  },
];

export function definitionOf(kind: RuleKind): RuleDefinition {
  const found = RULE_DEFINITIONS.find((item) => item.kind === kind);
  if (!found) throw new Error('未知规则类型：' + kind);
  return found;
}

export function defaultParams(kind: RuleKind): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  for (const field of definitionOf(kind).paramFields) {
    params[field.key] = field.type === 'number' ? (field.min ?? 1) : (field.options?.[0]?.value ?? '');
  }
  return params;
}

export function createRule(data: SchoolData, kind: RuleKind): RuleInstance {
  const definition = definitionOf(kind);
  const scope: RuleScope = definition.scopeType === 'teacher'
    ? { type: 'teacher', teacherId: data.teachers[0]?.id ?? '' }
    : { type: 'subject', subjectId: data.subjects[0]?.id ?? '' };
  return {
    id: 'rule-' + Math.random().toString(36).slice(2, 10),
    kind,
    scope,
    time: { type: 'all' },
    importance: definition.defaultImportance,
    params: defaultParams(kind),
    enabled: true,
    note: '',
    createdAt: new Date().toISOString(),
    source: 'manual',
  };
}

export function scopeLabel(rule: RuleInstance, data: SchoolData): string {
  const scope = rule.scope;
  if (scope.type === 'teacher') {
    return data.teachers.find((item) => item.id === scope.teacherId)?.name ?? '未选择教师';
  }
  if (scope.type === 'subject') {
    return data.subjects.find((item) => item.id === scope.subjectId)?.name ?? '未选择学科';
  }
  if (scope.type === 'class') {
    return data.classes.find((item) => item.id === scope.classId)?.name ?? '未选择班级';
  }
  if (scope.type === 'grade') return scope.grade || '未选择年级';
  if (scope.type === 'room') {
    return data.rooms.find((item) => item.id === scope.roomId)?.name ?? '未选择教室';
  }
  return '全校';
}

export function timeLabel(rule: RuleInstance): string {
  if (rule.time.type === 'all') return '全周';
  if (rule.time.type === 'weekday') {
    const names = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    return rule.time.days.map((day) => names[day] ?? day).join('、') || '全周';
  }
  return '第' + rule.time.from + '-' + rule.time.to + '节';
}

export function describeRule(rule: RuleInstance, data: SchoolData): string {
  const scope = scopeLabel(rule, data);
  const max = Number(rule.params.maxPerDay ?? 1);
  const definition = definitionOf(rule.kind);
  switch (rule.kind) {
    case 'TEACHER_MAX_DAILY': return scope + ' 每天最多 ' + max + ' 节';
    case 'TEACHER_MAX_CONSECUTIVE': return scope + ' 连续上课不超过 ' + Number(rule.params.maxConsecutive ?? 1) + ' 节';
    case 'TEACHER_FREE_HALF_DAY': return scope + ' 每周至少 ' + Number(rule.params.minFreeHalfDays ?? 1) + ' 个半天无课';
    case 'SUBJECT_MAX_PER_DAY': return scope + ' 每天最多 ' + max + ' 节';
    case 'SUBJECT_TIME_PREFERENCE': return scope + ' 尽量安排在' + (rule.params.preference === 'afternoon' ? '下午' : '上午');
    case 'SUBJECT_AVOID_FIRST_LAST': return scope + ' 避免' + (rule.params.avoid === 'last' ? '最后一节' : '第一节');
    case 'SUBJECT_SPREAD': return scope + ' 分散到一周（每天最多 ' + max + ' 节）';
    case 'DOUBLE_PERIOD': return scope + ' 连续排 ' + Number(rule.params.periods ?? 2) + ' 节';
    default: return definition.label;
  }
}

function planMatchesScope(plan: CoursePlan, scope: RuleScope): boolean {
  if (scope.type === 'teacher') return plan.teacherId === scope.teacherId;
  if (scope.type === 'subject') return plan.subjectId === scope.subjectId;
  if (scope.type === 'class') return plan.classId === scope.classId;
  return true;
}

export interface RuleImpact {
  classes: number;
  teachers: number;
  lessons: number;
  plans: number;
}

export function ruleImpact(rule: RuleInstance, data: SchoolData): RuleImpact {
  const plans = data.coursePlans.filter((plan) => planMatchesScope(plan, rule.scope));
  return {
    plans: plans.length,
    classes: new Set(plans.map((plan) => plan.classId)).size,
    teachers: new Set(plans.map((plan) => plan.teacherId)).size,
    lessons: plans.reduce((sum, plan) => sum + Number(plan.weeklyPeriods || 0), 0),
  };
}

export function matchedPlans(rule: RuleInstance, data: SchoolData): CoursePlan[] {
  return data.coursePlans.filter((plan) => planMatchesScope(plan, rule.scope));
}

export function ruleWarnings(rule: RuleInstance, data: SchoolData, allRules: RuleInstance[]): string[] {
  const warnings: string[] = [];
  const definition = definitionOf(rule.kind);
  if (!definition.available) warnings.push(definition.supportNote ?? '当前求解器暂未接入这条规则。');
  const plans = matchedPlans(rule, data);
  if (plans.length === 0) warnings.push('这条规则当前没有匹配的教学计划。');
  if (rule.kind === 'TEACHER_MAX_DAILY' || rule.kind === 'SUBJECT_MAX_PER_DAY' || rule.kind === 'SUBJECT_SPREAD') {
    const max = Number(rule.params.maxPerDay ?? 0);
    const days = new Set(data.timeSlots.map((slot) => slot.day)).size || 5;
    if (!Number.isFinite(max) || max < 1) warnings.push('每天上限至少为 1。');
    for (const plan of plans) {
      if (plan.weeklyPeriods > max * days && rule.importance === 'must') {
        warnings.push('教学计划「' + (data.subjects.find((item) => item.id === plan.subjectId)?.name ?? plan.subjectId) + '」周课时 ' + plan.weeklyPeriods + ' 可能超过上限。');
      }
    }
  }
  if (rule.kind === 'TEACHER_MAX_CONSECUTIVE') {
    const max = Number(rule.params.maxConsecutive ?? 0);
    if (!Number.isFinite(max) || max < 1) warnings.push('连续上限至少为 1。');
  }
  if (rule.importance === 'must' && definition.available) {
    warnings.push('设为“必须”可能导致无解；建议先用“尽量”试排。');
  }
  const duplicate = allRules.some((other) => other.id !== rule.id
    && other.enabled
    && other.kind === rule.kind
    && JSON.stringify(other.scope) === JSON.stringify(rule.scope));
  if (duplicate) warnings.push('同一对象已经有同类规则，可能重复或冲突。');
  return warnings;
}

export function unscheduledHints(plan: CoursePlan, data: SchoolData): string[] {
  const hints: string[] = [];
  const unavailable = (data.unavailableSlots ?? []).filter((item) => item.teacherId === plan.teacherId).length;
  if (unavailable > 0) hints.push('教师有 ' + unavailable + ' 个不可用时间格');
  const room = data.rooms.some((item) => (!plan.roomType || item.type === plan.roomType)
    && item.capacity >= (data.classes.find((klass) => klass.id === plan.classId)?.size ?? 0));
  if (!room) hints.push('没有满足类型/容量的教室');
  for (const rule of (data.rules ?? []).filter((item) => item.enabled)) {
    const def = definitionOf(rule.kind);
    if (!def.available) continue;
    const matched = matchedPlans(rule, data).some((item) => item.id === plan.id);
    if (matched) hints.push('受规则「' + describeRule(rule, data) + '」影响');
  }
  return hints.slice(0, 4);
}

export function activeRules(data: SchoolData): RuleInstance[] {
  return (data.rules ?? []).filter((rule) => rule.enabled);
}

export function ruleCountText(data: SchoolData): string {
  const rules = data.rules ?? [];
  return rules.length === 0 ? '未设置' : String(rules.length) + ' 条';
}

export function teacherName(data: SchoolData, id: string): string {
  return data.teachers.find((item) => item.id === id)?.name ?? id;
}

export function subjectName(data: SchoolData, id: string): string {
  return data.subjects.find((item) => item.id === id)?.name ?? id;
}

export function className(data: SchoolData, id: string): string {
  return data.classes.find((item) => item.id === id)?.name ?? id;
}

export function sortedSlots(data: SchoolData): TimeSlot[] {
  return [...data.timeSlots].sort((a, b) => a.day - b.day || a.period - b.period);
}

export function simpleRuleList(data: SchoolData): RuleInstance[] {
  return activeRules(data).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// Keep the imports used by generated type declarations in one place.
export type { ClassRoom, Subject, Teacher };
