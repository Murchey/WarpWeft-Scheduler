export type RuleImportance = 'must' | 'prefer' | 'avoid';

export type RuleKind =
  | 'TEACHER_MAX_DAILY'
  | 'TEACHER_MAX_CONSECUTIVE'
  | 'TEACHER_FREE_HALF_DAY'
  | 'SUBJECT_MAX_PER_DAY'
  | 'SUBJECT_TIME_PREFERENCE'
  | 'SUBJECT_AVOID_FIRST_LAST'
  | 'SUBJECT_SPREAD'
  | 'DOUBLE_PERIOD';

export type RuleScope =
  | { type: 'all' }
  | { type: 'grade'; grade: string }
  | { type: 'class'; classId: string }
  | { type: 'teacher'; teacherId: string }
  | { type: 'subject'; subjectId: string }
  | { type: 'room'; roomId: string };

export type RuleTime =
  | { type: 'all' }
  | { type: 'weekday'; days: number[] }
  | { type: 'periodRange'; days?: number[]; from: number; to: number };

export interface RuleInstance {
  id: string;
  kind: RuleKind;
  scope: RuleScope;
  time: RuleTime;
  importance: RuleImportance;
  params: Record<string, string | number>;
  enabled: boolean;
  note?: string;
  createdAt: string;
  source: 'preset' | 'manual' | 'import' | 'migration';
}

export interface CoursePlan {
  id: string;
  classId: string;
  subjectId: string;
  teacherId: string;
  weeklyPeriods: number;
  roomType?: string;
  fixedSlotId?: string;
  fixedSlotIds?: string[];
  consecutive?: number;
  pairId?: string;
}

export interface TimeSlot {
  id: string;
  day: number;
  period: number;
  label: string;
}

export interface RuleData {
  classes: { id: string; name: string; size?: number }[];
  teachers: { id: string; name: string }[];
  subjects: { id: string; name: string; preference?: 'morning' | 'afternoon' }[];
  rooms: { id: string; name: string; type: string; capacity: number }[];
  timeSlots: TimeSlot[];
  coursePlans: CoursePlan[];
  unavailableSlots?: { teacherId: string; slotId: string }[];
  rules?: RuleInstance[];
}

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
    available: true,
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
    description: '让学科尽量安排在上午或下午（软约束，仍可能被固定时间或教师时间覆盖）。',
    scopeType: 'subject',
    importanceOptions: ['prefer'],
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
    description: '让指定学科避开每天第一节或最后一节（软约束，仍可能因其他条件排入）。',
    scopeType: 'subject',
    importanceOptions: ['avoid'],
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
    description: '为指定学科安排连续两节；当前版本会成对占用连续时间格。',
    scopeType: 'subject',
    importanceOptions: ['must'],
    defaultImportance: 'must',
    paramFields: [{ key: 'periods', label: '连续节数', type: 'number', min: 2, max: 4 }],
    available: true,
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

export function createRule(data: RuleData, kind: RuleKind): RuleInstance {
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

export function scopeLabel(rule: RuleInstance, data: RuleData): string {
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

export function describeRule(rule: RuleInstance, data: RuleData): string {
  const scope = scopeLabel(rule, data);
  const max = Number(rule.params.maxPerDay ?? 1);
  const definition = definitionOf(rule.kind);
  switch (rule.kind) {
    case 'TEACHER_MAX_DAILY': return scope + ' 每天最多 ' + max + ' 节';
    case 'TEACHER_MAX_CONSECUTIVE': return scope + ' 连续上课不超过 ' + Number(rule.params.maxConsecutive ?? 1) + ' 节';
    case 'TEACHER_FREE_HALF_DAY': return scope + ' 每周至少 ' + Number(rule.params.minFreeHalfDays ?? 1) + ' 个半天无课';
    case 'SUBJECT_MAX_PER_DAY': return scope + ' 每天最多 ' + max + ' 节';
    case 'SUBJECT_TIME_PREFERENCE': {
      const target = rule.params.preference === 'afternoon' ? '下午' : '上午';
      return scope + (rule.importance === 'avoid' ? ' 避免安排在' : ' 尽量安排在') + target;
    }
    case 'SUBJECT_AVOID_FIRST_LAST': {
      const target = rule.params.avoid === 'last' ? '最后一节' : '第一节';
      return scope + (rule.importance === 'prefer' ? ' 尽量避开' : ' 避开') + target;
    }
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

export function ruleImpact(rule: RuleInstance, data: RuleData): RuleImpact {
  const plans = data.coursePlans.filter((plan) => planMatchesScope(plan, rule.scope));
  return {
    plans: plans.length,
    classes: new Set(plans.map((plan) => plan.classId)).size,
    teachers: new Set(plans.map((plan) => plan.teacherId)).size,
    lessons: plans.reduce((sum, plan) => sum + Number(plan.weeklyPeriods || 0), 0),
  };
}

export function matchedPlans(rule: RuleInstance, data: RuleData): CoursePlan[] {
  return data.coursePlans.filter((plan) => planMatchesScope(plan, rule.scope));
}

export function ruleWarnings(rule: RuleInstance, data: RuleData, allRules: RuleInstance[]): string[] {
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
  if (rule.kind === 'TEACHER_FREE_HALF_DAY') {
    const min = Number(rule.params.minFreeHalfDays ?? 0);
    const halfDays = new Set(data.timeSlots.map((slot) => slot.day)).size * 2 || 10;
    if (!Number.isFinite(min) || min < 1) warnings.push('半天无课目标至少为 1。');
    if (min > halfDays) warnings.push('目标超过可用半天数（约 ' + halfDays + ' 个）。');
  }
  if (rule.kind === 'DOUBLE_PERIOD') {
    for (const plan of plans) {
      if (plan.weeklyPeriods < 2) warnings.push('周课时少于 2 节，无法形成连堂。');
      else if (plan.weeklyPeriods % 2 === 1) warnings.push('周课时为奇数，最后一节会单排。');
    }
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

export function unscheduledHints(plan: CoursePlan, data: RuleData): string[] {
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

export function activeRules(data: RuleData): RuleInstance[] {
  return (data.rules ?? []).filter((rule) => rule.enabled);
}

export function ruleCountText(data: RuleData): string {
  const rules = data.rules ?? [];
  return rules.length === 0 ? '未设置' : String(rules.length) + ' 条';
}

export function teacherName(data: RuleData, id: string): string {
  return data.teachers.find((item) => item.id === id)?.name ?? id;
}

export function subjectName(data: RuleData, id: string): string {
  return data.subjects.find((item) => item.id === id)?.name ?? id;
}

export function className(data: RuleData, id: string): string {
  return data.classes.find((item) => item.id === id)?.name ?? id;
}

export function sortedSlots(data: RuleData): TimeSlot[] {
  return [...data.timeSlots].sort((a, b) => a.day - b.day || a.period - b.period);
}

export function simpleRuleList(data: RuleData): RuleInstance[] {
  return activeRules(data).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function chineseNumber(value: string): number {
  const map: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (/^\d+$/.test(value)) return Number(value);
  if (value === '十') return 10;
  if (value.includes('十')) {
    const [left, right] = value.split('十');
    return (left ? map[left] ?? 0 : 1) * 10 + (right ? map[right] ?? 0 : 0);
  }
  return map[value] ?? 0;
}

function numberInText(text: string, fallback: number): number {
  const match = text.match(/(\d+|[一二两三四五六七八九十]+)\s*(?:节|个|次)?/);
  const value = match ? chineseNumber(match[1]) : 0;
  return value > 0 ? value : fallback;
}

export interface ParsedRuleText {
  rule?: RuleInstance;
  error?: string;
}

export function parseRuleText(text: string, data: RuleData): ParsedRuleText {
  const source = text.trim();
  if (!source) return { error: '请输入一条规则，例如：数学每天不超过2节，尽量上午' };
  const subject = [...data.subjects].sort((a, b) => b.name.length - a.name.length).find((item) => source.includes(item.name));
  const teacher = [...data.teachers].sort((a, b) => b.name.length - a.name.length).find((item) => source.includes(item.name));
  const importance: RuleImportance = source.includes('必须') || source.includes('一定')
    ? 'must'
    : source.includes('避免') || source.includes('不要') || source.includes('不排')
      ? 'avoid'
      : 'prefer';
  const base = {
    id: 'rule-' + Math.random().toString(36).slice(2, 10),
    time: { type: 'all' } as RuleTime,
    enabled: true,
    note: source,
    createdAt: new Date().toISOString(),
    source: 'manual' as const,
  };
  if (teacher && source.includes('半天')) {
    return { rule: { ...base, kind: 'TEACHER_FREE_HALF_DAY', scope: { type: 'teacher', teacherId: teacher.id }, importance: 'prefer', params: { minFreeHalfDays: numberInText(source, 1) } } };
  }
  if (teacher && (source.includes('每天') || source.includes('一天')) && (source.includes('最多') || source.includes('不超过'))) {
    return { rule: { ...base, kind: 'TEACHER_MAX_DAILY', scope: { type: 'teacher', teacherId: teacher.id }, importance, params: { maxPerDay: numberInText(source, 1) } } };
  }
  if (teacher && (source.includes('连续') || source.includes('连堂'))) {
    return { rule: { ...base, kind: 'TEACHER_MAX_CONSECUTIVE', scope: { type: 'teacher', teacherId: teacher.id }, importance, params: { maxConsecutive: numberInText(source, 2) } } };
  }
  if (subject && (source.includes('连堂') || source.includes('连续'))) {
    return { rule: { ...base, kind: 'DOUBLE_PERIOD', scope: { type: 'subject', subjectId: subject.id }, importance: 'must', params: { periods: numberInText(source, 2) } } };
  }
  if (subject && (source.includes('上午') || source.includes('下午')) && !source.includes('不')) {
    return { rule: { ...base, kind: 'SUBJECT_TIME_PREFERENCE', scope: { type: 'subject', subjectId: subject.id }, importance: 'prefer', params: { preference: source.includes('下午') ? 'afternoon' : 'morning' } } };
  }
  if (subject && (source.includes('第一节') || source.includes('最后一节') || source.includes('首节') || source.includes('末节'))) {
    const avoid = source.includes('最后') || source.includes('末节') ? 'last' : 'first';
    return { rule: { ...base, kind: 'SUBJECT_AVOID_FIRST_LAST', scope: { type: 'subject', subjectId: subject.id }, importance: 'avoid', params: { avoid } } };
  }
  if (subject && (source.includes('分散') || source.includes('均匀'))) {
    return { rule: { ...base, kind: 'SUBJECT_SPREAD', scope: { type: 'subject', subjectId: subject.id }, importance: 'prefer', params: { maxPerDay: numberInText(source, 1) } } };
  }
  if (subject && source.includes('每天') && (source.includes('最多') || source.includes('不超过'))) {
    return { rule: { ...base, kind: 'SUBJECT_MAX_PER_DAY', scope: { type: 'subject', subjectId: subject.id }, importance, params: { maxPerDay: numberInText(source, 1) } } };
  }
  return { error: '暂时无法解析。可以试试：数学每天不超过2节；语文尽量上午；体育不排第一节；张老师每周至少2个半天无课。' };
}

export interface RuleConflict {
  ruleIds: string[];
  message: string;
}

export function findRuleConflicts(data: RuleData): RuleConflict[] {
  const rules = (data.rules ?? []).filter((rule) => rule.enabled);
  const conflicts: RuleConflict[] = [];
  for (let i = 0; i < rules.length; i += 1) {
    for (let j = i + 1; j < rules.length; j += 1) {
      const a = rules[i];
      const b = rules[j];
      if (a.kind !== b.kind) continue;
      if (JSON.stringify(a.scope) !== JSON.stringify(b.scope)) continue;
      const sameParams = JSON.stringify(a.params) === JSON.stringify(b.params);
      conflicts.push({
        ruleIds: [a.id, b.id],
        message: sameParams
          ? '同一对象存在两条完全相同的规则，建议删除一条。'
          : '同一对象存在两条同类但参数不同的规则，实际效果可能不确定。',
      });
    }
  }
  for (const rule of rules) {
    const warnings = ruleWarnings(rule, data, rules)
      .filter((warning) => !warning.startsWith('设为“必须”') && !warning.startsWith('同一对象') && !warning.includes('没有匹配的教学计划'));
    for (const warning of warnings) {
      conflicts.push({ ruleIds: [rule.id], message: warning });
    }
  }
  return conflicts.slice(0, 12);
}
