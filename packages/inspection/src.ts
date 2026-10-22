/**
 * Timetable inspection: a read-only health check of a candidate timetable.
 *
 * It is deliberately dependency-free so the renderer, the API and the node
 * tests can all execute the same code. Hard conflicts are structural
 * (class/teacher/room double-booking, fixed times, unavailable slots, room
 * mismatch); rule violations are re-derived from the rule definitions the
 * solver was given, so the report never claims more than the engine promises.
 */

export type InspectionSeverity = 'hard' | 'must' | 'prefer';

export type InspectionCategory =
  | 'CLASS_CONFLICT'
  | 'TEACHER_CONFLICT'
  | 'ROOM_CONFLICT'
  | 'FIXED_SLOT'
  | 'TEACHER_UNAVAILABLE'
  | 'SLOT_KIND'
  | 'ROOM_MISMATCH'
  | 'MISSING_REFERENCE'
  | 'RULE'
  | 'UNPLACED';

export const CATEGORY_LABELS: Record<InspectionCategory, string> = {
  CLASS_CONFLICT: '班级冲突',
  TEACHER_CONFLICT: '教师冲突',
  ROOM_CONFLICT: '教室冲突',
  FIXED_SLOT: '固定时间',
  TEACHER_UNAVAILABLE: '教师不可用',
  SLOT_KIND: '时段类型',
  ROOM_MISMATCH: '教室不匹配',
  MISSING_REFERENCE: '引用缺失',
  RULE: '规则违反',
  UNPLACED: '未排课时',
};

export const KIND_LABELS: Record<string, string> = {
  morning: '早读',
  regular: '常规',
  evening: '晚自习',
  makeup: '补课',
};

export interface InspectionRefs {
  entryIds?: string[];
  planIds?: string[];
  classIds?: string[];
  teacherIds?: string[];
  roomIds?: string[];
  slotIds?: string[];
  ruleIds?: string[];
}

export interface InspectionIssue {
  id: string;
  severity: InspectionSeverity;
  category: InspectionCategory;
  title: string;
  detail: string;
  refs: InspectionRefs;
}

export interface UtilizationRow {
  id: string;
  name: string;
  used: number;
  capacity: number;
  ratio: number;
  warning: boolean;
}

export interface UnplacedRow {
  planId: string;
  classId: string;
  subjectId: string;
  teacherId: string;
  missing: number;
}

export interface InspectionSummary {
  entries: number;
  planned: number;
  placed: number;
  unplaced: number;
  hard: number;
  must: number;
  prefer: number;
  conflictEntryIds: string[];
}

export interface InspectionReport {
  generatedAt: string;
  ok: boolean;
  elapsedMs: number;
  summary: InspectionSummary;
  issues: InspectionIssue[];
  unplaced: UnplacedRow[];
  utilization: {
    rooms: UtilizationRow[];
    teachers: UtilizationRow[];
    classes: UtilizationRow[];
  };
}

export interface InspectionRule {
  id: string;
  kind: string;
  importance: string;
  enabled: boolean;
  scope: { type: string; classId?: string; teacherId?: string; subjectId?: string; grade?: string; roomId?: string };
  time: { type: string; days?: number[]; from?: number; to?: number };
  params: Record<string, string | number>;
}

export interface InspectionInput {
  timeSlots: { id: string; day: number; period: number; label: string; kind?: string }[];
  classes: { id: string; name: string; size: number; grade?: string }[];
  teachers: { id: string; name: string }[];
  subjects: { id: string; name: string }[];
  rooms: { id: string; name: string; capacity: number; type: string }[];
  coursePlans: {
    id: string;
    classId: string;
    subjectId: string;
    teacherId: string;
    weeklyPeriods: number;
    roomType?: string;
    fixedSlotId?: string;
    weeks?: string;
    kind?: string;
  }[];
  entries: {
    id: string;
    coursePlanId: string;
    classId: string;
    teacherId: string;
    roomId: string;
    slotId: string;
    weeks?: string;
    groupId?: string;
    blockId?: string;
  }[];
  electiveGroups?: { id: string; name?: string; subjectId: string; classIds: string[]; blocks: { id: string; teacherId: string; roomType?: string }[] }[];
  unavailableSlots?: { teacherId: string; slotId: string }[];
  rules?: InspectionRule[];
}

const DAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** Week parity bit set: odd = 1, even = 2, every week = 3. */
export function weekMask(weeks?: string): number {
  if (weeks === 'odd') return 1;
  if (weeks === 'even') return 2;
  return 3;
}

export function weeksOverlap(a: string | undefined, b: string | undefined): boolean {
  return (weekMask(a) & weekMask(b)) !== 0;
}

export function weekLabel(mask: number): string {
  return mask === 1 ? '单周' : mask === 2 ? '双周' : '每周';
}

function dayName(day: number): string {
  return DAY_NAMES[day] ?? '第' + day + '天';
}

function pct(used: number, capacity: number): number {
  if (capacity <= 0) return 0;
  return Math.round((used / capacity) * 1000) / 1000;
}

/** `1,2,3` style list used in report wording. */
function listText(items: string[], limit = 6): string {
  const unique = Array.from(new Set(items.filter(Boolean)));
  if (unique.length <= limit) return unique.join('、');
  return unique.slice(0, limit).join('、') + ' 等 ' + unique.length + ' 项';
}

export function inspectTimetable(input: InspectionInput): InspectionReport {
  const started = Date.now();
  const slots = new Map(input.timeSlots.map((slot) => [slot.id, slot]));
  const classes = new Map(input.classes.map((item) => [item.id, item]));
  const teachers = new Map(input.teachers.map((item) => [item.id, item]));
  const subjects = new Map(input.subjects.map((item) => [item.id, item]));
  const rooms = new Map(input.rooms.map((item) => [item.id, item]));
  const plans = new Map(input.coursePlans.map((item) => [item.id, item]));
  const rules = (input.rules ?? []).filter((rule) => rule.enabled);
  const unavailable = new Set((input.unavailableSlots ?? []).map((item) => item.teacherId + '|' + item.slotId));

  const issues: InspectionIssue[] = [];
  const conflictEntryIds = new Set<string>();
  const issue = (
    category: InspectionCategory,
    severity: InspectionSeverity,
    title: string,
    detail: string,
    refs: InspectionRefs,
  ) => {
    issues.push({ id: 'issue-' + (issues.length + 1), severity, category, title, detail, refs });
    if (severity === 'hard') for (const id of refs.entryIds ?? []) conflictEntryIds.add(id);
  };

  const className = (id: string) => classes.get(id)?.name ?? (id || '未知班级');
  const teacherName = (id: string) => teachers.get(id)?.name ?? (id || '未知教师');
  const roomName = (id: string) => rooms.get(id)?.name ?? (id || '未知教室');
  const subjectName = (id: string) => subjects.get(id)?.name ?? (id || '未知学科');
  const slotLabel = (id: string) => slots.get(id)?.label ?? '未知时段';

  const electiveGroups = new Map((input.electiveGroups ?? []).map((group) => [group.id, group]));
  const classLabel = (entry: InspectionInput['entries'][number]) =>
    entry.groupId ? electiveGroups.get(entry.groupId)?.name ?? entry.groupId : className(entry.classId);

  const validEntries = input.entries.filter((entry) => {
    const problems: string[] = [];
    if (entry.groupId) {
      // Elective block entries belong to a group, not to a course plan/class.
      if (!electiveGroups.has(entry.groupId)) problems.push('走班组');
      if (!teachers.has(entry.teacherId)) problems.push('教师');
      if (!rooms.has(entry.roomId)) problems.push('教室');
      if (!slots.has(entry.slotId)) problems.push('时间段');
    } else {
      if (!plans.has(entry.coursePlanId)) problems.push('教学计划');
      if (!classes.has(entry.classId)) problems.push('班级');
      if (!teachers.has(entry.teacherId)) problems.push('教师');
      if (!rooms.has(entry.roomId)) problems.push('教室');
      if (!slots.has(entry.slotId)) problems.push('时间段');
    }
    if (problems.length === 0) return true;
    issue(
      'MISSING_REFERENCE',
      'hard',
      '课表条目引用了不存在的资源',
      '条目 ' + entry.id + ' 缺少：' + problems.join('、'),
      { entryIds: [entry.id] },
    );
    return false;
  });

  const groupBy = (keyOf: (entry: InspectionInput['entries'][number]) => string) => {
    const groups = new Map<string, InspectionInput['entries']>();
    for (const entry of validEntries) {
      const key = keyOf(entry);
      const list = groups.get(key);
      if (list) list.push(entry);
      else groups.set(key, [entry]);
    }
    return groups;
  };

  // Elective entries occupy every member class of their group. All blocks of
  // one group lesson count as a single occupancy, otherwise the blocks would
  // look like three lessons fighting for the same class slot.
  const classSlotGroups = new Map<string, InspectionInput['entries']>();
  for (const entry of validEntries) {
    const classIds = entry.groupId
      ? electiveGroups.get(entry.groupId)?.classIds ?? []
      : [entry.classId];
    for (const classId of classIds) {
      const key = 'class|' + classId + '|' + entry.slotId;
      const list = classSlotGroups.get(key);
      if (!list) {
        classSlotGroups.set(key, [entry]);
        continue;
      }
      if (entry.groupId) {
        const already = list.some((item) => item.groupId === entry.groupId);
        if (already) continue;
      }
      list.push(entry);
    }
  }

  // ---- structural conflicts ------------------------------------------------
  // Odd and even lessons may share a slot, so only entries whose week masks
  // overlap are reported as a clash.
  const weeksOfEntry = (entry: InspectionInput['entries'][number]): string =>
    plans.get(entry.coursePlanId)?.weeks ?? entry.weeks ?? 'all';
  const overlapping = (group: InspectionInput['entries']) => {
    const flagged = new Set<string>();
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        if (weeksOverlap(weeksOfEntry(group[i]), weeksOfEntry(group[j]))) {
          flagged.add(group[i].id);
          flagged.add(group[j].id);
        }
      }
    }
    return group.filter((entry) => flagged.has(entry.id));
  };
  for (const [key, group] of classSlotGroups) {
    const clashing = overlapping(group);
    if (clashing.length <= 1) continue;
    const [classId, slotId] = key.split('|').slice(1);
    issue(
      'CLASS_CONFLICT',
      'hard',
      className(classId) + ' ' + slotLabel(slotId) + ' 同时排了 ' + clashing.length + ' 门课',
      clashing
        .map((entry) => {
          const subjectId = entry.groupId
            ? electiveGroups.get(entry.groupId)?.subjectId ?? ''
            : plans.get(entry.coursePlanId)?.subjectId ?? '';
          const label = entry.groupId ? '走班·' + subjectName(subjectId) : subjectName(subjectId);
          return label + '（' + weekLabel(weekMask(weeksOfEntry(entry))) + '）';
        })
        .join(' / '),
      { entryIds: clashing.map((entry) => entry.id), classIds: [classId], slotIds: [slotId] },
    );
  }
  for (const [key, group] of groupBy((entry) => 'teacher|' + entry.teacherId + '|' + entry.slotId)) {
    const clashing = overlapping(group);
    if (clashing.length <= 1) continue;
    const [teacherId, slotId] = key.split('|').slice(1);
    issue(
      'TEACHER_CONFLICT',
      'hard',
      teacherName(teacherId) + ' ' + slotLabel(slotId) + ' 同时被安排了 ' + clashing.length + ' 节课',
      clashing.map((entry) => classLabel(entry)).join('；'),
      { entryIds: clashing.map((entry) => entry.id), teacherIds: [teacherId], slotIds: [slotId] },
    );
  }
  for (const [key, group] of groupBy((entry) => 'room|' + entry.roomId + '|' + entry.slotId)) {
    const clashing = overlapping(group);
    if (clashing.length <= 1) continue;
    const [roomId, slotId] = key.split('|').slice(1);
    issue(
      'ROOM_CONFLICT',
      'hard',
      roomName(roomId) + ' ' + slotLabel(slotId) + ' 被 ' + clashing.length + ' 门课占用',
      clashing.map((entry) => classLabel(entry)).join('、'),
      { entryIds: clashing.map((entry) => entry.id), roomIds: [roomId], slotIds: [slotId] },
    );
  }

  // ---- fixed time / unavailable / room fit ---------------------------------
  // Group by plan/room so one broken plan reads as one line ("3 节") instead of
  // three near-identical rows.
  const fixedByPlan = new Map<string, InspectionInput['entries']>();
  const unavailableBySlot = new Map<string, InspectionInput['entries']>();
  const capacityByRoom = new Map<string, InspectionInput['entries']>();
  const roomTypeByKey = new Map<string, { entries: InspectionInput['entries']; roomType: string; subjectId: string }>();
  for (const entry of validEntries) {
    const plan = plans.get(entry.coursePlanId);
    if (!plan) continue;
    const slotKind = slots.get(entry.slotId)?.kind ?? 'regular';
    const planKind = plan.kind ?? 'regular';
    if (slotKind !== planKind) {
      issue(
        'SLOT_KIND',
        'hard',
        subjectName(plan.subjectId) + ' 被排进了' + KIND_LABELS[slotKind] + '时段',
        className(entry.classId) + ' · ' + slotLabel(entry.slotId) + '；计划的时段类型是「' + KIND_LABELS[planKind] + '」',
        { entryIds: [entry.id], planIds: [plan.id], classIds: [entry.classId], slotIds: [entry.slotId] },
      );
    }
    if (plan.fixedSlotId && entry.slotId !== plan.fixedSlotId) {
      fixedByPlan.set(plan.id, [...(fixedByPlan.get(plan.id) ?? []), entry]);
    }
    if (unavailable.has(entry.teacherId + '|' + entry.slotId)) {
      const key = entry.teacherId + '|' + entry.slotId;
      unavailableBySlot.set(key, [...(unavailableBySlot.get(key) ?? []), entry]);
    }
    const room = rooms.get(entry.roomId);
    const klass = classes.get(entry.classId);
    if (room && klass) {
      if (room.capacity < klass.size) {
        capacityByRoom.set(room.id, [...(capacityByRoom.get(room.id) ?? []), entry]);
      }
      if (plan.roomType && plan.roomType !== room.type) {
        const key = room.id + '|' + plan.roomType;
        const bucket = roomTypeByKey.get(key) ?? { entries: [], roomType: plan.roomType, subjectId: plan.subjectId };
        bucket.entries.push(entry);
        roomTypeByKey.set(key, bucket);
      }
    }
  }
  for (const [planId, group] of fixedByPlan) {
    const plan = plans.get(planId);
    if (!plan) continue;
    issue(
      'FIXED_SLOT',
      'hard',
      className(plan.classId) + ' ' + subjectName(plan.subjectId) + ' 未排在固定时间',
      '计划要求 ' + slotLabel(plan.fixedSlotId ?? '') + '，实际 ' + listText(group.map((entry) => slotLabel(entry.slotId))) +
        (group.length > 1 ? '（' + group.length + ' 节）' : ''),
      {
        entryIds: group.map((entry) => entry.id),
        planIds: [planId],
        classIds: [plan.classId],
        slotIds: group.map((entry) => entry.slotId),
      },
    );
  }
  for (const [key, group] of unavailableBySlot) {
    const [teacherId] = key.split('|');
    issue(
      'TEACHER_UNAVAILABLE',
      'hard',
      teacherName(teacherId) + ' 在不可用时间被排课',
      listText(group.map((entry) => slotLabel(entry.slotId) + '（' + className(entry.classId) + '）')),
      { entryIds: group.map((entry) => entry.id), teacherIds: [teacherId], slotIds: group.map((entry) => entry.slotId) },
    );
  }
  for (const [roomId, group] of capacityByRoom) {
    const room = rooms.get(roomId);
    if (!room) continue;
    const worst = group
      .map((entry) => classes.get(entry.classId))
      .filter((klass): klass is { id: string; name: string; size: number } => Boolean(klass))
      .sort((a, b) => b.size - a.size)[0];
    issue(
      'ROOM_MISMATCH',
      'hard',
      roomName(roomId) + ' 容量不足',
      (worst ? worst.name + ' 需要 ' + worst.size + ' 座，' : '') + room.name + ' 只有 ' + room.capacity + ' 座 · 共 ' + group.length + ' 节',
      { entryIds: group.map((entry) => entry.id), roomIds: [roomId], classIds: group.map((entry) => entry.classId) },
    );
  }
  for (const bucket of roomTypeByKey.values()) {
    const room = rooms.get(bucket.entries[0]?.roomId ?? '');
    if (!room) continue;
    issue(
      'ROOM_MISMATCH',
      'hard',
      room.name + ' 类型不匹配',
      subjectName(bucket.subjectId) + ' 需要「' + bucket.roomType + '」，实际是「' + room.type + '」 · 共 ' + bucket.entries.length + ' 节',
      {
        entryIds: bucket.entries.map((entry) => entry.id),
        roomIds: [room.id],
        planIds: bucket.entries.map((entry) => entry.coursePlanId),
      },
    );
  }

  // ---- rules ---------------------------------------------------------------
  const dayRange = new Map<number, { min: number; max: number }>();
  for (const slot of input.timeSlots) {
    const current = dayRange.get(slot.day) ?? { min: slot.period, max: slot.period };
    dayRange.set(slot.day, { min: Math.min(current.min, slot.period), max: Math.max(current.max, slot.period) });
  }

  const ruleApplies = (rule: InspectionRule, entry: InspectionInput['entries'][number], day: number, period: number): boolean => {
    const scope = rule.scope ?? { type: 'all' };
    if (scope.type === 'teacher' && scope.teacherId !== entry.teacherId) return false;
    if (scope.type === 'subject' && scope.subjectId !== plans.get(entry.coursePlanId)?.subjectId) return false;
    if (scope.type === 'class' && scope.classId !== entry.classId) return false;
    if (scope.type === 'room' && scope.roomId !== entry.roomId) return false;
    if (scope.type === 'grade') {
      const klass = classes.get(entry.classId);
      if (!klass || (klass.grade ?? '') !== (scope.grade ?? '')) return false;
    }
    const time = rule.time ?? { type: 'all' };
    if (time.type === 'weekday' && !(time.days ?? []).includes(day)) return false;
    if (time.type === 'periodRange' && (period < (time.from ?? 1) || period > (time.to ?? 12))) return false;
    return true;
  };

  const entriesOf = (rule: InspectionRule) =>
    validEntries
      .map((entry) => ({ entry, slot: slots.get(entry.slotId)!, mask: weekMask(weeksOfEntry(entry)) }))
      .filter((item) => slotOf(item.entry) && ruleApplies(rule, item.entry, item.slot.day, item.slot.period));
  const slotOf = (entry: InspectionInput['entries'][number]) => slots.get(entry.slotId);

  const ruleIssue = (rule: InspectionRule, title: string, detail: string, refs: InspectionRefs) => {
    const severity: InspectionSeverity = rule.importance === 'must' ? 'must' : 'prefer';
    issue('RULE', severity, title, detail, { ...refs, ruleIds: [rule.id] });
  };

  /** Lessons that actually fall in odd / even weeks for this bucket. */
  const parityCounts = (items: { mask: number }[]) => ({
    odd: items.filter((item) => (item.mask & 1) !== 0).length,
    even: items.filter((item) => (item.mask & 2) !== 0).length,
  });
  const parityScope = (odd: boolean, even: boolean) => (odd && even ? '单双周' : odd ? '单周' : '双周');

  for (const rule of rules) {
    const matched = entriesOf(rule);
    if (matched.length === 0) continue;
    const number = (key: string, fallback: number) => {
      const value = Number(rule.params?.[key]);
      return Number.isFinite(value) && value > 0 ? value : fallback;
    };
    if (rule.kind === 'TEACHER_MAX_DAILY' || rule.kind === 'TEACHER_MAX_CONSECUTIVE') {
      const byTeacherDay = new Map<string, { teacherId: string; day: number; items: typeof matched }>();
      for (const item of matched) {
        const key = item.entry.teacherId + '|' + item.slot.day;
        const bucket = byTeacherDay.get(key);
        if (bucket) bucket.items.push(item);
        else byTeacherDay.set(key, { teacherId: item.entry.teacherId, day: item.slot.day, items: [item] });
      }
      for (const bucket of byTeacherDay.values()) {
        if (rule.kind === 'TEACHER_MAX_DAILY') {
          const max = number('maxPerDay', 1);
          const counts = parityCounts(bucket.items);
          if (counts.odd <= max && counts.even <= max) continue;
          ruleIssue(
            rule,
            teacherName(bucket.teacherId) + ' ' + dayName(bucket.day) + ' 在' + parityScope(counts.odd > max, counts.even > max) +
              '排了 ' + Math.max(counts.odd, counts.even) + ' 节（上限 ' + max + '）',
            listText(bucket.items.map((item) => slotLabel(item.entry.slotId))),
            { teacherIds: [bucket.teacherId], entryIds: bucket.items.map((item) => item.entry.id), slotIds: bucket.items.map((item) => item.entry.slotId) },
          );
        } else {
          const max = number('maxConsecutive', 1);
          const periodsFor = (bit: number) =>
            Array.from(new Set(bucket.items.filter((item) => (item.mask & bit) !== 0).map((item) => item.slot.period))).sort((a, b) => a - b);
          const firstRunOver = (periods: number[]): number[] | null => {
            let run: number[] = [];
            for (const period of periods) {
              if (run.length > 0 && period === run[run.length - 1] + 1) run.push(period);
              else run = [period];
              if (run.length > max) return run;
            }
            return null;
          };
          const oddRun = firstRunOver(periodsFor(1));
          const evenRun = firstRunOver(periodsFor(2));
          if (!oddRun && !evenRun) continue;
          const run = oddRun ?? evenRun!;
          ruleIssue(
            rule,
            teacherName(bucket.teacherId) + ' ' + dayName(bucket.day) + ' 在' + parityScope(Boolean(oddRun), Boolean(evenRun)) +
              '连续上课 ' + run.length + ' 节（上限 ' + max + '）',
            listText(run.map((period) => '第' + period + '节')),
            {
              teacherIds: [bucket.teacherId],
              entryIds: bucket.items.filter((item) => run.includes(item.slot.period)).map((item) => item.entry.id),
            },
          );
        }
      }
      continue;
    }
    if (rule.kind === 'SUBJECT_MAX_PER_DAY' || rule.kind === 'SUBJECT_SPREAD') {
      const max = number('maxPerDay', 1);
      const buckets = new Map<string, { classId: string; subjectId: string; day: number; items: typeof matched }>();
      for (const item of matched) {
        const subjectId = plans.get(item.entry.coursePlanId)?.subjectId ?? '';
        const key = item.entry.classId + '|' + subjectId + '|' + item.slot.day;
        const bucket = buckets.get(key);
        if (bucket) bucket.items.push(item);
        else buckets.set(key, { classId: item.entry.classId, subjectId, day: item.slot.day, items: [item] });
      }
      for (const bucket of buckets.values()) {
        const counts = parityCounts(bucket.items);
        if (counts.odd <= max && counts.even <= max) continue;
        ruleIssue(
          rule,
          className(bucket.classId) + ' ' + dayName(bucket.day) + ' ' + subjectName(bucket.subjectId) +
            ' 在' + parityScope(counts.odd > max, counts.even > max) + '排了 ' + Math.max(counts.odd, counts.even) + ' 节（上限 ' + max + '）',
          listText(bucket.items.map((item) => slotLabel(item.entry.slotId))),
          { classIds: [bucket.classId], entryIds: bucket.items.map((item) => item.entry.id) },
        );
      }
      continue;
    }
    if (rule.kind === 'SUBJECT_TIME_PREFERENCE') {
      const preference = String(rule.params?.preference ?? 'morning');
      const buckets = new Map<string, { classId: string; subjectId: string; wrong: typeof matched; total: number }>();
      for (const item of matched) {
        const subjectId = plans.get(item.entry.coursePlanId)?.subjectId ?? '';
        const key = item.entry.classId + '|' + subjectId;
        const range = dayRange.get(item.slot.day) ?? { min: 1, max: 1 };
        const mid = Math.floor((range.min + range.max) / 2);
        const morning = item.slot.period <= mid;
        const wrong = preference === 'afternoon' ? morning : !morning;
        const bucket = buckets.get(key) ?? { classId: item.entry.classId, subjectId, wrong: [], total: 0 };
        bucket.total += 1;
        if (wrong) bucket.wrong.push(item);
        buckets.set(key, bucket);
      }
      for (const bucket of buckets.values()) {
        if (bucket.wrong.length === 0) continue;
        ruleIssue(
          rule,
          className(bucket.classId) + ' ' + subjectName(bucket.subjectId) + ' 有 ' + bucket.wrong.length + '/' + bucket.total + ' 节不在' + (preference === 'afternoon' ? '下午' : '上午'),
          listText(bucket.wrong.map((item) => slotLabel(item.entry.slotId))),
          { classIds: [bucket.classId], entryIds: bucket.wrong.map((item) => item.entry.id) },
        );
      }
      continue;
    }
    if (rule.kind === 'SUBJECT_AVOID_FIRST_LAST') {
      const avoid = String(rule.params?.avoid ?? 'first');
      const hits = matched.filter((item) => {
        const range = dayRange.get(item.slot.day) ?? { min: item.slot.period, max: item.slot.period };
        return avoid === 'last' ? item.slot.period === range.max : item.slot.period === range.min;
      });
      if (hits.length === 0) continue;
      const first = hits[0];
      ruleIssue(
        rule,
        subjectName(plans.get(first.entry.coursePlanId)?.subjectId ?? '') + ' 有 ' + hits.length + ' 节落在' + (avoid === 'last' ? '最后一节' : '第一节'),
        listText(hits.map((item) => className(item.entry.classId) + ' ' + slotLabel(item.entry.slotId))),
        { entryIds: hits.map((item) => item.entry.id) },
      );
      continue;
    }
    if (rule.kind === 'DOUBLE_PERIOD') {
      const desired = Math.max(2, number('periods', 2));
      const buckets = new Map<string, { classId: string; subjectId: string; day: number; mask: number; periods: number[]; items: typeof matched }>();
      for (const item of matched) {
        const subjectId = plans.get(item.entry.coursePlanId)?.subjectId ?? '';
        const key = item.entry.classId + '|' + subjectId + '|' + item.slot.day + '|' + item.mask;
        const bucket = buckets.get(key) ?? { classId: item.entry.classId, subjectId, day: item.slot.day, mask: item.mask, periods: [], items: [] };
        bucket.periods.push(item.slot.period);
        bucket.items.push(item);
        buckets.set(key, bucket);
      }
      for (const bucket of buckets.values()) {
        const unique = Array.from(new Set(bucket.periods)).sort((a, b) => a - b);
        let adjacent = 0;
        for (let index = 1; index < unique.length; index += 1) if (unique[index] === unique[index - 1] + 1) adjacent += 1;
        const expected = Math.floor(unique.length / desired);
        if (adjacent >= expected) continue;
        ruleIssue(
          rule,
          className(bucket.classId) + ' ' + subjectName(bucket.subjectId) + ' ' + dayName(bucket.day) +
            (bucket.mask === 3 ? '' : '（' + weekLabel(bucket.mask) + '）') + ' 连堂不足',
          '需要 ' + expected + ' 组连续 ' + desired + ' 节，实际相邻 ' + adjacent + ' 组',
          { classIds: [bucket.classId], entryIds: bucket.items.map((item) => item.entry.id) },
        );
      }
      continue;
    }
    if (rule.kind === 'TEACHER_FREE_HALF_DAY') {
      const minimum = number('minFreeHalfDays', 1);
      const perTeacher = new Map<string, Map<number, number[]>>();
      for (const item of matched) {
        const byDay = perTeacher.get(item.entry.teacherId) ?? new Map<number, number[]>();
        const periods = byDay.get(item.slot.day) ?? [];
        periods.push(item.slot.period);
        byDay.set(item.slot.day, periods);
        perTeacher.set(item.entry.teacherId, byDay);
      }
      for (const [teacherId, byDay] of perTeacher) {
        let free = 0;
        for (const [day, range] of dayRange) {
          const mid = Math.floor((range.min + range.max) / 2);
          const periods = byDay.get(day) ?? [];
          if (!periods.some((period) => period <= mid)) free += 1;
          if (!periods.some((period) => period > mid)) free += 1;
        }
        if (free >= minimum) continue;
        ruleIssue(
          rule,
          teacherName(teacherId) + ' 只有 ' + free + ' 个半天无课（要求 ≥ ' + minimum + '）',
          '按一周 ' + dayRange.size + ' 天计算',
          { teacherIds: [teacherId] },
        );
      }
      continue;
    }
    // Unknown kinds are reported so a newer rule never passes silently.
    ruleIssue(rule, '未实现的规则类型：' + rule.kind, '检测器无法判断该规则是否被满足。', {});
  }

  // ---- unplaced lessons ----------------------------------------------------
  const placedByPlan = new Map<string, number>();
  for (const entry of validEntries) placedByPlan.set(entry.coursePlanId, (placedByPlan.get(entry.coursePlanId) ?? 0) + 1);
  const unplaced: UnplacedRow[] = [];
  for (const plan of input.coursePlans) {
    const placed = placedByPlan.get(plan.id) ?? 0;
    const missing = Number(plan.weeklyPeriods || 0) - placed;
    if (missing > 0) {
      unplaced.push({ planId: plan.id, classId: plan.classId, subjectId: plan.subjectId, teacherId: plan.teacherId, missing });
    }
  }
  if (unplaced.length > 0) {
    const totalMissing = unplaced.reduce((sum, row) => sum + row.missing, 0);
    issue(
      'UNPLACED',
      'hard',
      '还有 ' + totalMissing + ' 课时未排',
      unplaced
        .slice(0, 8)
        .map((row) => className(row.classId) + ' ' + subjectName(row.subjectId) + ' 缺 ' + row.missing)
        .join('；') + (unplaced.length > 8 ? ' 等 ' + unplaced.length + ' 项' : ''),
      { planIds: unplaced.map((row) => row.planId), classIds: unplaced.map((row) => row.classId) },
    );
  }

  // ---- utilization ---------------------------------------------------------
  const ROOM_WARN = 0.85;
  const roomTypes = Array.from(new Set(input.rooms.map((room) => room.type)));
  const roomRows: UtilizationRow[] = roomTypes.map((type) => {
    const roomIds = input.rooms.filter((room) => room.type === type).map((room) => room.id);
    const idSet = new Set(roomIds);
    const used = validEntries.filter((entry) => idSet.has(entry.roomId)).length;
    const capacity = roomIds.length * input.timeSlots.length;
    const ratio = pct(used, capacity);
    return { id: 'type:' + type, name: type + '（' + roomIds.length + ' 间）', used, capacity, ratio, warning: ratio > ROOM_WARN };
  });

  const unavailableByTeacher = new Map<string, number>();
  for (const item of input.unavailableSlots ?? []) {
    unavailableByTeacher.set(item.teacherId, (unavailableByTeacher.get(item.teacherId) ?? 0) + 1);
  }
  const usedByTeacher = new Map<string, number>();
  for (const entry of validEntries) usedByTeacher.set(entry.teacherId, (usedByTeacher.get(entry.teacherId) ?? 0) + 1);
  const teacherRows: UtilizationRow[] = input.teachers
    .filter((teacher) => usedByTeacher.has(teacher.id))
    .map((teacher) => {
      const used = usedByTeacher.get(teacher.id) ?? 0;
      const capacity = Math.max(0, input.timeSlots.length - (unavailableByTeacher.get(teacher.id) ?? 0));
      const ratio = pct(used, capacity);
      return { id: teacher.id, name: teacher.name, used, capacity, ratio, warning: ratio > ROOM_WARN };
    })
    .sort((a, b) => b.ratio - a.ratio);

  const usedByClass = new Map<string, number>();
  for (const entry of validEntries) {
    if (!entry.groupId) usedByClass.set(entry.classId, (usedByClass.get(entry.classId) ?? 0) + 1);
  }
  // One elective lesson counts once for every member class.
  for (const [key, list] of classSlotGroups) {
    if (!list.some((entry) => entry.groupId)) continue;
    const classId = key.split('|')[1];
    usedByClass.set(classId, (usedByClass.get(classId) ?? 0) + 1);
  }
  const classRows: UtilizationRow[] = input.classes.map((klass) => {
    const used = usedByClass.get(klass.id) ?? 0;
    const capacity = input.timeSlots.length;
    const ratio = pct(used, capacity);
    return { id: klass.id, name: klass.name, used, capacity, ratio, warning: ratio > ROOM_WARN };
  });

  const hard = issues.filter((item) => item.severity === 'hard').length;
  const must = issues.filter((item) => item.severity === 'must').length;
  const prefer = issues.filter((item) => item.severity === 'prefer').length;
  const planned = input.coursePlans.reduce((sum, plan) => sum + Number(plan.weeklyPeriods || 0), 0);

  return {
    generatedAt: new Date().toISOString(),
    ok: hard === 0 && must === 0,
    elapsedMs: Date.now() - started,
    summary: {
      entries: validEntries.length,
      planned,
      placed: validEntries.length,
      unplaced: Math.max(0, planned - validEntries.length),
      hard,
      must,
      prefer,
      conflictEntryIds: Array.from(conflictEntryIds),
    },
    issues,
    unplaced,
    utilization: { rooms: roomRows, teachers: teacherRows, classes: classRows },
  };
}

/** Rows for the Excel/CSV export of a report. */
export function reportRows(report: InspectionReport): Record<string, string | number>[] {
  return report.issues.map((issue) => ({
    级别: issue.severity === 'hard' ? '硬冲突' : issue.severity === 'must' ? '必须规则' : '尽量规则',
    类型: CATEGORY_LABELS[issue.category],
    说明: issue.title,
    详情: issue.detail,
    条目数: issue.refs.entryIds?.length ?? 0,
  }));
}




