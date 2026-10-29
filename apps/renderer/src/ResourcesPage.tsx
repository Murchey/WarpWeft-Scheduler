import React, { useRef, useState } from 'react';
import { buildImportTemplate, normalizeGradeList, readWorkbookWithMeta } from '../../../packages/import-export/src';
import type { ClassRoom, Commit, CoursePlan, Room, SchoolData, SlotKind, Subject, Teacher, TimeSlot } from './types';
import { DAYS, EditableTable, SectionHeading } from './components';
import type { Column } from './components';
import { ResourceWorkspace } from './ResourceWorkspace';
import { download, exportMessage } from './download';
import { messageOf, uid } from './utils';
import { splitClassNames } from './teacherAssignment';
import { applyDayTemplate, planDayTemplate, weekdayLabel } from './slotTemplate';
import { isValidSemester, parseDateInput } from '../../../packages/semester/src';
import { IMPORTANCE_LABELS, RULE_DEFINITIONS } from '../../../packages/constraints/src';
import type { RuleImportance, RuleInstance, RuleKind, RuleScope, RuleTime } from '../../../packages/constraints/src';
import { parseSubjectPreference, suggestedSubjectPreference } from './subjectPreferences';
import { fixedSlotIdsOf } from '../../../packages/contracts/src';
import { normalizeSoftConstraints, withSoftWeight } from './softConstraints';
import { importChanges } from './importReview';
import { deleteWorkspaceProject, parseWorkspace, readWorkspaceProjects, saveWorkspaceProject, serializeWorkspace, workspaceFileName } from './workspaceProject';

type ResourceCollection = 'classes' | 'teachers' | 'subjects' | 'rooms' | 'timeSlots';

const RESOURCE_LABELS: Record<ResourceCollection, string> = {
  classes: '班级',
  teachers: '教师',
  subjects: '学科',
  rooms: '教室',
  timeSlots: '时间段',
};

const SLOT_KIND_MAP: Record<string, SlotKind> = {
  早读: 'morning', morning: 'morning',
  常规: 'regular', 普通: 'regular', regular: 'regular',
  自习: 'study', study: 'study',
  课后服务: 'aftercare', aftercare: 'aftercare',
  晚自习: 'evening', 晚修: 'evening', evening: 'evening',
  补课: 'makeup', makeup: 'makeup',
};
const SLOT_KIND_OPTIONS = [
  { value: 'morning', label: '早读' },
  { value: 'regular', label: '常规' },
  { value: 'study', label: '自习' },
  { value: 'aftercare', label: '课后服务' },
  { value: 'evening', label: '晚自习' },
  { value: 'makeup', label: '补课' },
];
const SLOT_KIND_LABELS: Record<SlotKind, string> = {
  morning: '早读',
  regular: '常规',
  study: '自习',
  aftercare: '课后服务',
  evening: '晚自习',
  makeup: '补课',
};

const RULE_DAY_NAMES: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
const RULE_IMPORTANCE: Record<string, RuleImportance> = { 必须: 'must', 尽量: 'prefer', 避免: 'avoid', must: 'must', prefer: 'prefer', avoid: 'avoid' };

function parseRuleTime(value: string): RuleTime {
  const raw = value.trim();
  if (!raw || raw === '全周') return { type: 'all' };
  const days = Array.from(raw.matchAll(/(?:周|星期)([一二三四五六日天])/g))
    .map((match) => RULE_DAY_NAMES[match[1]])
    .filter((day): day is number => Boolean(day));
  const range = raw.match(/第\s*(\d+)\s*(?:-|~|至)\s*(\d+)\s*节/);
  if (range) {
    return {
      type: 'periodRange',
      ...(days.length ? { days: Array.from(new Set(days)).sort((a, b) => a - b) } : {}),
      from: Number(range[1]),
      to: Number(range[2]),
    };
  }
  if (days.length) return { type: 'weekday', days: Array.from(new Set(days)).sort((a, b) => a - b) };
  return { type: 'all' };
}

function parseRuleParams(value: string, kind: RuleKind): Record<string, string | number> {
  const definition = RULE_DEFINITIONS.find((item) => item.kind === kind);
  const params: Record<string, string | number> = {};
  for (const field of definition?.paramFields ?? []) {
    params[field.key] = field.type === 'number' ? (field.min ?? 1) : (field.options?.[0]?.value ?? '');
  }
  const raw = value.trim();
  if (!raw) return params;
  const pairs = raw.split(/[;；,，]/).map((pair) => pair.trim()).filter(Boolean);
  for (const pair of pairs) {
    const separator = pair.indexOf('=');
    const key = (separator >= 0 ? pair.slice(0, separator) : pair).trim();
    const val = (separator >= 0 ? pair.slice(separator + 1) : '').trim();
    const field = definition?.paramFields.find((item) => item.key === key || item.label === key);
    if (field) {
      params[field.key] = field.type === 'number' ? Number(val) : val;
    } else if (separator < 0 && definition?.paramFields.length === 1) {
      const only = definition.paramFields[0];
      params[only.key] = only.type === 'number' ? Number(val || key) : (val || key);
    }
  }
  return params;
}
function ResourcesPage({
  data,
  commit,
  setError,
  setNotice,
  onLoadWorkspace,
  kind = 'import',
}: {
  data: SchoolData;
  commit: Commit;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
  onLoadWorkspace?: (next: SchoolData) => void;
  kind?: 'import' | 'classes' | 'teachers' | 'subjects' | 'rooms' | 'timeSlots';
}) {
  const days = DAYS.slice(1).map((label, index) => ({ value: String(index + 1), label }));
  const [replaceOnImport, setReplaceOnImport] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const importBusyRef = useRef(false);
  const [importDraft, setImportDraft] = useState<{ name: string; base: SchoolData; next: SchoolData; replace: boolean } | null>(null);
  const [importFeedback, setImportFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [batchDays, setBatchDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [batchFrom, setBatchFrom] = useState(1);
  const [batchTo, setBatchTo] = useState(2);
  const [templateSourceDay, setTemplateSourceDay] = useState(1);
  const [templateDays, setTemplateDays] = useState<number[]>([2, 3, 4, 5]);
  const [templateMode, setTemplateMode] = useState<'skip' | 'overwrite'>('skip');
  const [workspace, setWorkspace] = useState<null | 'classes' | 'teachers' | 'subjects' | 'rooms' | 'timeSlots'>(null);
  const [lastAdded, setLastAdded] = useState<{ collection: ResourceCollection; id: string } | null>(null);
  const [classPicker, setClassPicker] = useState<{ id: string; selected: string[] } | null>(null);
  const [templateStage, setTemplateStage] = useState<'idle' | 'generating' | 'saving'>('idle');
  const [workspaceProjects, setWorkspaceProjects] = useState(() => readWorkspaceProjects());
  const [workspaceProjectName, setWorkspaceProjectName] = useState(data.school.name || '未命名工作项目');
  const workspaceFileRef = useRef<HTMLInputElement | null>(null);
  const update = (
    collection: 'classes' | 'teachers' | 'subjects' | 'rooms' | 'timeSlots',
    id: string,
    key: string,
    value: string | number,
  ) => {
    if (collection === 'teachers' && key === 'grade') value = normalizeGradeList(value);
    if (collection === 'classes' && key === 'homeroomTeacherId' && value) {
      const conflict = data.classes.find((klass) => klass.id !== id && klass.homeroomTeacherId === value);
      if (conflict) {
        setError('该教师已经是「' + conflict.name + '」的班主任，一个教师只能带一个班');
        return;
      }
    }
    const rows = (data[collection] as unknown as Array<Record<string, unknown> & { id: string }>).map((row) =>
      row.id === id ? { ...row, [key]: value } : row,
    );
    let next = { ...data, [collection]: rows } as unknown as SchoolData;
    if (collection === 'classes' && key === 'homeroomTeacherId' && value) {
      const klass = data.classes.find((item) => item.id === id);
      const teacher = data.teachers.find((item) => item.id === value);
      if (klass && teacher) {
        const names = splitClassNames(teacher.classes);
        if (!names.some((name) => name.toLowerCase() === klass.name.toLowerCase())) {
          next = {
            ...next,
            teachers: data.teachers.map((item) =>
              item.id === teacher.id ? { ...item, classes: [...names, klass.name].join('、') } : item,
            ),
          };
        }
      }
    }
    if (collection === 'classes' && key === 'name') {
      const previous = data.classes.find((klass) => klass.id === id)?.name;
      const nextName = String(value).trim();
      if (previous && nextName && previous !== nextName) {
        next = {
          ...next,
          teachers: data.teachers.map((teacher) => {
            const names = splitClassNames(teacher.classes);
            if (!names.some((name) => name.toLowerCase() === previous.toLowerCase())) return teacher;
            return {
              ...teacher,
              classes: names.map((name) => (name.toLowerCase() === previous.toLowerCase() ? nextName : name)).join('、'),
            };
          }),
        };
      }
    }
    // Setting a subject preference should take effect without an extra trip to
    // the rules page: enable the objective at its default weight if it is off.
    if (collection === 'subjects' && key === 'preference' && value) {
      const weight = normalizeSoftConstraints(data).find((item) => item.kind === 'SUBJECT_TIME_PREFERENCE')?.weight ?? 0;
      if (weight === 0) next = withSoftWeight(next, 'SUBJECT_TIME_PREFERENCE', 2);
    }
    const invalidate = collection === 'timeSlots' && (key === 'day' || key === 'period' || key === 'kind');
    commit(next, { invalidate });
  };
  const pruneDeletedReferences = (
    next: SchoolData,
    collection: 'classes' | 'teachers' | 'subjects' | 'rooms' | 'timeSlots',
    deleted: Set<string>,
  ) => {
    const touches = (value?: string | null) => Boolean(value && deleted.has(value));
    next.unavailableSlots = (next.unavailableSlots ?? []).filter(
      (item) => !(collection === 'teachers' && deleted.has(item.teacherId)) && !(collection === 'timeSlots' && deleted.has(item.slotId)),
    );
    next.adjustments = (next.adjustments ?? []).filter((item) => {
      if (collection === 'classes' && deleted.has(item.classId)) return false;
      if (collection === 'teachers' && touches(item.substituteTeacherId)) return false;
      if (collection === 'rooms' && touches(item.roomId)) return false;
      if (collection === 'timeSlots' && (deleted.has(item.slotId) || touches(item.targetSlotId))) return false;
      return true;
    });
    next.lessonLogs = (next.lessonLogs ?? []).filter((item) => {
      if (collection === 'classes' && deleted.has(item.classId)) return false;
      if (collection === 'subjects' && deleted.has(item.subjectId)) return false;
      if (collection === 'teachers' && (deleted.has(item.teacherId) || deleted.has(item.originalTeacherId))) return false;
      if (collection === 'timeSlots' && deleted.has(item.slotId)) return false;
      return true;
    });
    if (collection === 'teachers') {
      next.classes = next.classes.map((klass) =>
        klass.homeroomTeacherId && deleted.has(klass.homeroomTeacherId)
          ? { ...klass, homeroomTeacherId: undefined }
          : klass,
      );
    }
    if (collection === 'classes') {
      const removedNames = new Set(
        data.classes.filter((klass) => deleted.has(klass.id)).map((klass) => klass.name.trim().toLowerCase()),
      );
      next.teachers = next.teachers.map((teacher) => {
        const names = splitClassNames(teacher.classes);
        const remaining = names.filter((name) => !removedNames.has(name.toLowerCase()));
        if (remaining.length === names.length) return teacher;
        return { ...teacher, classes: remaining.join('、') || undefined };
      });
    }
    return next;
  };
  const remove = (
    collection: 'classes' | 'teachers' | 'subjects' | 'rooms' | 'timeSlots',
    id: string,
  ) => {
    if (collection === 'classes' && data.coursePlans.some((plan) => plan.classId === id)) {
      setError('该班级仍被教学计划引用，请先删除相关教学计划');
      return;
    }
    if (collection === 'teachers' && data.coursePlans.some((plan) => plan.teacherId === id)) {
      setError('该教师仍被教学计划引用，请先删除相关教学计划');
      return;
    }
    if (collection === 'subjects' && data.coursePlans.some((plan) => plan.subjectId === id)) {
      setError('该学科仍被教学计划引用，请先删除相关教学计划');
      return;
    }
    if (collection === 'rooms' && data.rooms.length <= 1) {
      setError('至少需要保留一间教室');
      return;
    }
    if (collection === 'timeSlots' && data.coursePlans.some((plan) => fixedSlotIdsOf(plan).includes(id))) {
      setError('该时间段仍被教学计划设为固定时间，请先调整相关计划');
      return;
    }
    if (!window.confirm('确定删除这条记录？')) return;
    const rows = (data[collection] as Array<{ id: string }>).filter((row) => row.id !== id);
    const next = pruneDeletedReferences({ ...data, [collection]: rows } as unknown as SchoolData, collection, new Set([id]));
    commit(next, { invalidate: true });
    if (lastAdded?.collection === collection && lastAdded.id === id) setLastAdded(null);
  };
  const add = (collection: ResourceCollection) => {
    const uniqueName = (base: string) => {
      const names = new Set(
        (data[collection] as unknown as Array<{ name?: string }>)
          .map((item) => (item.name ?? '').trim().toLowerCase())
          .filter(Boolean),
      );
      if (!names.has(base.toLowerCase())) return base;
      let suffix = 2;
      while (names.has((base + ' ' + suffix).toLowerCase())) suffix += 1;
      return base + ' ' + suffix;
    };
    let row: Record<string, unknown>;
    if (collection === 'classes') row = { id: uid('class'), name: uniqueName('新班级'), grade: '未设置', size: 40 };
    else if (collection === 'teachers') row = { id: uid('teacher'), name: uniqueName('新教师') };
    else if (collection === 'subjects') row = { id: uid('subject'), name: uniqueName('新学科') };
    else if (collection === 'rooms') row = { id: uid('room'), name: uniqueName('新教室'), capacity: 40, type: '普通教室' };
    else {
      const periods = data.timeSlots.filter((slot) => slot.day === 1).map((slot) => slot.period);
      const period = (periods.length ? Math.max(...periods) : 0) + 1;
      row = { id: uid('slot'), day: 1, period, label: '周一 第' + period + '节', kind: 'regular' };
    }
    commit({ ...data, [collection]: [...(data[collection] as unknown as Array<Record<string, unknown>>), row] } as unknown as SchoolData, {
      invalidate: true,
    });
    const display = String(row.name ?? row.label ?? '新记录');
    setLastAdded({ collection, id: String(row.id) });
    setNotice('已新增' + RESOURCE_LABELS[collection] + '「' + display + '」，可直接在表格中编辑。');
  };

  const highlightFor = (collection: ResourceCollection) =>
    lastAdded?.collection === collection ? lastAdded.id : undefined;

  const removeMany = (
    collection: 'classes' | 'teachers' | 'subjects' | 'rooms' | 'timeSlots',
    ids: string[],
  ) => {
    const selected = new Set(ids);
    if (collection === 'classes' && data.coursePlans.some((plan) => selected.has(plan.classId))) {
      setError('选中的班级仍被教学计划引用，请先删除相关教学计划');
      return;
    }
    if (collection === 'teachers' && data.coursePlans.some((plan) => selected.has(plan.teacherId))) {
      setError('选中的教师仍被教学计划引用，请先删除相关教学计划');
      return;
    }
    if (collection === 'subjects' && data.coursePlans.some((plan) => selected.has(plan.subjectId))) {
      setError('选中的学科仍被教学计划引用，请先删除相关教学计划');
      return;
    }
    if (collection === 'rooms' && data.rooms.length - ids.length < 1) {
      setError('至少需要保留一间教室');
      return;
    }
    if (collection === 'timeSlots' && data.coursePlans.some((plan) => fixedSlotIdsOf(plan).some((slotId) => selected.has(slotId)))) {
      setError('选中的时间段仍被教学计划设为固定时间，请先调整相关计划');
      return;
    }
    const rows = (data[collection] as Array<{ id: string }>).filter((row) => !selected.has(row.id));
    const next = pruneDeletedReferences({ ...data, [collection]: rows } as unknown as SchoolData, collection, selected);
    commit(next, { invalidate: true, immediate: true });
    if (lastAdded?.collection === collection && selected.has(lastAdded.id)) setLastAdded(null);
    setNotice('已删除 ' + ids.length + ' 条记录');
  };

  const batchEdit = (
    collection: 'classes' | 'teachers' | 'subjects' | 'rooms' | 'timeSlots',
    ids: string[],
    key: string,
    value: string | number,
  ) => {
    const selected = new Set(ids);
    const rows = (data[collection] as unknown as Array<Record<string, unknown> & { id: string }>).map((row) =>
      selected.has(row.id) ? { ...row, [key]: value } : row,
    );
    const invalidate = collection === 'timeSlots' && (key === 'day' || key === 'period' || key === 'kind');
    commit({ ...data, [collection]: rows } as unknown as SchoolData, { invalidate, immediate: true });
    setNotice('已批量修改 ' + ids.length + ' 条记录');
  };

  const addBatchSlots = () => {
    const from = Math.max(1, Math.floor(Number(batchFrom) || 1));
    const to = Math.max(from, Math.floor(Number(batchTo) || from));
    if (batchDays.length === 0) {
      setError('请至少选择一个星期');
      return;
    }
    const existing = new Set(data.timeSlots.map((slot) => slot.day + '|' + slot.period));
    const additions: TimeSlot[] = [];
    for (const day of [...batchDays].sort((a, b) => a - b)) {
      for (let period = from; period <= to; period += 1) {
        if (existing.has(day + '|' + period)) continue;
        additions.push({ id: uid('slot'), day, period, label: DAYS[day] + ' 第' + period + '节', kind: 'regular' });
      }
    }
    if (additions.length === 0) {
      setNotice('这些时间段已经存在，没有新增。');
      return;
    }
    commit({ ...data, timeSlots: [...data.timeSlots, ...additions] }, { invalidate: true });
    setNotice('已批量新增 ' + additions.length + ' 个时间段。');
  };

  const applyDayTemplateToDays = () => {
    const plan = planDayTemplate(data.timeSlots, templateSourceDay, templateDays, templateMode);
    if (plan.sourceSlots.length === 0) {
      setError(weekdayLabel(templateSourceDay) + '还没有时间段，请先设置模板日');
      return;
    }
    if (plan.targetDays.length === 0) {
      setError('请至少勾选一个要套用的星期');
      return;
    }
    if (plan.additions + plan.overwrites === 0) {
      setNotice('所选星期的同节次时间段都已存在，没有需要套用的内容。');
      return;
    }
    const result = applyDayTemplate(data.timeSlots, templateSourceDay, templateDays, templateMode, () => uid('slot'));
    commit({ ...data, timeSlots: result.slots }, { invalidate: true });
    setNotice(
      '已将 ' + weekdayLabel(templateSourceDay) + ' 的时间段套用到 ' +
      result.targetDays.map((day) => weekdayLabel(day)).join('、') +
      '：新增 ' + result.additions + ' 个，覆盖 ' + result.overwrites + ' 个，跳过 ' + result.skips + ' 个。',
    );
  };

  const importWorkbookFile = async (file: File) => {
    if (importBusyRef.current) return;
    importBusyRef.current = true;
    setImportBusy(true);
    setImportDraft(null);
    setImportFeedback(null);
    try {
      const parsed = readWorkbookWithMeta(await file.arrayBuffer());
      const rows = parsed.rows;
      const meta = parsed.meta;
      if (rows.length === 0) {
        setImportFeedback({ tone: 'error', text: 'Excel 文件为空，请先下载模板并按表头填写。' });
        setError('Excel 文件为空，请先下载模板并按表头填写。');
        return;
      }
      const text = (value: unknown) => String(value ?? '').trim();
      const numeric = (value: unknown, fallback = 0) => {
        if (text(value) === '') return fallback;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
      };
      const isoDateValue = (value: unknown): string => parseDateInput(value) ?? '';
      const dayMap: Record<string, number> = {
        周一: 1, 星期一: 1, 一: 1, '1': 1,
        周二: 2, 星期二: 2, 二: 2, '2': 2,
        周三: 3, 星期三: 3, 三: 3, '3': 3,
        周四: 4, 星期四: 4, 四: 4, '4': 4,
        周五: 5, 星期五: 5, 五: 5, '5': 5,
        周六: 6, 星期六: 6, 六: 6, '6': 6,
        周日: 7, 星期日: 7, 日: 7, '7': 7,
      };
      const issues: string[] = [];
      const grouped = new Map<string, typeof rows>();
      for (const row of rows) {
        const key = text(row.sheet).toLowerCase();
        const list = grouped.get(key) ?? [];
        list.push(row);
        grouped.set(key, list);
      }
      const takeRows = (tokens: string[], exclude: string[] = []) => {
        const result: typeof rows = [];
        for (const [sheet, sheetRows] of grouped) {
          if (exclude.some((token) => sheet.includes(token))) continue;
          if (tokens.some((token) => sheet.includes(token))) result.push(...sheetRows);
        }
        return result;
      };
      const schoolRows = takeRows(['学校', 'school']);
      const semesterRows = takeRows(['学期', 'semester']);
      const classRows = takeRows(['班级', 'class']);
      const teacherRows = takeRows(['教师', 'teacher'], ['教师时间', 'teachertime']);
      const teacherTimeRows = takeRows(['教师时间', '教师不可用', 'teachertime']);
      const subjectRows = takeRows(['学科', 'subject']);
      const roomRows = takeRows(['教室', 'room']);
      const slotRows = takeRows(['时间段', 'slot']);
      const planRows = takeRows(['教学计划', 'plan']);
      const ruleRows = takeRows(['排课规则', 'rules']);
      const planSheetFound = planRows.length > 0;
      const ruleSheetFound = ruleRows.length > 0;
      const teacherTimeSheetFound = teacherTimeRows.length > 0;
      if (![...schoolRows, ...semesterRows, ...classRows, ...teacherRows, ...subjectRows, ...roomRows, ...slotRows, ...planRows, ...ruleRows, ...teacherTimeRows].length) {
        const emptyMessage = '未识别到可导入的工作表。请使用模板中的“班级/教师/学科/教室/时间段/教学计划”表头。';
        setImportFeedback({ tone: 'error', text: emptyMessage });
        setError(emptyMessage);
        return;
      }
      const next: SchoolData = {
        ...data,
        classes: data.classes.map((item) => ({ ...item })),
        teachers: data.teachers.map((item) => ({ ...item })),
        subjects: data.subjects.map((item) => ({ ...item })),
        rooms: data.rooms.map((item) => ({ ...item })),
        timeSlots: data.timeSlots.map((item) => ({ ...item })),
        coursePlans: data.coursePlans.map((item) => ({ ...item })),
      };
      const schoolRow = schoolRows.find((row) => text(row.values['名称'] ?? row.values['学校名称'] ?? row.values['name']));
      if (schoolRow) {
        const schoolName = text(schoolRow.values['名称'] ?? schoolRow.values['学校名称'] ?? schoolRow.values['name']);
        if (schoolName) next.school = { ...next.school, name: schoolName };
      }
      const semesterRow = semesterRows.find((row) => text(row.values['开始日期'] ?? row.values['startDate']) || text(row.values['结束日期'] ?? row.values['endDate']));
      if (semesterRow) {
        const startDate = isoDateValue(semesterRow.values['开始日期'] ?? semesterRow.values['startDate']);
        const endDate = isoDateValue(semesterRow.values['结束日期'] ?? semesterRow.values['endDate']);
        if (!startDate || !endDate) {
          issues.push('学期工作表需要同时填写开始日期和结束日期（YYYY-MM-DD）。');
        } else if (!isValidSemester({ startDate, endDate })) {
          issues.push('学期日期无效：' + startDate + ' ~ ' + endDate + '，请确认格式并保证开始日期不晚于结束日期。');
        } else {
          next.semester = { startDate, endDate };
        }
      }
      if (replaceOnImport) {
        next.rules = [];
        next.unavailableSlots = [];
        next.classes = [];
        next.teachers = [];
        next.subjects = [];
        next.rooms = [];
        next.timeSlots = [];
        next.coursePlans = [];
        next.adjustments = [];
        next.lessonLogs = [];
      }
      const classNames = new Set<string>();
      const homeroomDrafts: { classId: string; teacherName: string }[] = [];
      for (const row of classRows) {
        const v = row.values;
        const name = text(v['名称'] ?? v['班级名称'] ?? v['name']);
        if (!name) {
          issues.push('班级 第' + row.row + '行缺少名称');
          continue;
        }
        const key = name.toLowerCase();
        if (classNames.has(key)) {
          issues.push('班级 第' + row.row + '行名称重复：' + name);
          continue;
        }
        classNames.add(key);
        const size = numeric(v['人数'] ?? v['人数（可选）'] ?? v['size'], 40);
        if (!Number.isInteger(size) || size <= 0) {
          issues.push('班级 第' + row.row + '行人数必须为正整数');
          continue;
        }
        const grade = text(v['年级'] ?? v['grade']);
        const existing = next.classes.find((item) => item.name.trim().toLowerCase() === key);
        if (existing) {
          existing.grade = grade || existing.grade;
          existing.size = size;
        } else {
          next.classes.push({ id: uid('class'), name, grade, size });
        }
        const homeroomTeacherName = text(v['班主任'] ?? v['班主任教师'] ?? v['homeroomTeacher'] ?? '');
        const klass = next.classes.find((item) => item.name.trim().toLowerCase() === key);
        if (homeroomTeacherName && klass) homeroomDrafts.push({ classId: klass.id, teacherName: homeroomTeacherName });
      }
      const teacherNames = new Set<string>();
      for (const row of teacherRows) {
        const v = row.values;
        const name = text(v['姓名'] ?? v['名称'] ?? v['教师名称'] ?? v['name']);
        if (!name) {
          issues.push('教师 第' + row.row + '行缺少姓名');
          continue;
        }
        const key = name.toLowerCase();
        if (teacherNames.has(key)) {
          issues.push('教师 第' + row.row + '行姓名重复：' + name);
          continue;
        }
        teacherNames.add(key);
        const grade = normalizeGradeList(v['负责年级'] ?? v['年级'] ?? v['grade']);
        const subject = text(v['主要学科'] ?? v['学科'] ?? v['subject']);
        const subject2 = text(v['其他学科（可选）'] ?? v['其他学科'] ?? v['兼任学科'] ?? v['subject2']);
        const bound = splitClassNames(text(v['负责班级'] ?? v['绑定班级'] ?? v['任教班级'] ?? v['classes']));
        const boundNames: string[] = [];
        for (const className of bound) {
          const klass = next.classes.find((item) => item.name.trim().toLowerCase() === className.toLowerCase());
          if (!klass) {
            issues.push('教师 第' + row.row + '行负责班级不存在：' + className);
            continue;
          }
          boundNames.push(klass.name);
        }
        const classes = boundNames.join('、');
        const existing = next.teachers.find((item) => item.name.trim().toLowerCase() === key);
        if (existing) {
          existing.grade = grade || existing.grade;
          existing.subject = subject || existing.subject;
          existing.subject2 = subject2 || existing.subject2;
          existing.classes = classes || existing.classes;
        } else {
          next.teachers.push({
            id: uid('teacher'),
            name,
            grade: grade || undefined,
            subject: subject || undefined,
            subject2: subject2 || undefined,
            classes: classes || undefined,
          });
        }
      }
      const homeroomByTeacher = new Map<string, string[]>();
      for (const draft of homeroomDrafts) {
        const teacher = next.teachers.find((item) => item.name.trim().toLowerCase() === draft.teacherName.toLowerCase());
        const klass = next.classes.find((item) => item.id === draft.classId);
        if (!teacher) {
          issues.push('班级 ' + (klass?.name ?? draft.classId) + ' 的班主任不存在：' + draft.teacherName);
          continue;
        }
        if (!klass) continue;
        klass.homeroomTeacherId = teacher.id;
        const bound = splitClassNames(teacher.classes);
        if (!bound.some((name) => name.toLowerCase() === klass.name.toLowerCase())) {
          teacher.classes = [...bound, klass.name].join('、');
        }
        const list = homeroomByTeacher.get(teacher.id) ?? [];
        list.push(klass.name);
        homeroomByTeacher.set(teacher.id, list);
      }
      for (const klass of next.classes) {
        if (!klass.homeroomTeacherId) continue;
        const list = homeroomByTeacher.get(klass.homeroomTeacherId) ?? [];
        if (!list.includes(klass.name)) list.push(klass.name);
        homeroomByTeacher.set(klass.homeroomTeacherId, list);
      }
      for (const [teacherId, classNames] of homeroomByTeacher) {
        if (classNames.length > 1) {
          const teacher = next.teachers.find((item) => item.id === teacherId);
          issues.push('教师 ' + (teacher?.name ?? teacherId) + ' 被多个班设为班主任：' + classNames.join('、'));
        }
      }
      const subjectNames = new Set<string>();
      const preferenceColumnPresent = subjectRows.some((row) => '时间偏好' in row.values || '时段偏好' in row.values);
      for (const row of subjectRows) {
        const v = row.values;
        const name = text(v['学科'] ?? v['名称'] ?? v['学科名称'] ?? v['name']);
        if (!name) {
          issues.push('学科 第' + row.row + '行缺少名称');
          continue;
        }
        const key = name.toLowerCase();
        if (subjectNames.has(key)) {
          issues.push('学科 第' + row.row + '行名称重复：' + name);
          continue;
        }
        subjectNames.add(key);
        const preferenceText = text(v['时间偏好'] ?? v['时段偏好'] ?? v['preference']);
        let preference: 'morning' | 'afternoon' | undefined;
        if (preferenceText && preferenceText !== '不限' && preferenceText !== 'none') {
          preference = parseSubjectPreference(preferenceText);
          if (!preference) {
            issues.push('学科 第' + row.row + '行时间偏好无法识别：' + preferenceText + '（可填 上午/下午/不限）');
            continue;
          }
        } else if (preferenceColumnPresent) {
          // Blank in a new template means "use the school's usual structure";
          // users can pick 不限 explicitly to keep a subject unconstrained.
          preference = suggestedSubjectPreference(name);
        }
        const existingSubject = next.subjects.find((item) => item.name.trim().toLowerCase() === key);
        if (existingSubject) {
          // An old workbook has no preference column: keep what the workspace
          // already stored instead of silently overwriting it.
          if (preferenceColumnPresent || preferenceText || existingSubject.preference === undefined) {
            existingSubject.preference = preference;
          }
        } else {
          const suggested = preference ?? (preferenceColumnPresent ? undefined : suggestedSubjectPreference(name));
          next.subjects.push({ id: uid('subject'), name, ...(suggested ? { preference: suggested } : {}) });
        }
      }
      if (next.subjects.some((subject) => subject.preference)) {
        const weight = normalizeSoftConstraints(next).find((item) => item.kind === 'SUBJECT_TIME_PREFERENCE')?.weight ?? 0;
        if (weight === 0) next.softConstraints = withSoftWeight(next, 'SUBJECT_TIME_PREFERENCE', 2).softConstraints;
      }
      const roomNames = new Set<string>();
      for (const row of roomRows) {
        if ((next.roomMode ?? 'simplified') !== 'full') continue;
        const v = row.values;
        const name = text(v['名称'] ?? v['教室名称'] ?? v['name']);
        if (!name) {
          issues.push('教室 第' + row.row + '行缺少名称');
          continue;
        }
        const key = name.toLowerCase();
        if (roomNames.has(key)) {
          issues.push('教室 第' + row.row + '行名称重复：' + name);
          continue;
        }
        roomNames.add(key);
        const capacity = numeric(v['容量'] ?? v['capacity'], Math.max(40, ...next.classes.map((klass) => klass.size)));
        if (!Number.isInteger(capacity) || capacity <= 0) {
          issues.push('教室 第' + row.row + '行容量必须为正整数');
          continue;
        }
        const type = text(v['类型'] ?? v['type']) || '普通教室';
        const existing = next.rooms.find((item) => item.name.trim().toLowerCase() === key);
        if (existing) {
          existing.capacity = capacity;
          existing.type = type;
        } else {
          next.rooms.push({ id: uid('room'), name, capacity, type });
        }
      }
      if ((next.roomMode ?? 'simplified') !== 'full') {
        for (const klass of next.classes) {
          if (next.rooms.some((room) => room.name.trim().toLowerCase() === (klass.name + '教室').toLowerCase())) continue;
          next.rooms.push({
            id: uid('room'),
            name: klass.name + '教室',
            capacity: Math.max(1, klass.size),
            type: '普通教室',
          });
        }
      } else if (next.rooms.length === 0) {
        for (const klass of next.classes) {
          next.rooms.push({
            id: uid('room'),
            name: klass.name + '教室',
            capacity: Math.max(1, klass.size),
            type: '普通教室',
          });
        }
      }
      const slotKeys = new Set<string>();
      const addSlot = (day: number, period: number, row: number, start: string, duration: number, label: string, kind: (typeof SLOT_KIND_MAP)[string]) => {
        const key = day + '-' + period;
        if (slotKeys.has(key)) {
          issues.push('时间段 第' + row + '行重复：' + DAYS[day] + ' 第' + period + '节');
          return;
        }
        slotKeys.add(key);
        const existing = next.timeSlots.find((item) => item.day === day && item.period === period);
        if (existing) {
          existing.label = label;
          existing.kind = kind;
          existing.start = start || undefined;
          existing.duration = duration > 0 ? duration : undefined;
        } else {
          next.timeSlots.push({
            id: uid('slot'),
            day,
            period,
            label,
            kind,
            start: start || undefined,
            duration: duration > 0 ? duration : undefined,
          });
        }
      };
      const hasWeekdayColumn = slotRows.some((row) => text(row.values['星期'] ?? row.values['day']) !== '');
      if (hasWeekdayColumn) {
        for (const row of slotRows) {
          const v = row.values;
          const day = dayMap[text(v['星期'] ?? v['day'])];
          const period = numeric(v['节次'] ?? v['period']);
          if (!day || !Number.isInteger(period) || period <= 0) {
            issues.push('时间段 第' + row.row + '行缺少有效星期或节次');
            continue;
          }
          const start = text(v['开始时间'] ?? v['开始'] ?? v['start']);
          if (start && !/^\d{1,2}:\d{2}$/.test(start)) {
            issues.push('时间段 第' + row.row + '行开始时间格式应为 HH:MM');
            continue;
          }
          const kindText = text(v['类型'] ?? v['时段类型'] ?? v['kind']);
          const kind = kindText ? SLOT_KIND_MAP[kindText] : 'regular';
          if (kindText && !kind) {
            issues.push('时间段 第' + row.row + '行时段类型无法识别：' + kindText + '（可填 早读/常规/自习/课后服务/晚自习/补课）');
            continue;
          }
          const label = text(v['名称'] ?? v['label']) || DAYS[day] + ' 第' + period + '节';
          addSlot(day, period, row.row, start, numeric(v['时长'] ?? v['duration'], 0), label, kind);
        }
      } else {
        const periodRows = new Map<number, { start: string; duration: number; label: string; kind: (typeof SLOT_KIND_MAP)[string]; row: number }>();
        for (const row of slotRows) {
          const v = row.values;
          const period = numeric(v['节次'] ?? v['period']);
          if (!Number.isInteger(period) || period <= 0) {
            issues.push('时间段 第' + row.row + '行缺少有效节次');
            continue;
          }
          const start = text(v['开始时间'] ?? v['开始'] ?? v['start']);
          if (start && !/^\d{1,2}:\d{2}$/.test(start)) {
            issues.push('时间段 第' + row.row + '行开始时间格式应为 HH:MM');
            continue;
          }
          const kindText = text(v['类型'] ?? v['时段类型'] ?? v['kind']);
          const kind = kindText ? SLOT_KIND_MAP[kindText] : 'regular';
          if (kindText && !kind) {
            issues.push('时间段 第' + row.row + '行时段类型无法识别：' + kindText + '（可填 早读/常规/自习/课后服务/晚自习/补课）');
            continue;
          }
          periodRows.set(period, {
            start,
            duration: numeric(v['时长'] ?? v['duration'], 0),
            label: text(v['名称'] ?? v['label']) || '第' + period + '节',
            kind,
            row: row.row,
          });
        }
        const maxPeriods = meta.maxPeriods ?? (periodRows.size ? Math.max(...periodRows.keys()) : 8);
        if (!meta.maxPeriods) issues.push('时间段 工作表 B1 必须填写“每天最多节数”。');
        const periods = Array.from({ length: maxPeriods }, (_, index) => index + 1);
        const weekdays = meta.weekdays?.length ? meta.weekdays : [1, 2, 3, 4, 5];
        const dayPeriods = meta.dayPeriods ?? {};
        for (const day of weekdays) {
          const periodsForDay = (dayPeriods[day]?.length ? dayPeriods[day] : periods).filter((period) => period >= 1 && period <= maxPeriods);
          for (const period of periodsForDay) {
            const info = periodRows.get(period);
            addSlot(
              day,
              period,
              info?.row ?? 0,
              info?.start ?? '',
              info?.duration ?? 0,
              info?.label && info.label !== '第' + period + '节' ? info.label : DAYS[day] + ' 第' + period + '节',
              info?.kind ?? 'regular',
            );
          }
        }
      }
      const classByName = new Map(next.classes.map((item) => [item.name.trim().toLowerCase(), item]));
      const subjectByName = new Map(next.subjects.map((item) => [item.name.trim().toLowerCase(), item]));
      const teacherByName = new Map(next.teachers.map((item) => [item.name.trim().toLowerCase(), item]));
      const roomByName = new Map(next.rooms.map((item) => [item.name.trim().toLowerCase(), item]));
      const slotByLabel = new Map(next.timeSlots.map((item) => [item.label.trim(), item]));
      const looseSlotLabel = (value: string) => value.replace(/\s+/g, '').replace(/星期/g, '周');
      const slotByLooseLabel = new Map(next.timeSlots.map((item) => [looseSlotLabel(item.label), item]));
      const slotById = new Map(next.timeSlots.map((item) => [item.id, item]));
      const findSlot = (value: string) => {
        const textValue = text(value);
        if (!textValue) return undefined;
        return slotByLabel.get(textValue) ?? slotById.get(textValue) ?? slotByLooseLabel.get(looseSlotLabel(textValue));
      };
      if (ruleSheetFound) {
        const rules: RuleInstance[] = [];
        const ruleByLabel = new Map<string, RuleKind>();
        for (const definition of RULE_DEFINITIONS) {
          ruleByLabel.set(definition.label, definition.kind);
          ruleByLabel.set(definition.kind, definition.kind);
        }
        for (const row of ruleRows) {
          const v = row.values;
          if (!Object.values(v).some((value) => text(value) !== '')) continue;
          const kindText = text(v['规则类型'] ?? v['规则'] ?? v['type']);
          const kind = ruleByLabel.get(kindText);
          if (!kind) {
            issues.push('排课规则 第' + row.row + '行规则类型无法识别：' + kindText);
            continue;
          }
          const definition = RULE_DEFINITIONS.find((item) => item.kind === kind)!;
          const scopeTypeText = text(v['作用对象类型'] ?? v['对象类型'] ?? v['scopeType']);
          const scopeValue = text(v['作用对象'] ?? v['对象'] ?? v['scope']);
          let scope: RuleScope;
          if (!scopeTypeText || /全校|全部|all/i.test(scopeTypeText)) {
            scope = { type: 'all' };
          } else if (/年级|grade/i.test(scopeTypeText)) {
            if (!scopeValue) {
              issues.push('排课规则 第' + row.row + '行缺少年级');
              continue;
            }
            scope = { type: 'grade', grade: scopeValue };
          } else if (/教师|teacher/i.test(scopeTypeText)) {
            const teacher = teacherByName.get(scopeValue.toLowerCase());
            if (!teacher) {
              issues.push('排课规则 第' + row.row + '行引用了不存在的教师：' + scopeValue);
              continue;
            }
            scope = { type: 'teacher', teacherId: teacher.id };
          } else if (/学科|subject/i.test(scopeTypeText)) {
            const subject = subjectByName.get(scopeValue.toLowerCase());
            if (!subject) {
              issues.push('排课规则 第' + row.row + '行引用了不存在的学科：' + scopeValue);
              continue;
            }
            scope = { type: 'subject', subjectId: subject.id };
          } else if (/班级|class/i.test(scopeTypeText)) {
            const klass = classByName.get(scopeValue.toLowerCase());
            if (!klass) {
              issues.push('排课规则 第' + row.row + '行引用了不存在的班级：' + scopeValue);
              continue;
            }
            scope = { type: 'class', classId: klass.id };
          } else if (/教室|room/i.test(scopeTypeText)) {
            const room = roomByName.get(scopeValue.toLowerCase());
            if (!room) {
              issues.push('排课规则 第' + row.row + '行引用了不存在的教室：' + scopeValue);
              continue;
            }
            scope = { type: 'room', roomId: room.id };
          } else if (definition.scopeType === 'teacher') {
            const teacher = teacherByName.get(scopeValue.toLowerCase());
            if (!teacher) {
              issues.push('排课规则 第' + row.row + '行引用了不存在的教师：' + scopeValue);
              continue;
            }
            scope = { type: 'teacher', teacherId: teacher.id };
          } else {
            const subject = subjectByName.get(scopeValue.toLowerCase());
            if (!subject) {
              issues.push('排课规则 第' + row.row + '行引用了不存在的学科：' + scopeValue);
              continue;
            }
            scope = { type: 'subject', subjectId: subject.id };
          }
          const importanceText = text(v['重要程度'] ?? v['importance']);
          const importedImportance = RULE_IMPORTANCE[importanceText] ?? definition.defaultImportance;
          const importance = definition.importanceOptions.includes(importedImportance)
            ? importedImportance
            : definition.defaultImportance;
          rules.push({
            id: uid('rule'),
            kind,
            scope,
            time: parseRuleTime(text(v['适用时间'] ?? v['时间'] ?? v['time'])),
            importance,
            params: parseRuleParams(text(v['参数'] ?? v['params']), kind),
            enabled: true,
            note: text(v['备注'] ?? v['note']),
            createdAt: new Date().toISOString(),
            source: 'import',
          });
        }
        next.rules = rules;
      }
      if (planSheetFound) {
        const plans: CoursePlan[] = [];
        const planKeys = new Set<string>();
        for (const row of planRows) {
          const v = row.values;
          if (!Object.values(v).some((value) => text(value) !== '')) continue;
          const className = text(v['班级'] ?? v['班级名称'] ?? v['class']);
          const subjectName = text(v['学科'] ?? v['学科名称'] ?? v['subject']);
          const teacherName = text(v['教师'] ?? v['教师姓名'] ?? v['teacher']);
          const classItem = classByName.get(className.toLowerCase());
          const subjectItem = subjectByName.get(subjectName.toLowerCase());
          const teacherItem = teacherName ? teacherByName.get(teacherName.toLowerCase()) : undefined;
          if (!classItem || !subjectItem || (teacherName && !teacherItem)) {
            issues.push('教学计划 第' + row.row + '行引用了不存在的班级、学科或教师');
            continue;
          }
          const weeklyPeriods = numeric(v['每周课时'] ?? v['周课时'] ?? v['课时'] ?? v['weeklyPeriods']);
          if (!Number.isInteger(weeklyPeriods) || weeklyPeriods <= 0) {
            issues.push('教学计划 第' + row.row + '行周课时必须为正整数');
            continue;
          }
          const roomType = text(v['教室类型'] ?? v['roomType']);
          if (roomType && !next.rooms.some((room) => room.type === roomType)) {
            issues.push('教学计划 第' + row.row + '行教室类型不存在：' + roomType);
            continue;
          }
          const fixedText = text(v['固定时间'] ?? v['fixedSlot'] ?? v['fixed'] ?? v['fixedSlotIds']);
          const fixedSlotIds: string[] = [];
          if (fixedText) {
            const parts = fixedText.split(/[;；,，、\n]+/).map((part) => part.trim()).filter(Boolean);
            let missing = '';
            for (const part of parts) {
              const fixed = findSlot(part);
              if (!fixed) {
                missing = part;
                break;
              }
              if (!fixedSlotIds.includes(fixed.id)) fixedSlotIds.push(fixed.id);
            }
            if (missing) {
              issues.push('教学计划 第' + row.row + '行固定时间不存在：' + missing);
              continue;
            }
            if (fixedSlotIds.length > weeklyPeriods) {
              issues.push('教学计划 第' + row.row + '行固定时间有 ' + fixedSlotIds.length + ' 节，超过周课时 ' + weeklyPeriods + ' 节');
              continue;
            }
          }
          const weekText = text(v['周次'] ?? v['单双周'] ?? v['weeks']).trim().toLowerCase();
          let weeks: 'all' | 'odd' | 'even' = 'all';
          if (weekText) {
            if (['单周', '单', 'odd'].includes(weekText)) weeks = 'odd';
            else if (['双周', '双', 'even'].includes(weekText)) weeks = 'even';
            else if (['每周', '全', 'all'].includes(weekText)) weeks = 'all';
            else {
              issues.push('教学计划 第' + row.row + '行周次无法识别：' + weekText + '（可填 每周/单周/双周）');
              continue;
            }
          }
          const kindText = text(v['课程类型'] ?? v['时段类型'] ?? v['类型'] ?? v['kind']).trim();
          const planKind: SlotKind = kindText ? SLOT_KIND_MAP[kindText] : 'regular';
          if (kindText && !SLOT_KIND_MAP[kindText]) {
            issues.push('教学计划 第' + row.row + '行时段类型无法识别：' + kindText + '（可填 早读/常规/自习/课后服务/晚自习/补课）');
            continue;
          }
          const consecutiveText = text(v['连堂节数'] ?? v['连堂'] ?? v['consecutive']);
          const consecutiveValue = consecutiveText ? Number(consecutiveText) : 0;
          if (consecutiveText && (!Number.isInteger(consecutiveValue) || consecutiveValue < 0 || consecutiveValue > 4)) {
            issues.push('教学计划 第' + row.row + '行连堂节数必须是 0–4 的整数');
            continue;
          }
          const consecutive = consecutiveValue >= 2 ? consecutiveValue : undefined;
          const pairId = text(v['配对组'] ?? v['配对'] ?? v['pairId']) || undefined;
          const key = classItem.id + '|' + subjectItem.id + '|' + (teacherItem?.id ?? '') + '|' + weeks + '|' + (pairId ?? '');
          if (planKeys.has(key)) {
            issues.push('教学计划 第' + row.row + '行重复：' + className + ' / ' + subjectName);
            continue;
          }
          planKeys.add(key);
          plans.push({
            id: uid('plan'),
            classId: classItem.id,
            subjectId: subjectItem.id,
            teacherId: teacherItem?.id ?? '',
            weeklyPeriods,
            roomType,
            ...(fixedSlotIds.length ? { fixedSlotIds } : {}),
            ...(consecutive ? { consecutive } : {}),
            ...(pairId ? { pairId } : {}),
            weeks,
            kind: planKind,
          });
        }
        const pairGroups = new Map<string, CoursePlan[]>();
        for (const plan of plans) {
          if (!plan.pairId) continue;
          const list = pairGroups.get(plan.pairId) ?? [];
          list.push(plan);
          pairGroups.set(plan.pairId, list);
        }
        for (const [pairId, group] of pairGroups) {
          if (group.length < 2) {
            issues.push('教学计划 第「配对组」' + pairId + ' 只有 1 条计划，至少需要两条才能同格');
            continue;
          }
          for (const plan of group) {
            const klass = next.classes.find((item) => item.id === plan.classId)?.name ?? plan.classId;
            const overlap = group.some((other) => other.id !== plan.id
              && other.classId === plan.classId
              && (other.weeks ?? 'all') === (plan.weeks ?? 'all'));
            if (overlap) {
              issues.push('教学计划 配对组「' + pairId + '」在 ' + klass + ' 的周次重叠，无法共用同一时段');
              break;
            }
          }
          // Occurrence order matters: lesson 1 is pinned to the first entry.
          const fixedKey = (plan: CoursePlan) => (plan.fixedSlotIds ?? []).join('|');
          if (new Set(group.map(fixedKey)).size > 1) {
            issues.push('教学计划 配对组「' + pairId + '」的固定时间必须完全一致');
          }
        }
        next.coursePlans = plans;
      }
      if (teacherTimeSheetFound) {
        const unavailable: { teacherId: string; slotId: string }[] = [];
        const seenUnavailable = new Set<string>();
        for (const row of teacherTimeRows) {
          const v = row.values;
          const teacherName = text(v['教师'] ?? v['教师姓名'] ?? v['teacher']);
          if (!teacherName) {
            issues.push('教师时间 第' + row.row + '行缺少教师');
            continue;
          }
          const teacher = teacherByName.get(teacherName.toLowerCase());
          if (!teacher) {
            issues.push('教师时间 第' + row.row + '行引用了不存在的教师：' + teacherName);
            continue;
          }
          const dayText = text(v['星期'] ?? v['周几'] ?? v['day']);
          const slotText = text(v['时间段'] ?? v['时间'] ?? v['slot']);
          const periods = text(v['节次'] ?? v['period'])
            .split(/[;；,，、\s]+/)
            .map((part) => Number(String(part).replace(/[^0-9]/g, '')))
            .filter((period) => Number.isInteger(period) && period > 0);
          if (slotText) {
            const slot = findSlot(slotText);
            if (!slot) {
              issues.push('教师时间 第' + row.row + '行时间段不存在：' + slotText);
              continue;
            }
            const key = teacher.id + '|' + slot.id;
            if (!seenUnavailable.has(key)) {
              seenUnavailable.add(key);
              unavailable.push({ teacherId: teacher.id, slotId: slot.id });
            }
            continue;
          }
          const day = dayMap[dayText] ?? dayMap[dayText.replace(/^星期/, '周')] ?? Number(dayText);
          if (!day || !periods.length) {
            issues.push('教师时间 第' + row.row + '行需要填写星期和节次（或直接填时间段）');
            continue;
          }
          for (const period of periods) {
            const slot = next.timeSlots.find((item) => item.day === day && item.period === period);
            if (!slot) {
              issues.push('教师时间 第' + row.row + '行找不到 ' + DAYS[day] + ' 第' + period + '节');
              continue;
            }
            const key = teacher.id + '|' + slot.id;
            if (seenUnavailable.has(key)) continue;
            seenUnavailable.add(key);
            unavailable.push({ teacherId: teacher.id, slotId: slot.id });
          }
        }
        next.unavailableSlots = unavailable;
      }
      if (issues.length) {
        const failure =
          '导入校验未通过（未写入数据）：\n' +
          issues.slice(0, 6).join('\n') +
          (issues.length > 6 ? '\n…还有 ' + (issues.length - 6) + ' 项' : '') +
          '\n请在 Excel 中按上面的工作表和行号定位（第 1 行是表头），修改后重新导入。';
        setImportFeedback({ tone: 'error', text: failure });
        setError('导入校验未通过（未写入数据）：\n' + issues.join('\n'));
        return;
      }
      setImportDraft({ name: file.name, base: data, next, replace: replaceOnImport });
      setError('');
    } catch (cause) {
      const failure = 'Excel 导入失败：' + messageOf(cause);
      setImportFeedback({ tone: 'error', text: failure });
      setError(failure);
    } finally {
      importBusyRef.current = false;
      setImportBusy(false);
    }
  };

  const confirmImport = () => {
    if (!importDraft) return;
    if (importDraft.base !== data) {
      setImportDraft(null);
      setImportFeedback({ tone: 'error', text: '预览后工作区已改变，请重新选择文件生成预览，避免覆盖新修改。' });
      return;
    }
    const summary = importChanges(data, importDraft.next)
      .filter(row => row.added || row.changed || row.removed)
      .map(row => row.label + '：新增 ' + row.added + '、修改 ' + row.changed + '、移除 ' + row.removed).join('；');
    commit(importDraft.next, { invalidate: true, immediate: true });
    setImportDraft(null);
    setImportFeedback({ tone: 'success', text: '已应用导入到工作区。' + (summary || '数据无变化。') + ' 请查看顶部保存状态。' });
    setNotice('Excel 导入已应用，请查看保存状态');
  };

  const downloadTemplate = async () => {
    if (templateStage !== 'idle') return;
    setTemplateStage('generating');
    setError('');
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 30));
      const bytes = await buildImportTemplate(undefined, {
        simplified: (data.roomMode ?? 'simplified') !== 'full',
      });
      setTemplateStage('saving');
      const result = await download(
        bytes,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'warpweft-import-template.xlsx',
      );
      if (result.status === 'downloaded') {
        setNotice('模板已开始下载，请等待浏览器下载完成后再打开。');
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        return;
      }
      const message = exportMessage(result, '模板');
      if (!message) return;
      if (message.tone === 'error') setError(message.text);
      else setNotice(message.text);
    } catch (cause) {
      setError('下载模板失败：' + messageOf(cause));
    } finally {
      setTemplateStage('idle');
    }
  };

  const exportWorkspaceFile = async (name = workspaceProjectName) => {
    const result = await download(
      new Blob([serializeWorkspace(data, name)], { type: 'application/json;charset=utf-8' }),
      'application/json',
      workspaceFileName(name),
    );
    const message = exportMessage(result, '工作区数据');
    if (!message) return;
    if (message.tone === 'error') setError(message.text);
    else setNotice(message.text);
  };

  const saveProject = () => {
    const project = saveWorkspaceProject(workspaceProjectName, data);
    setWorkspaceProjects(readWorkspaceProjects());
    setWorkspaceProjectName(project.name);
    setNotice('工作项目已保存：' + project.name);
  };

  const importWorkspaceFile = async (file: File) => {
    try {
      const parsed = parseWorkspace(await file.text());
      if (!window.confirm('加载工作区「' + parsed.name + '」？当前未保存的修改会被替换。')) return;
      onLoadWorkspace?.(parsed.data);
      setWorkspaceProjectName(parsed.name);
      setNotice('已加载工作区：' + parsed.name);
    } catch (cause) {
      setError('加载工作区失败：' + messageOf(cause));
    }
  };

  if (kind === 'import') {
    return (
      <div className="resource-single">
        <section className="section-panel resource-panel import-panel">
          <div className="panel-head"><SectionHeading english="IMPORT / VALIDATE" title="导入来源" /></div>
          <div className="workspace-import-grid">
            <section className="workspace-import-card">
              <span className="kicker">// TEMPLATE</span>
              <h3>Excel 模板</h3>
              <p className="panel-note">适合批量导入基础资料、教学计划、规则和教师时间。</p>
              <div className="import-actions">
                <label className="file-button file-button-primary">
                  <span>{importBusy ? '正在解析与校验…' : '选择 Excel 并预览'}</span>
                  <input type="file" accept=".xlsx,.xls" disabled={importBusy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importWorkbookFile(file); event.currentTarget.value = ''; }} />
                </label>
                <button type="button" className="file-button" onClick={() => void downloadTemplate()} disabled={templateStage !== 'idle'}>{templateStage === 'generating' ? '正在生成模板…' : templateStage === 'saving' ? '正在写入模板…' : '下载模板'}</button>
              </div>
            </section>
            <section className="workspace-import-card is-workspace">
              <span className="kicker">// WORKSPACE FILE</span>
              <h3>工作区数据</h3>
              <p className="panel-note">恢复已经排课的完整工作内容，包含候选/正式课表、调代课记录和审计日志。</p>
              <div className="import-actions">
                <label className="file-button">
                  <span>加载工作区 JSON</span>
                  <input ref={workspaceFileRef} type="file" accept=".json,.workspace.json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importWorkspaceFile(file); event.currentTarget.value = ''; }} />
                </label>
                <button type="button" className="file-button" onClick={() => void exportWorkspaceFile()}>{'导出当前工作区'}</button>
              </div>
              <div className="workspace-project-save">
                <input value={workspaceProjectName} onChange={(event) => setWorkspaceProjectName(event.target.value)} placeholder="工作项目名称" aria-label="工作项目名称" />
                <button type="button" className="action-button" onClick={saveProject}>保存为工作项目 <span>→</span></button>
              </div>
            </section>
          </div>
          {workspaceProjects.length > 0 ? (
            <section className="workspace-projects" aria-label="工作项目列表">
              <div className="panel-head"><SectionHeading english="PROJECT FILES" title="工作项目" /><span className="status-tag">{workspaceProjects.length} / 20</span></div>
              <p className="panel-note">工作项目保存在本机浏览器中，与当前服务端工作区分开；适合保存多个学校、学期或方案版本。</p>
              <div className="workspace-project-list">
                {workspaceProjects.map((project) => (
                  <article className="workspace-project-row" key={project.id}>
                    <div><b>{project.name}</b><small>{new Date(project.savedAt).toLocaleString('zh-CN', { hour12: false })} · {project.data.classes.length} 班 · {project.data.coursePlans.length} 条计划</small></div>
                    <div className="workspace-project-actions">
                      <button type="button" className="ghost-button" onClick={() => { if (!window.confirm('加载工作项目「' + project.name + '」？当前未保存的修改会被替换。')) return; onLoadWorkspace?.(project.data); setWorkspaceProjectName(project.name); setNotice('已加载工作项目：' + project.name); }}>加载</button>
                      <button type="button" className="ghost-button" onClick={() => void exportWorkspaceFile(project.name)}>导出</button>
                      <button type="button" className="ghost-button is-danger" onClick={() => { if (!window.confirm('删除工作项目「' + project.name + '」？')) return; deleteWorkspaceProject(project.id); setWorkspaceProjects(readWorkspaceProjects()); }}>删除</button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          {importFeedback ? (
            <div
              className={'import-feedback is-' + importFeedback.tone}
              role={importFeedback.tone === 'error' ? 'alert' : 'status'}
            >
              <span>{importFeedback.text}</span>
              <button type="button" className="import-feedback-close" aria-label="关闭导入结果" onClick={() => setImportFeedback(null)}>
                ×
              </button>
            </div>
          ) : null}
          <p className="panel-note">先填 3 张必填表即可导入：<b>班级、学科、教学计划</b>。学校、学期、教师、教室、时间段可后补；模板“说明”按工作表分节列出字段、必填项和示例，表头带 * 的列必须填写，多值字段表头会注明分隔符（如“分号分隔”“用、分隔”），第 2 行灰色示例行请在导入前删除。教室可整表留空，时间段先填每天最多节数。</p>
          {templateStage !== 'idle' ? (
            <p className="template-progress" role="status">
              正在{templateStage === 'generating' ? '生成' : '写入'}文件，请等待保存完成后再打开；浏览器下载请等下载完成。
            </p>
          ) : null}
          <label className="import-replace">
            <input type="checkbox" checked={replaceOnImport} disabled={importBusy || Boolean(importDraft)} onChange={(event) => setReplaceOnImport(event.target.checked)} />
            <span>导入前清空当前工作区</span>
          </label>
          <label className="import-replace">
            <input
              type="checkbox"
              checked={(data.roomMode ?? 'simplified') !== 'full'}
              disabled={importBusy || Boolean(importDraft)}
              onChange={(event) => commit({ ...data, roomMode: event.target.checked ? 'simplified' : 'full' }, { invalidate: true })}
            />
            <span>简化模式（每班一间固定教室，不需要教室表）</span>
          </label>
          {importDraft ? (
            <section className="import-review" aria-label="导入变更预览">
              <h3>变更预览 · {importDraft.name}</h3>
              <p className="panel-note">解析与格式校验已完成，尚未写入。{importDraft.replace ? '本次先清空再导入，会移除旧记录。' : '基础资料按现有导入规则合并；含有效行的教学计划、规则、教师时间表整体替换对应集合。'}</p>
              <div className="import-review-table"><table>
                <thead><tr><th>数据</th><th>原有 → 导入后</th><th>新增</th><th>修改</th><th>移除</th><th>不变</th></tr></thead>
                <tbody>{importChanges(importDraft.base, importDraft.next).map(row => (
                  <tr key={row.key}><th>{row.label}</th><td>{row.before} → {row.after}</td><td>{row.added}</td><td>{row.changed}</td><td>{row.removed}</td><td>{row.unchanged}</td></tr>
                ))}</tbody>
              </table></div>
              <p className="panel-note">学校：{importDraft.base.school.name} → {importDraft.next.school.name}。学期：{importDraft.next.semester ? importDraft.next.semester.startDate + ' ~ ' + importDraft.next.semester.endDate : '未设置'}。</p>
              <p className="panel-note">确认后清除当前候选课表及其锁定/手动调整，需重新排课；正式版仍保留。教学计划的新 ID 会计为新增与移除。</p>
              {importDraft.replace ? <p className="inline-warning">清空模式同时清除调代课与授课记录。请先通过排课准备页导出当前数据备份。</p> : null}
              <div className="hero-actions">
                <button type="button" className="action-button" onClick={confirmImport} disabled={importDraft.base !== data}>确认应用导入</button>
                <button type="button" className="ghost-button" onClick={() => { setImportDraft(null); setImportFeedback(null); }}>取消导入</button>
              </div>
              {importDraft.base !== data ? <p role="alert">工作区已变化，请重新选择文件生成预览。</p> : null}
            </section>
          ) : null}
          <p className="panel-note">仅支持 Excel（.xlsx/.xls）；简化模式模板不包含“教室”表，教学计划也不需要教室类型；完整模式保留教室表。教师表填写负责班级后，排课和自动分配都只使用这些班级；班级表可填班主任。模板第 2 行是灰色示例行，导入前请删除。教学计划 / 教师时间 / 排课规则为空表时保留现有数据；要整体重置请勾选上方“导入前清空当前工作区”。</p>
        </section>
      </div>
    );
  }

  if (kind === 'classes') {
    const columns: Column<ClassRoom>[] = [
      { key: 'name', label: '班级名称', width: '28%' },
      { key: 'grade', label: '年级', width: '18%' },
      { key: 'size', label: '人数', type: 'number', width: '14%' },
      {
        key: 'homeroomTeacherId',
        label: '班主任',
        type: 'select',
        width: '40%',
        options: [{ value: '', label: '未设置' }, ...data.teachers.map((teacher) => ({ value: teacher.id, label: teacher.name }))],
      },
    ];
    return (
      <div className="resource-single">
        <EditableTable<ClassRoom>
          title="班级"
          english="CLASS REGISTER"
          rows={data.classes}
          columns={columns}
          onChange={(id, key, value) => update('classes', id, key, value)}
          onAdd={() => add('classes')}
          onRemove={(id) => remove('classes', id)}
          addLabel="新增班级"
          note="班级人数会影响教室容量校验；班主任必须在本班有一节自己可教的课（本班没有该老师所教学科时豁免）；被教学计划引用的班级不能删除。"
          previewCount={6}
          highlightId={highlightFor('classes')}
          onOpenAll={() => setWorkspace('classes')}
        />
        {workspace === 'classes' ? (
          <ResourceWorkspace<ClassRoom>
            title="班级"
            english="CLASS REGISTER"
            rows={data.classes}
            columns={columns}
            batchFields={[
              { key: 'grade', label: '年级', type: 'text', placeholder: '如 八年级' },
              { key: 'size', label: '人数', type: 'number', placeholder: '如 45' },
            ]}
            searchText={(row) =>
              row.name +
              ' ' +
              (row.grade ?? '') +
              ' ' +
              (data.teachers.find((teacher) => teacher.id === row.homeroomTeacherId)?.name ?? '')
            }
            onChange={(id, key, value) => update('classes', id, key, value)}
            onBatchEdit={(ids, key, value) => batchEdit('classes', ids, key, value)}
            onRemoveMany={(ids) => removeMany('classes', ids)}
            onClose={() => setWorkspace(null)}
            note="被教学计划引用的班级不能删除；批量删除会一次校验并整体提交。"
          />
        ) : null}
      </div>
    );
  }

  if (kind === 'teachers') {
    const columns: Column<Teacher>[] = [
        { key: 'name', label: '教师姓名', width: '20%' },
        { key: 'grade', label: '负责年级', width: '14%' },
        { key: 'subject', label: '主要学科', width: '16%' },
        { key: 'subject2', label: '其他学科', width: '16%' },
        {
          key: 'classes',
          label: '负责班级',
          type: 'classes',
          width: '34%',
          options: data.classes.map((klass) => ({ value: klass.name, label: klass.name })),
        },
      ];
    return (
      <div className="resource-single">
        <EditableTable<Teacher>
          title="教师"
          english="TEACHER REGISTER"
          rows={data.teachers}
          columns={columns}
          onChange={(id, key, value) => update('teachers', id, key, value)}
          onAdd={() => add('teachers')}
          onRemove={(id) => remove('teachers', id)}
          onEditClasses={(id) =>
            setClassPicker({
              id,
              selected: splitClassNames(data.teachers.find((teacher) => teacher.id === id)?.classes),
            })
          }
          addLabel="新增教师"
          note="教师不能在同一时间上两门课；负责班级可多选，留空表示不限制；被教学计划引用的教师不能删除。"
          previewCount={6}
          highlightId={highlightFor('teachers')}
          onOpenAll={() => setWorkspace('teachers')}
        />
        {workspace === 'teachers' ? (
          <ResourceWorkspace<Teacher>
            title="教师"
            english="TEACHER REGISTER"
            rows={data.teachers}
            columns={columns}
            batchFields={[
              { key: 'grade', label: '负责年级', type: 'text', placeholder: '如 1;2;6' },
              { key: 'subject', label: '主要学科', type: 'text', placeholder: '如 数学' },
              { key: 'subject2', label: '其他学科', type: 'text', placeholder: '如 物理、化学' },
              { key: 'classes', label: '负责班级', type: 'classes', options: data.classes.map((klass) => ({ value: klass.name, label: klass.name })) },
            ]}
            searchText={(row) => [row.name, row.grade, row.subject, row.subject2, row.classes].filter(Boolean).join(' ')}
            onChange={(id, key, value) => update('teachers', id, key, value)}
            onBatchEdit={(ids, key, value) => batchEdit('teachers', ids, key, value)}
            onRemoveMany={(ids) => removeMany('teachers', ids)}
            onEditClasses={(id) =>
              setClassPicker({
                id,
                selected: splitClassNames(data.teachers.find((teacher) => teacher.id === id)?.classes),
              })
            }
            onClose={() => setWorkspace(null)}
            note="负责班级留空表示不限制；可批量设置负责年级/主要学科/其他学科/负责班级。批量修改负责班级会受现有教学计划约束：与计划不一致时，保存会被数据检查拦截。被教学计划引用的教师不能删除，改名请逐条编辑。"
          />
        ) : null}
        {classPicker ? (
          <div className="classes-dialog-backdrop" onClick={() => setClassPicker(null)}>
            <div
              className="classes-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="选择负责班级"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="classes-dialog-head">
                <span className="kicker">// CLASS BINDING</span>
                <h3>{data.teachers.find((teacher) => teacher.id === classPicker.id)?.name ?? '教师'} · 负责班级</h3>
                <p>不勾选表示不限制；可多选。排课和自动分配教师只使用这里选中的班级。</p>
              </div>
              <div className="classes-dialog-list">
                {data.classes.length === 0 ? (
                  <p className="panel-note">还没有班级，请先新增班级。</p>
                ) : (
                  data.classes.map((klass) => {
                    const checked = classPicker.selected.some(
                      (name) => name.toLowerCase() === klass.name.toLowerCase(),
                    );
                    return (
                      <label className="classes-dialog-option" key={klass.id}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setClassPicker({
                              ...classPicker,
                              selected: checked
                                ? classPicker.selected.filter((name) => name.toLowerCase() !== klass.name.toLowerCase())
                                : [...classPicker.selected, klass.name],
                            })
                          }
                        />
                        <span>{klass.name}</span>
                        {klass.grade ? <small>{klass.grade}</small> : null}
                      </label>
                    );
                  })
                )}
              </div>
              <div className="classes-dialog-actions">
                <button
                  type="button"
                  className="tt-btn tt-btn-quiet"
                  onClick={() => setClassPicker({ ...classPicker, selected: [] })}
                >
                  不限制
                </button>
                <button type="button" className="tt-btn tt-btn-quiet" onClick={() => setClassPicker(null)}>
                  取消
                </button>
                <button
                  type="button"
                  className="tt-btn tt-btn-primary"
                  onClick={() => {
                    const selected = data.classes
                      .filter((klass) =>
                        classPicker.selected.some((name) => name.toLowerCase() === klass.name.toLowerCase()),
                      )
                      .map((klass) => klass.name);
                    update('teachers', classPicker.id, 'classes', selected.join('、'));
                    setClassPicker(null);
                  }}
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (kind === 'subjects') {
    const columns: Column<Subject>[] = [
      { key: 'name', label: '学科名称', width: '58%' },
      {
        key: 'preference',
        label: '时间偏好',
        type: 'select',
        width: '30%',
        defaultValue: '',
        options: [
          { value: '', label: '不限' },
          { value: 'morning', label: '上午' },
          { value: 'afternoon', label: '下午' },
        ],
      },
    ];
    return (
      <div className="resource-single">
        <EditableTable<Subject>
          title="学科"
          english="SUBJECT REGISTER"
          rows={data.subjects}
          columns={columns}
          onChange={(id, key, value) => update('subjects', id, key, value)}
          onAdd={() => add('subjects')}
          onRemove={(id) => remove('subjects', id)}
          addLabel="新增学科"
          note="新增后可直接在表格中修改名称；时间偏好用于「学科时段偏好」软约束（语文、数学等默认上午，阅读、班会等活动类默认下午），可改为不限。"
          previewCount={6}
          highlightId={highlightFor('subjects')}
          onOpenAll={() => setWorkspace('subjects')}
        />
        {workspace === 'subjects' ? (
          <ResourceWorkspace<Subject>
            title="学科"
            english="SUBJECT REGISTER"
            rows={data.subjects}
            columns={columns}
            batchFields={[
              { key: 'preference', label: '时间偏好', type: 'select', options: [
                { value: '', label: '不限' },
                { value: 'morning', label: '上午' },
                { value: 'afternoon', label: '下午' },
              ] },
            ]}
            searchText={(row) => row.name}
            onChange={(id, key, value) => update('subjects', id, key, value)}
            onBatchEdit={(ids, key, value) => batchEdit('subjects', ids, key, value)}
            onRemoveMany={(ids) => removeMany('subjects', ids)}
            onClose={() => setWorkspace(null)}
            note="学科名称和时间偏好可直接修改，也可勾选多个学科批量设置时间偏好；被教学计划引用的学科不能删除。"
          />
        ) : null}
      </div>
    );
  }

  if (kind === 'rooms') {
    const columns: Column<Room>[] = [
      { key: 'name', label: '教室名称', width: '38%' },
      { key: 'capacity', label: '容量', type: 'number', width: '22%' },
      { key: 'type', label: '类型', width: '34%' },
    ];
    return (
      <div className="resource-single">
        <EditableTable<Room>
          title="教室"
          english="ROOM REGISTER"
          rows={data.rooms}
          columns={columns}
          onChange={(id, key, value) => update('rooms', id, key, value)}
          onAdd={() => add('rooms')}
          onRemove={(id) => remove('rooms', id)}
          addLabel="新增教室"
          note="教室类型会与教学计划的教室类型要求匹配；容量必须大于等于班级人数。"
          previewCount={6}
          highlightId={highlightFor('rooms')}
          onOpenAll={() => setWorkspace('rooms')}
        />
        {workspace === 'rooms' ? (
          <ResourceWorkspace<Room>
            title="教室"
            english="ROOM REGISTER"
            rows={data.rooms}
            columns={columns}
            batchFields={[
              { key: 'type', label: '类型', type: 'text', placeholder: '如 实验室' },
              { key: 'capacity', label: '容量', type: 'number', placeholder: '如 50' },
            ]}
            searchText={(row) => row.name + ' ' + (row.type ?? '')}
            onChange={(id, key, value) => update('rooms', id, key, value)}
            onBatchEdit={(ids, key, value) => batchEdit('rooms', ids, key, value)}
            onRemoveMany={(ids) => removeMany('rooms', ids)}
            onClose={() => setWorkspace(null)}
            note="至少保留一间教室；批量删除会先校验再整体提交。"
          />
        ) : null}
      </div>
    );
  }

  if (kind === 'timeSlots') {
    const columns: Column<TimeSlot>[] = [
      { key: 'day', label: '星期', type: 'select', options: days, width: '14%' },
      { key: 'period', label: '节次', type: 'number', width: '10%' },
      { key: 'kind', label: '时段类型', type: 'select', options: SLOT_KIND_OPTIONS, width: '18%', defaultValue: 'regular' },
      { key: 'start', label: '开始', width: '12%' },
      { key: 'duration', label: '分钟', type: 'number', width: '10%' },
      { key: 'label', label: '显示名称', width: '30%' },
    ];
    const templatePlan = planDayTemplate(data.timeSlots, templateSourceDay, templateDays, templateMode);
    const sourceSlots = templatePlan.sourceSlots;
    const targetDayText = templatePlan.targetDays.map((day) => weekdayLabel(day)).join('、');
    const pendingTemplateChanges = templatePlan.additions + templatePlan.overwrites;
    return (
      <div className="resource-single resource-stack">
        <section className="section-panel slot-template">
          <div className="panel-head">
            <SectionHeading english="WEEKLY TIME TEMPLATE" title="周时间段模板" />
            <span className="status-tag">设置一天 · 套用多天</span>
          </div>
          <p className="panel-note slot-template-lead">
            周一到周日通常使用同一套节次。先设置好其中一天，再勾选其他星期，一键把当天的节次、时段类型、开始时间、时长和名称复制过去。
          </p>
          <div className="slot-template-steps">
            <div className="slot-template-step">
              <span className="slot-template-step-no">1</span>
              <div className="slot-template-step-body">
                <label className="slot-template-field">
                  <span>选择模板日</span>
                  <select
                    value={templateSourceDay}
                    onChange={(event) => {
                      const nextSource = Number(event.target.value);
                      setTemplateSourceDay(nextSource);
                      setTemplateDays((current) => current.filter((day) => day !== nextSource));
                    }}
                  >
                    {DAYS.slice(1).map((label, index) => {
                      const day = index + 1;
                      const count = data.timeSlots.filter((slot) => slot.day === day).length;
                      return <option key={day} value={day}>{label}（{count} 节）</option>;
                    })}
                  </select>
                </label>
                <div className="slot-template-chips">
                  {sourceSlots.length > 0 ? sourceSlots.map((slot) => (
                    <span className="slot-template-chip" key={slot.id} title={slot.label}>
                      <b>第{slot.period}节</b>
                      <em>{SLOT_KIND_LABELS[slot.kind ?? 'regular']}</em>
                      <small>{slot.start ? slot.start + (slot.duration ? ' · ' + slot.duration + ' 分钟' : '') : '未填时间'}</small>
                    </span>
                  )) : (
                    <span className="slot-template-empty">这一天还没有时间段，请先在下方表格新增，或用「快速生成空白节次」。</span>
                  )}
                </div>
              </div>
            </div>

            <div className="slot-template-step">
              <span className="slot-template-step-no">2</span>
              <div className="slot-template-step-body">
                <div className="slot-template-step-head">
                  <span className="slot-template-field-label">勾选要套用的星期 <b>{templatePlan.targetDays.length} 天</b></span>
                  <div className="slot-template-actions">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setTemplateDays([1, 2, 3, 4, 5].filter((day) => day !== templateSourceDay))}
                    >
                      工作日
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setTemplateDays([1, 2, 3, 4, 5, 6, 7].filter((day) => day !== templateSourceDay))}
                    >
                      全选
                    </button>
                    <button type="button" className="ghost-button" onClick={() => setTemplateDays([])}>清空</button>
                  </div>
                </div>
                <div className="slot-template-days">
                  {DAYS.slice(1).map((label, index) => {
                    const day = index + 1;
                    const isSource = day === templateSourceDay;
                    const active = isSource || templateDays.includes(day);
                    return (
                      <label
                        key={day}
                        className={'slot-template-day' + (active ? ' active' : '') + (isSource ? ' is-source' : '')}
                        title={isSource ? '模板日：设置好后勾选其他星期' : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={active}
                          disabled={isSource}
                          onChange={() => setTemplateDays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day])}
                        />
                        <b>{label}</b>
                        {isSource ? <small>模板</small> : null}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="slot-template-step">
              <span className="slot-template-step-no">3</span>
              <div className="slot-template-step-body">
                <span className="slot-template-field-label">目标日已有同节次时</span>
                <div className="slot-template-modes">
                  <label className={templateMode === 'skip' ? 'slot-template-mode active' : 'slot-template-mode'}>
                    <input type="radio" name="slot-template-mode" checked={templateMode === 'skip'} onChange={() => setTemplateMode('skip')} />
                    <span><b>跳过已有节次</b><small>只补齐缺少的节次，不改动目标日已有内容</small></span>
                  </label>
                  <label className={templateMode === 'overwrite' ? 'slot-template-mode active' : 'slot-template-mode'}>
                    <input type="radio" name="slot-template-mode" checked={templateMode === 'overwrite'} onChange={() => setTemplateMode('overwrite')} />
                    <span><b>覆盖同节次</b><small>用模板日的时间、类型和名称替换目标日</small></span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="slot-template-footer">
            <div className="slot-template-summary">
              <div className="slot-template-counts">
                <span><b>{templatePlan.additions}</b> 新增</span>
                <span><b>{templatePlan.overwrites}</b> 覆盖</span>
                <span><b>{templatePlan.skips}</b> 跳过</span>
              </div>
              <small>
                {templatePlan.targetDays.length === 0
                  ? '请至少勾选一个目标星期。'
                  : sourceSlots.length === 0
                    ? '模板日还没有时间段，请先设置模板日。'
                    : pendingTemplateChanges === 0
                      ? '所选星期的同节次都已经存在；如需更新，请切换为「覆盖同节次」。'
                      : '将 ' + weekdayLabel(templateSourceDay) + ' 的 ' + sourceSlots.length + ' 个节次套用到 ' + targetDayText + '；目标日多出的节次不会删除。'}
              </small>
            </div>
            <button
              type="button"
              className="mini-button slot-template-apply"
              onClick={applyDayTemplateToDays}
              disabled={sourceSlots.length === 0 || templatePlan.targetDays.length === 0 || pendingTemplateChanges === 0}
            >
              套用到所选星期
            </button>
          </div>
        </section>

        <section className="section-panel slot-batch slot-batch-secondary">
          <div className="panel-head"><SectionHeading english="QUICK BLANK SLOTS" title="快速生成空白节次" /><span className="status-tag muted">可选</span></div>
          <p className="panel-note">模板日还没有节次时，先在这里按节次范围生成空白时间段（默认常规、未填时间）；生成后再回到上方套用到其他星期。已存在的节次会自动跳过。</p>
          <div className="slot-batch-form">
            <div className="slot-day-picker">
              {DAYS.slice(1).map((label, index) => {
                const day = index + 1;
                return (
                  <label key={day} className={batchDays.includes(day) ? 'slot-day active' : 'slot-day'}>
                    <input
                      type="checkbox"
                      checked={batchDays.includes(day)}
                      onChange={() => setBatchDays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day])}
                    />
                    {label}
                  </label>
                );
              })}
            </div>
            <label className="slot-range">起始节次<input type="number" min={1} max={12} value={batchFrom} onChange={(event) => setBatchFrom(Number(event.target.value))} /></label>
            <label className="slot-range">结束节次<input type="number" min={1} max={12} value={batchTo} onChange={(event) => setBatchTo(Number(event.target.value))} /></label>
            <button type="button" className="mini-button" onClick={addBatchSlots}>生成空白节次</button>
          </div>
        </section>

        <EditableTable<TimeSlot>
          title="周时间段"
          english="TIME SLOTS"
          rows={data.timeSlots}
          columns={columns}
          onChange={(id, key, value) => update('timeSlots', id, key, value)}
          onAdd={() => add('timeSlots')}
          onRemove={(id) => remove('timeSlots', id)}
          addLabel="新增时间段"
          note="修改星期或节次会清空候选课表；请先确认课表结构。"
          previewCount={6}
          highlightId={highlightFor('timeSlots')}
          onOpenAll={() => setWorkspace('timeSlots')}
        />
        {workspace === 'timeSlots' ? (
          <ResourceWorkspace<TimeSlot>
            title="周时间段"
            english="TIME SLOTS"
            rows={data.timeSlots}
            columns={columns}
            batchFields={[
              { key: 'kind', label: '时段类型', type: 'select', options: SLOT_KIND_OPTIONS },
              { key: 'duration', label: '时长（分钟）', type: 'number', placeholder: '如 45' },
              { key: 'start', label: '开始时间', type: 'text', placeholder: '如 08:00' },
            ]}
            searchText={(row) => row.label + ' ' + row.kind}
            onChange={(id, key, value) => update('timeSlots', id, key, value)}
            onBatchEdit={(ids, key, value) => batchEdit('timeSlots', ids, key, value)}
            onRemoveMany={(ids) => removeMany('timeSlots', ids)}
            onClose={() => setWorkspace(null)}
            note="修改星期、节次或时段类型会清空候选课表；被设为固定时间的时间段不能删除。"
          />
        ) : null}
      </div>
    );
  }

  return null;
}

export { ResourcesPage };





























