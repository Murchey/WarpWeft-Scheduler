import { useEffect, useMemo, useRef, useState } from 'react';
import { exportCsv, exportWorkbook } from '../../../packages/import-export/src';
import {
  ADJUSTMENT_LABELS,
  activeAdjustmentOf,
  describeAdjustment,
  effectiveAdjustments,
  effectiveEntries,
  formatClock,
  isNoopMove,
  planMove,
  planSwap,
  slotWindow,
  substituteCandidates,
  summarizeAdjustments,
  validateAdjustment,
  weekdayOf,
} from '../../../packages/adjustments/src';
import { weekOfDate } from '../../../packages/semester/src';
import { buildAdjustmentImpact } from './adjustmentImpact';
import type { AdjustmentImpact } from './adjustmentImpact';
import type {
  Adjustment,
  AdjustmentDraft,
  AdjustmentEntry,
  AdjustmentType,
  MovePlan,
  SwapPlan,
} from '../../../packages/adjustments/src';
import { KIND_LABELS } from '../../../packages/inspection/src';
import type { Commit, ScheduleEntry, SchoolData, TimeSlot } from './types';
import { EmptyState } from './runViews';
import { DAYS, SectionHeading } from './components';
import { download, exportMessage } from './download';
import { LessonLogPanel } from './LessonLogPanel';
import { messageOf, todayLocal, uid } from './utils';
import { findClass, findRoom, findTeacher, planOf, planSubjectName } from './selectors';

const TYPES: AdjustmentType[] = ['move', 'swap', 'substitute', 'cancel'];
const GRADE_NAMES: Record<string, string> = {
  '1': '一年级',
  '2': '二年级',
  '3': '三年级',
  '4': '四年级',
  '5': '五年级',
  '6': '六年级',
  '7': '七年级',
  '8': '八年级',
  '9': '九年级',
};
const CLASS_STORAGE_KEY = 'warpweft-adjust-class';
const OPERATOR_STORAGE_KEY = 'warpweft-operator';
type AdjustmentScope = 'class' | 'teacher';

type StatusTone = 'success' | 'warning' | 'error' | 'neutral';
interface PageStatus {
  tone: StatusTone;
  text: string;
  undo?: () => void;
}

interface RowCard {
  entry: AdjustmentEntry;
  adjustment?: Adjustment;
}

interface RowShadow {
  kind: 'moved' | 'cancelled';
  entry: AdjustmentEntry;
  adjustment: Adjustment;
  slotId: string;
}

function weekLabelOf(date: string): string {
  const day = weekdayOf(date);
  return day ? DAYS[day] : '';
}

function addDays(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const value = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(value.getTime())) return date;
  value.setDate(value.getDate() + days);
  return (
    value.getFullYear() +
    '-' +
    String(value.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(value.getDate()).padStart(2, '0')
  );
}

function nextSchoolDate(date: string, slots: TimeSlot[]): string {
  const sourceWeekday = weekdayOf(date);
  for (let offset = 1; offset <= 14; offset += 1) {
    const candidate = addDays(date, offset);
    const weekday = weekdayOf(candidate);
    if (weekday && weekday !== sourceWeekday && slots.some((slot) => slot.day === weekday)) return candidate;
  }
  return addDays(date, 1);
}

function timeText(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function timeRangeOf(slot: TimeSlot): string {
  const window = slotWindow(slot);
  return window ? formatClock(window.start) + '–' + formatClock(window.end) : '';
}

function withAudit(data: SchoolData, action: string, detail: string, at: string): SchoolData {
  return {
    ...data,
    auditLog: [...(data.auditLog ?? []), { id: uid('audit'), at, action, detail }],
  };
}

function resolveInitialClass(data: SchoolData, date: string): string {
  const params = new URLSearchParams(window.location.search);
  let saved = '';
  try {
    saved = window.localStorage.getItem(CLASS_STORAGE_KEY) ?? '';
  } catch {
    saved = '';
  }
  const candidates = [params.get('class') ?? '', saved].filter(Boolean);
  for (const id of candidates) {
    if (data.classes.some((klass) => klass.id === id)) return id;
  }
  const active = effectiveAdjustments(data.adjustments, date);
  const withAdjustment = active.find((item) => data.classes.some((klass) => klass.id === item.classId));
  if (withAdjustment) return withAdjustment.classId;
  const result = data.candidate ?? data.published ?? null;
  const weekday = weekdayOf(date);
  const slotIds = new Set(data.timeSlots.filter((slot) => slot.day === weekday).map((slot) => slot.id));
  const entry = result?.entries.find((item) => slotIds.has(item.slotId));
  if (entry) return entry.classId;
  return data.classes[0]?.id ?? '';
}

export function AdjustmentsPage({
  data,
  commit,
  setError,
  setNotice,
  onQuickExport,
}: {
  data: SchoolData;
  commit: Commit;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
  onQuickExport?: (view: 'class' | 'teacher', entityId: string, weekNo: number | null) => void;
}) {
  const initialDate = new URLSearchParams(window.location.search).get('date') || todayLocal();
  const [date, setDate] = useState(initialDate);
  const [swapTargetDate, setSwapTargetDate] = useState(() => nextSchoolDate(initialDate, data.timeSlots));
  const [classId, setClassId] = useState(() => resolveInitialClass(data, initialDate));
  const [scope, setScope] = useState<AdjustmentScope>('class');
  const [teacherId, setTeacherId] = useState(data.teachers[0]?.id ?? '');
  const [operator, setOperator] = useState(() => {
    try {
      return window.localStorage.getItem(OPERATOR_STORAGE_KEY) || '本机管理员';
    } catch {
      return '本机管理员';
    }
  });
  const [selectedEntryId, setSelectedEntryId] = useState('');
  const [draftType, setDraftType] = useState<AdjustmentType>('move');
  const [substituteTeacherId, setSubstituteTeacherId] = useState('');
  const [reason, setReason] = useState('');
  const [dragEntryId, setDragEntryId] = useState('');
  const [hoverSlotId, setHoverSlotId] = useState('');
  const [failedSlotId, setFailedSlotId] = useState('');
  const [status, setStatus] = useState<PageStatus | null>(null);
  const [impact, setImpact] = useState<AdjustmentImpact | null>(null);
  const [impactOpen, setImpactOpen] = useState(false);
  const boardRef = useRef<HTMLElement | null>(null);
  const latestData = useRef(data);

  useEffect(() => {
    latestData.current = data;
  }, [data]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CLASS_STORAGE_KEY, classId);
    } catch {
      // ignore
    }
  }, [classId]);

  useEffect(() => {
    if (classId && data.classes.some((klass) => klass.id === classId)) return;
    setClassId(resolveInitialClass(data, date));
  }, [classId, data, date]);

  useEffect(() => {
    setSwapTargetDate(nextSchoolDate(date, data.timeSlots));
  }, [date, data.timeSlots]);

  const result = data.candidate ?? data.published ?? null;
  const adjustments = data.adjustments ?? [];
  const previousAdjustments = useRef({ date, adjustments });
  const weekday = weekdayOf(date);
  const slotById = useMemo(() => new Map(data.timeSlots.map((slot) => [slot.id, slot])), [data.timeSlots]);
  const slotLabelOf = (slotId?: string) => (slotId ? slotById.get(slotId)?.label ?? slotId : '');
  const periodOf = (slotId?: string) => slotById.get(slotId ?? '')?.period ?? 0;
  const swapOtherDate = (adjustment: Adjustment, entryId?: string) =>
    adjustment.originalEntryId === entryId ? adjustment.targetDate : adjustment.date;
  const swapOtherSlot = (adjustment: Adjustment, entryId?: string) =>
    adjustment.originalEntryId === entryId ? adjustment.targetSlotId : adjustment.slotId;
  const swapOriginDate = (adjustment: Adjustment, entryId?: string) =>
    adjustment.originalEntryId === entryId ? adjustment.date : adjustment.targetDate;
  const swapOriginSlot = (adjustment: Adjustment, entryId?: string) =>
    adjustment.originalEntryId === entryId ? adjustment.slotId : adjustment.targetSlotId;
  const daySlots = useMemo(
    () => data.timeSlots.filter((slot) => slot.day === weekday).slice().sort((a, b) => a.period - b.period),
    [data.timeSlots, weekday],
  );
  const baseEntries = useMemo<ScheduleEntry[]>(() => result?.entries ?? [], [result]);
  useEffect(() => {
    const previous = previousAdjustments.current;
    previousAdjustments.current = { date, adjustments };
    if (previous.date !== date) {
      setImpact(null);
      return;
    }
    if (previous.adjustments === adjustments) return;
    if (!result) {
      setImpact(null);
      return;
    }
    const next = buildAdjustmentImpact(
      data,
      date,
      previous.adjustments,
      adjustments,
      baseEntries as AdjustmentEntry[],
    );
    setImpact(next);
    if (!next) setImpactOpen(false);
  }, [adjustments, baseEntries, data, date, result]);
  const allEffective = useMemo<AdjustmentEntry[]>(
    () =>
      result
        ? effectiveEntries({ ...data, entries: baseEntries as AdjustmentEntry[] }, date, adjustments)
        : [],
    [adjustments, baseEntries, data, date, result],
  );
  const classBaseEntries = useMemo(
    () => baseEntries.filter((entry) => entry.classId === classId && slotById.get(entry.slotId)?.day === weekday),
    [baseEntries, classId, slotById, weekday],
  );
  const classEffective = useMemo(
    () => allEffective.filter((entry) => entry.classId === classId),
    [allEffective, classId],
  );
  const dayAdjustments = useMemo(
    () => adjustments.filter((item) => item.date === date || (item.type === 'swap' && item.targetDate === date)),
    [adjustments, date],
  );
  const effectiveDayAdjustments = useMemo(() => effectiveAdjustments(adjustments, date), [adjustments, date]);
  const noopRecords = useMemo(
    () => dayAdjustments.filter((item) => item.status === 'active' && isNoopMove(item)),
    [dayAdjustments],
  );
  const summary = useMemo(() => summarizeAdjustments(dayAdjustments), [dayAdjustments]);
  const classCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of effectiveDayAdjustments) map.set(item.classId, (map.get(item.classId) ?? 0) + 1);
    return map;
  }, [effectiveDayAdjustments]);
  const classGroups = useMemo(() => {
    const map = new Map<string, SchoolData['classes']>();
    for (const klass of data.classes) {
      const grade = klass.grade || '';
      const list = map.get(grade) ?? [];
      list.push(klass);
      map.set(grade, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  }, [data.classes]);
  const teacherEntries = useMemo(
    () => allEffective
      .filter((entry) => entry.teacherId === teacherId && slotById.get(entry.slotId)?.day === weekday)
      .sort((a, b) => (periodOf(a.slotId) || 99) - (periodOf(b.slotId) || 99) || a.classId.localeCompare(b.classId, 'zh-CN')),
    [allEffective, slotById, teacherId, weekday],
  );
  const teacherLessonCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of allEffective) {
      if (slotById.get(entry.slotId)?.day !== weekday) continue;
      map.set(entry.teacherId, (map.get(entry.teacherId) ?? 0) + 1);
    }
    return map;
  }, [allEffective, slotById, weekday]);
  const classNameText = findClass(data, classId)?.name ?? '未选择班级';
  const impactClassName = impact ? findClass(data, impact.classId)?.name ?? impact.classId : '';
  const impactTeacherNames = impact
    ? impact.teacherIds.map((teacherId) => findTeacher(data, teacherId)?.name ?? teacherId).join('、')
    : '';
  const impactWeekNo = impact ? weekOfDate(data.semester, impact.date) : null;
  const impactSlotLabels = impact ? impact.slotIds.map((slotId) => slotLabelOf(slotId)).join('、') : '';
  const impactEntryText = (entry: AdjustmentEntry, view: 'class' | 'teacher') => {
    const bits = [subjectOfEntry(entry), findTeacher(data, entry.teacherId)?.name ?? entry.teacherId];
    if (view === 'teacher') bits.push(findClass(data, entry.classId)?.name ?? entry.classId);
    return bits.filter(Boolean).join(' · ');
  };
  const renderImpactRows = (before: AdjustmentEntry[], after: AdjustmentEntry[], view: 'class' | 'teacher') => (
    <div className="impact-rows">
      {daySlots.map((slot) => {
        const beforeText = before.filter((entry) => entry.slotId === slot.id).map((entry) => impactEntryText(entry, view)).join(' / ');
        const afterText = after.filter((entry) => entry.slotId === slot.id).map((entry) => impactEntryText(entry, view)).join(' / ');
        return (
          <div className={'impact-row' + (beforeText !== afterText ? ' is-changed' : '')} key={slot.id}>
            <b>第{slot.period}节</b>
            <span className="impact-before">{beforeText || '空'}</span>
            <span className="impact-arrow">→</span>
            <span className="impact-after">{afterText || '空'}</span>
          </div>
        );
      })}
    </div>
  );

  const baseOf = (entryId: string) => baseEntries.find((entry) => entry.id === entryId);
  const activeOf = (entryId: string) => activeAdjustmentOf(adjustments, date, entryId);
  const restorePlanFor = (adjustment?: Adjustment): MovePlan | null => {
    if (!adjustment || adjustment.type !== 'move') return null;
    const base = baseOf(adjustment.originalEntryId);
    if (!base) return null;
    return planMove(
      { ...data, entries: baseEntries as AdjustmentEntry[] },
      { date, originalEntryId: base.id, targetSlotId: adjustment.slotId, adjustments },
    );
  };
  const planForEntry = (entry: { coursePlanId: string }) =>
    data.coursePlans.find((plan) => plan.id === entry.coursePlanId);
  const subjectOfEntry = (entry: { coursePlanId: string }) => planSubjectName(data, planForEntry(entry));

  const selected = selectedEntryId ? baseOf(selectedEntryId) : undefined;
  const selectedAdjustment = selected ? activeOf(selected.id) : undefined;
  const selectedEffective = selected ? classEffective.find((entry) => entry.id === selected.id) : undefined;
  const selectedCurrentSlotId = selectedEffective?.slotId ?? selected?.slotId ?? '';
  const selectedTeacherId = selectedEffective?.teacherId ?? selected?.teacherId ?? '';
  const selectedRoomId = selectedEffective?.roomId ?? selected?.roomId ?? '';

  const focusEntryId = dragEntryId || selectedEntryId;
  const focusBase = focusEntryId ? baseOf(focusEntryId) : undefined;
  const focusAdjustment = focusBase ? activeOf(focusBase.id) : undefined;
  const moveMode = Boolean(focusBase) && draftType === 'move' && (!focusAdjustment || focusAdjustment.type === 'move');
  const selectedRestorePlan = restorePlanFor(selectedAdjustment);
  const focusRestorePlan = restorePlanFor(focusAdjustment);
  const selectedNoop = Boolean(selectedAdjustment && selectedAdjustment.status === 'active' && isNoopMove(selectedAdjustment));
  const focusNoop = Boolean(focusAdjustment && focusAdjustment.status === 'active' && isNoopMove(focusAdjustment));

  const targetPlans = useMemo<Map<string, MovePlan>>(() => {
    const map = new Map<string, MovePlan>();
    if (!focusBase || !moveMode) return map;
    const source = { ...data, entries: baseEntries as AdjustmentEntry[] };
    for (const slot of daySlots) {
      map.set(
        slot.id,
        planMove(source, {
          date,
          originalEntryId: focusBase.id,
          targetSlotId: slot.id,
          adjustments,
        }),
      );
    }
    return map;
  }, [adjustments, baseEntries, data, date, daySlots, focusBase, moveMode]);

  const targetCounts = useMemo(() => {
    let valid = 0;
    let blocked = 0;
    let restore = 0;
    for (const plan of targetPlans.values()) {
      if (plan.kind === 'apply') valid += 1;
      else if (plan.kind === 'blocked') blocked += 1;
      else if (plan.kind === 'restore') restore += 1;
    }
    return { valid, blocked, restore };
  }, [targetPlans]);

  const swapTargetEntries = useMemo(() => {
    if (!result || !selected) return [];
    const targetWeekday = weekdayOf(swapTargetDate);
    if (!targetWeekday) return [];
    return effectiveEntries({ ...data, entries: baseEntries as AdjustmentEntry[] }, swapTargetDate, adjustments)
      .filter((entry) => entry.classId === selected.classId)
      .sort((a, b) => (periodOf(a.slotId) || 99) - (periodOf(b.slotId) || 99));
  }, [adjustments, baseEntries, data, result, selected, swapTargetDate]);

  const swapPlans = useMemo<{ entry: AdjustmentEntry; plan: SwapPlan }[]>(() => {
    if (!selected) return [];
    const source = { ...data, entries: baseEntries as AdjustmentEntry[] };
    return swapTargetEntries.map((entry) => ({
      entry,
      plan: planSwap(source, {
        date,
        originalEntryId: selected.id,
        targetDate: swapTargetDate,
        targetEntryId: entry.id,
        adjustments,
      }),
    }));
  }, [adjustments, baseEntries, data, date, selected, swapTargetDate, swapTargetEntries]);

  const swapValidCount = swapPlans.filter((item) => item.plan.kind === 'apply').length;
  const swapBlockedCount = swapPlans.length - swapValidCount;

  const cardsBySlot = useMemo(() => {
    const map = new Map<string, RowCard[]>();
    for (const entry of classEffective) {
      const list = map.get(entry.slotId) ?? [];
      list.push({ entry, adjustment: activeAdjustmentOf(adjustments, date, entry.id) });
      map.set(entry.slotId, list);
    }
    return map;
  }, [adjustments, classEffective, date]);

  const shadowsBySlot = useMemo(() => {
    const map = new Map<string, RowShadow[]>();
    for (const entry of classBaseEntries) {
      const adjustment = activeAdjustmentOf(adjustments, date, entry.id);
      if (!adjustment) continue;
      let shadow: RowShadow | null = null;
      if (adjustment.type === 'cancel') {
        shadow = { kind: 'cancelled', entry, adjustment, slotId: entry.slotId };
      } else if (
        adjustment.type === 'move' &&
        !isNoopMove(adjustment) &&
        adjustment.targetSlotId &&
        adjustment.targetSlotId !== entry.slotId
      ) {
        shadow = { kind: 'moved', entry, adjustment, slotId: entry.slotId };
      } else if (adjustment.type === 'swap') {
        shadow = { kind: 'moved', entry, adjustment, slotId: entry.slotId };
      }
      if (!shadow) continue;
      const list = map.get(shadow.slotId) ?? [];
      list.push(shadow);
      map.set(shadow.slotId, list);
    }
    return map;
  }, [adjustments, classBaseEntries, date]);

  const candidates = useMemo(() => {
    if (!result || !selected) return [];
    const selectedPlan = planForEntry(selected);
    const selectedSubject = subjectOfEntry(selected);
    return substituteCandidates(
      { ...data, entries: baseEntries as AdjustmentEntry[] },
      date,
      selected.id,
      adjustments,
    )
      .slice()
      .map((item) => {
        const teacher = data.teachers.find((candidate) => candidate.id === item.id) as (typeof data.teachers)[number] & { subjectIds?: string[] } | undefined;
        const sameSubject = Boolean(teacher && (teacher.subject === selectedSubject || teacher.subject2 === selectedSubject || teacher.subjectIds?.includes(selectedPlan?.subjectId ?? '')));
        const load = teacherLessonCounts.get(item.id) ?? 0;
        return { ...item, sameSubject, load };
      })
      .sort((a, b) => Number(a.unavailable) - Number(b.unavailable) || Number(b.sameSubject) - Number(a.sameSubject) || a.load - b.load || a.name.localeCompare(b.name, 'zh-CN'));
  }, [adjustments, baseEntries, data, date, result, selected, teacherLessonCounts]);

  const substituteCheck = useMemo(() => {
    if (!selected || draftType !== 'substitute' || selectedAdjustment) return null;
    const draft: AdjustmentDraft = {
      date,
      type: 'substitute',
      originalEntryId: selected.id,
      substituteTeacherId: substituteTeacherId || undefined,
      reason,
      createdBy: operator,
    };
    return validateAdjustment({ ...data, entries: baseEntries as AdjustmentEntry[] }, draft, adjustments);
  }, [adjustments, baseEntries, data, date, draftType, operator, reason, selected, selectedAdjustment, substituteTeacherId]);

  const cancelCheck = useMemo(() => {
    if (!selected || draftType !== 'cancel' || selectedAdjustment) return null;
    const draft: AdjustmentDraft = {
      date,
      type: 'cancel',
      originalEntryId: selected.id,
      reason,
      createdBy: operator,
    };
    return validateAdjustment({ ...data, entries: baseEntries as AdjustmentEntry[] }, draft, adjustments);
  }, [adjustments, baseEntries, data, date, draftType, operator, reason, selected, selectedAdjustment]);

  const sortedHistory = useMemo(
    () =>
      dayAdjustments.slice().sort((a, b) => {
        const order = (item: Adjustment) => (item.status === 'active' ? 0 : 1);
        return order(a) - order(b) || String(b.createdAt).localeCompare(String(a.createdAt));
      }),
    [dayAdjustments],
  );

  const persistOperator = (value: string) => {
    setOperator(value);
    try {
      window.localStorage.setItem(OPERATOR_STORAGE_KEY, value);
    } catch {
      // ignore
    }
  };

  const clearSelection = () => {
    setSelectedEntryId('');
    setDragEntryId('');
    setHoverSlotId('');
    setFailedSlotId('');
    setSubstituteTeacherId('');
    setReason('');
    setStatus(null);
  };

  const selectEntry = (entryId: string) => {
    const base = baseOf(entryId);
    if (!base) return;
    const adjustment = activeOf(entryId);
    setSelectedEntryId(entryId);
    setDragEntryId('');
    setHoverSlotId('');
    setFailedSlotId('');
    setSubstituteTeacherId(adjustment?.type === 'substitute' ? adjustment.substituteTeacherId ?? '' : '');
    setReason(adjustment?.reason ?? '');
    setDraftType(adjustment?.type ?? 'move');
    setStatus(null);
  };

  const changeDate = (next: string) => {
    setDate(next);
    setImpact(null);
    setImpactOpen(false);
    clearSelection();
  };

  const changeClass = (next: string) => {
    setClassId(next);
    setImpact(null);
    setImpactOpen(false);
    clearSelection();
  };

  const selectTeacherEntry = (entry: AdjustmentEntry) => {
    setTeacherId(entry.teacherId);
    setClassId(entry.classId);
    setScope('class');
    selectEntry(entry.id);
  };

  const shiftDate = (offset: number) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) return;
    const base = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (Number.isNaN(base.getTime())) return;
    base.setDate(base.getDate() + offset);
    const next =
      base.getFullYear() +
      '-' +
      String(base.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(base.getDate()).padStart(2, '0');
    changeDate(next);
  };

  const undoCreate = (adjustmentId: string) => {
    const current = latestData.current;
    const at = new Date().toISOString();
    const target = (current.adjustments ?? []).find((item) => item.id === adjustmentId);
    if (!target) {
      setStatus({ tone: 'warning', text: '这条调整已不存在。' });
      return;
    }
    const detail =
      describeAdjustment(target, current) + ' · 撤销 · 操作人 ' + (operator.trim() || '未填写');
    commit(
      withAudit(
        {
          ...current,
          adjustments: (current.adjustments ?? []).map((item) =>
            item.id === adjustmentId
              ? { ...item, status: 'revoked' as const, revokedAt: at, revokedBy: operator.trim() || undefined }
              : item,
          ),
        },
        'ADJUSTMENT_REVOKE',
        detail,
        at,
      ),
      { immediate: true },
    );
    setStatus({ tone: 'neutral', text: '已撤销这次调整。' });
  };

  const revokeDayAdjustments = () => {
    const current = latestData.current;
    const targets = (current.adjustments ?? []).filter(
      (item) => item.status === 'active' && (item.date === date || (item.type === 'swap' && item.targetDate === date)),
    );
    if (targets.length === 0) {
      setStatus({ tone: 'warning', text: '当前日期没有可撤销的调整。' });
      return;
    }
    if (!window.confirm(`撤销 ${targets.length} 条 ${date} 的调整？操作会写入审计记录。`)) return;
    const at = new Date().toISOString();
    const operatorName = operator.trim() || '未填写';
    commit(
      withAudit(
        {
          ...current,
          adjustments: (current.adjustments ?? []).map((item) =>
            targets.some((target) => target.id === item.id)
              ? { ...item, status: 'revoked' as const, revokedAt: at, revokedBy: operatorName }
              : item,
          ),
        },
        'ADJUSTMENT_BATCH_REVOKE',
        `撤销 ${date} 的 ${targets.length} 条调代课记录 · 操作人 ${operatorName}`,
        at,
      ),
      { immediate: true },
    );
    setStatus({ tone: 'neutral', text: `已撤销 ${targets.length} 条当天调整。` });
  };

  const undoRetarget = (adjustmentId: string, previousTargetSlotId: string, previousReason?: string) => {
    const current = latestData.current;
    const at = new Date().toISOString();
    const target = (current.adjustments ?? []).find((item) => item.id === adjustmentId);
    if (!target) {
      setStatus({ tone: 'warning', text: '这条调整已不存在。' });
      return;
    }
    const detail =
      describeAdjustment(target, current) +
      ' · 改回 ' +
      slotLabelOf(previousTargetSlotId) +
      ' · 操作人 ' +
      (operator.trim() || '未填写');
    commit(
      withAudit(
        {
          ...current,
          adjustments: (current.adjustments ?? []).map((item) =>
            item.id === adjustmentId
              ? {
                  ...item,
                  targetSlotId: previousTargetSlotId,
                  reason: previousReason,
                  updatedAt: at,
                  updatedBy: operator.trim() || undefined,
                }
              : item,
          ),
        },
        'ADJUSTMENT_UNDO',
        detail,
        at,
      ),
      { immediate: true },
    );
    setStatus({ tone: 'neutral', text: '已改回 ' + slotLabelOf(previousTargetSlotId) + '。' });
  };

  const undoRestore = (adjustmentId: string) => {
    const current = latestData.current;
    const at = new Date().toISOString();
    const target = (current.adjustments ?? []).find((item) => item.id === adjustmentId);
    if (!target) {
      setStatus({ tone: 'warning', text: '这条调整已不存在。' });
      return;
    }
    const detail =
      describeAdjustment(target, current) + ' · 恢复调课 · 操作人 ' + (operator.trim() || '未填写');
    commit(
      withAudit(
        {
          ...current,
          adjustments: (current.adjustments ?? []).map((item) =>
            item.id === adjustmentId
              ? { ...item, status: 'active' as const, revokedAt: undefined, revokedBy: undefined }
              : item,
          ),
        },
        'ADJUSTMENT_UNDO',
        detail,
        at,
      ),
      { immediate: true },
    );
    setStatus({ tone: 'neutral', text: '已恢复这条调课。' });
  };

  const createMove = (base: ScheduleEntry, targetSlotId: string) => {
    const createdAt = new Date().toISOString();
    const adjustment: Adjustment = {
      id: uid('adjust'),
      date,
      type: 'move',
      slotId: base.slotId,
      classId: base.classId,
      originalEntryId: base.id,
      targetSlotId,
      reason: reason.trim() || undefined,
      createdBy: operator.trim() || undefined,
      createdAt,
      status: 'active',
    };
    const detail =
      describeAdjustment(adjustment, data) +
      (adjustment.reason ? ' · ' + adjustment.reason : '') +
      ' · 操作人 ' +
      (adjustment.createdBy ?? '未填写');
    commit(
      withAudit({ ...data, adjustments: [...adjustments, adjustment] }, 'ADJUSTMENT', detail, createdAt),
      { immediate: true },
    );
    setFailedSlotId('');
    setStatus({
      tone: 'success',
      text: '已调课：' + describeAdjustment(adjustment, data),
      undo: () => undoCreate(adjustment.id),
    });
  };

  const createSwap = (base: ScheduleEntry, target: AdjustmentEntry, targetDate: string) => {
    const source = { ...data, entries: baseEntries as AdjustmentEntry[] };
    const plan = planSwap(source, {
      date,
      originalEntryId: base.id,
      targetDate,
      targetEntryId: target.id,
      adjustments,
    });
    if (plan.kind === 'blocked') {
      setStatus({
        tone: 'error',
        text: '不能对调：' + plan.blockers.map((blocker) => blocker.text).join('；'),
      });
      return;
    }
    const createdAt = new Date().toISOString();
    const adjustment: Adjustment = {
      id: uid('adjust'),
      date,
      type: 'swap',
      slotId: base.slotId,
      classId: base.classId,
      originalEntryId: base.id,
      targetDate,
      targetSlotId: target.slotId,
      targetEntryId: target.id,
      reason: reason.trim() || undefined,
      createdBy: operator.trim() || undefined,
      createdAt,
      status: 'active',
    };
    const detail =
      describeAdjustment(adjustment, data) +
      (adjustment.reason ? ' · ' + adjustment.reason : '') +
      ' · 操作人 ' +
      (adjustment.createdBy ?? '未填写');
    commit(
      withAudit({ ...data, adjustments: [...adjustments, adjustment] }, 'ADJUSTMENT_SWAP', detail, createdAt),
      { immediate: true },
    );
    setFailedSlotId('');
    setStatus({
      tone: 'success',
      text: '已对调：' + slotLabelOf(base.slotId) + ' ↔ ' + targetDate + ' ' + slotLabelOf(target.slotId),
      undo: () => undoCreate(adjustment.id),
    });
  };

  const retargetMove = (adjustment: Adjustment, targetSlotId: string) => {
    const at = new Date().toISOString();
    const previousTargetSlotId = adjustment.targetSlotId ?? adjustment.slotId;
    const previousReason = adjustment.reason;
    const nextReason = reason.trim() || adjustment.reason;
    const detail =
      describeAdjustment(adjustment, data) +
      ' → ' +
      slotLabelOf(targetSlotId) +
      ' · 操作人 ' +
      (operator.trim() || '未填写');
    commit(
      withAudit(
        {
          ...data,
          adjustments: adjustments.map((item) =>
            item.id === adjustment.id
              ? {
                  ...item,
                  targetSlotId,
                  reason: nextReason,
                  updatedAt: at,
                  updatedBy: operator.trim() || undefined,
                }
              : item,
          ),
        },
        'ADJUSTMENT_UPDATE',
        detail,
        at,
      ),
      { immediate: true },
    );
    setFailedSlotId('');
    setStatus({
      tone: 'success',
      text: '已改到 ' + slotLabelOf(targetSlotId) + '。',
      undo: () => undoRetarget(adjustment.id, previousTargetSlotId, previousReason),
    });
  };

  const restoreMove = (adjustment: Adjustment) => {
    const at = new Date().toISOString();
    const detail =
      describeAdjustment(adjustment, data) +
      ' · 还原原时间 · 操作人 ' +
      (operator.trim() || '未填写');
    commit(
      withAudit(
        {
          ...data,
          adjustments: adjustments.map((item) =>
            item.id === adjustment.id
              ? {
                  ...item,
                  status: 'revoked' as const,
                  revokedAt: at,
                  revokedBy: operator.trim() || undefined,
                }
              : item,
          ),
        },
        'ADJUSTMENT_RESTORE',
        detail,
        at,
      ),
      { immediate: true },
    );
    setFailedSlotId('');
    const base = baseOf(adjustment.originalEntryId);
    setStatus({
      tone: 'success',
      text: '已还原到原时间：' + (base ? subjectOfEntry(base) : '课程') + ' 回到 ' + slotLabelOf(adjustment.slotId) + '。',
      undo: () => undoRestore(adjustment.id),
    });
  };

  const applyTargetFor = (base: ScheduleEntry, slotId: string) => {
    const plan = planMove(
      { ...data, entries: baseEntries as AdjustmentEntry[] },
      { date, originalEntryId: base.id, targetSlotId: slotId, adjustments },
    );
    const period = periodOf(slotId);
    setFailedSlotId('');
    if (plan.kind === 'blocked') {
      setFailedSlotId(slotId);
      setStatus({
        tone: 'error',
        text:
          '不能放到第' + period + '节：' + plan.blockers.map((blocker) => blocker.text).join('；'),
      });
      return;
    }
    if (plan.kind === 'noop') {
      setStatus({ tone: 'neutral', text: '位置没有变化，未创建调整。' });
      return;
    }
    if (plan.kind === 'restore' && plan.adjustment) {
      restoreMove(plan.adjustment);
      return;
    }
    if (plan.kind === 'apply') {
      if (plan.adjustment) retargetMove(plan.adjustment, slotId);
      else createMove(base, slotId);
    }
  };

  const applyTarget = (slotId: string) => {
    if (focusBase) applyTargetFor(focusBase, slotId);
  };

  const requestRestore = (adjustment: Adjustment) => {
    const base = baseOf(adjustment.originalEntryId);
    if (!base) {
      setStatus({ tone: 'warning', text: '找不到这节课程，可能课表已更新。' });
      return;
    }
    applyTargetFor(base, adjustment.slotId);
  };

  const saveSubstitute = () => {
    if (!selected || !substituteCheck?.ok) return;
    const createdAt = new Date().toISOString();
    const adjustment: Adjustment = {
      id: uid('adjust'),
      date,
      type: 'substitute',
      slotId: selected.slotId,
      classId: selected.classId,
      originalEntryId: selected.id,
      substituteTeacherId,
      reason: reason.trim() || undefined,
      createdBy: operator.trim() || undefined,
      createdAt,
      status: 'active',
    };
    const detail =
      describeAdjustment(adjustment, data) +
      (adjustment.reason ? ' · ' + adjustment.reason : '') +
      ' · 操作人 ' +
      (adjustment.createdBy ?? '未填写');
    commit(
      withAudit({ ...data, adjustments: [...adjustments, adjustment] }, 'ADJUSTMENT', detail, createdAt),
      { immediate: true },
    );
    setStatus({
      tone: 'success',
      text: '已代课：' + describeAdjustment(adjustment, data),
      undo: () => undoCreate(adjustment.id),
    });
  };

  const saveCancel = () => {
    if (!selected || !cancelCheck?.ok) return;
    const createdAt = new Date().toISOString();
    const adjustment: Adjustment = {
      id: uid('adjust'),
      date,
      type: 'cancel',
      slotId: selected.slotId,
      classId: selected.classId,
      originalEntryId: selected.id,
      reason: reason.trim() || undefined,
      createdBy: operator.trim() || undefined,
      createdAt,
      status: 'active',
    };
    const detail =
      describeAdjustment(adjustment, data) +
      (adjustment.reason ? ' · ' + adjustment.reason : '') +
      ' · 操作人 ' +
      (adjustment.createdBy ?? '未填写');
    commit(
      withAudit({ ...data, adjustments: [...adjustments, adjustment] }, 'ADJUSTMENT', detail, createdAt),
      { immediate: true },
    );
    setStatus({
      tone: 'success',
      text: '已停课：' + describeAdjustment(adjustment, data),
      undo: () => undoCreate(adjustment.id),
    });
  };

  const revokeAdjustment = (adjustment: Adjustment) => {
    const noop = adjustment.status === 'active' && isNoopMove(adjustment);
    const isMove = adjustment.type === 'move';
    const isSwap = adjustment.type === 'swap';
    if (adjustment.status === 'active' && isMove && !noop) {
      const restorePlan = restorePlanFor(adjustment);
      if (restorePlan?.kind === 'blocked') {
        setStatus({
          tone: 'error',
          text: '不能还原：' + restorePlan.blockers.map((blocker) => blocker.text).join('；'),
        });
        return;
      }
    }
    const prompt = noop
      ? '清理这条原位置调课记录？它不会改变课表，撤销记录会保留在审计里。'
      : isMove
        ? '还原这条调课？课程会回到原时间，撤销记录会保留在审计里。'
        : isSwap
          ? '撤销这次对调？两节课都会回到各自的日期和原时间，撤销记录会保留在审计里。'
          : '撤销这条调整？撤销记录会保留在审计里。';
    if (!window.confirm(prompt)) return;
    const at = new Date().toISOString();
    const detail =
      describeAdjustment(adjustment, data) +
      ' · ' +
      (noop ? '清理原位置记录' : isMove ? '还原' : isSwap ? '撤销对调' : '撤销') +
      ' · 操作人 ' +
      (operator.trim() || '未填写');
    commit(
      withAudit(
        {
          ...data,
          adjustments: adjustments.map((item) =>
            item.id === adjustment.id
              ? {
                  ...item,
                  status: 'revoked' as const,
                  revokedAt: at,
                  revokedBy: operator.trim() || undefined,
                }
              : item,
          ),
        },
        noop ? 'ADJUSTMENT_CLEANUP' : isMove ? 'ADJUSTMENT_RESTORE' : isSwap ? 'ADJUSTMENT_SWAP_REVOKE' : 'ADJUSTMENT_REVOKE',
        detail,
        at,
      ),
      { immediate: true },
    );
    setStatus({
      tone: 'neutral',
      text: noop ? '已清理原位置记录。' : isMove ? '已还原到原时间。' : isSwap ? '已撤销对调，两节课已回到原日期和时间。' : '已撤销一条调整。',
    });
  };

  const cleanupNoops = () => {
    if (noopRecords.length === 0) return;
    if (!window.confirm('清理 ' + noopRecords.length + ' 条原位置调课记录？它们不会改变课表，撤销记录会保留在审计里。')) return;
    const ids = new Set(noopRecords.map((item) => item.id));
    const at = new Date().toISOString();
    const detail = '清理 ' + noopRecords.length + ' 条原位置调课记录 · 操作人 ' + (operator.trim() || '未填写');
    commit(
      withAudit(
        {
          ...data,
          adjustments: adjustments.map((item) =>
            ids.has(item.id)
              ? { ...item, status: 'revoked' as const, revokedAt: at, revokedBy: operator.trim() || undefined }
              : item,
          ),
        },
        'ADJUSTMENT_CLEANUP',
        detail,
        at,
      ),
      { immediate: true },
    );
    setStatus({ tone: 'neutral', text: '已清理 ' + noopRecords.length + ' 条原位置记录。' });
  };

  const locate = (adjustment: Adjustment) => {
    const base = baseOf(adjustment.originalEntryId);
    if (!base) {
      setStatus({ tone: 'warning', text: '这节课程已不在当前课表中。' });
      return;
    }
    setClassId(adjustment.classId);
    setDate(adjustment.date);
    setSelectedEntryId(adjustment.originalEntryId);
    setDraftType(adjustment.type);
    setReason(adjustment.reason ?? '');
    setSubstituteTeacherId(adjustment.substituteTeacherId ?? '');
    setFailedSlotId('');
    setHoverSlotId('');
    setStatus(null);
    window.requestAnimationFrame(() => boardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const exportNotice = async () => {
    try {
      const active = effectiveDayAdjustments;
      const rows = active.map((item) => {
        const base = baseEntries.find((entry) => entry.id === item.originalEntryId);
        const plan = base ? planOf(data, base) : undefined;
        const originalSlot = slotById.get(item.slotId)?.label ?? item.slotId;
        const targetSlot = item.targetSlotId ? slotById.get(item.targetSlotId)?.label ?? item.targetSlotId : '';
        return {
          日期: item.date,
          星期: weekLabelOf(item.date),
          调整类型: ADJUSTMENT_LABELS[item.type],
          原时间: originalSlot,
          调整后时间: item.targetSlotId
            ? (item.type === 'swap' && item.targetDate ? item.targetDate + ' ' : '') + targetSlot
            : originalSlot,
          班级: data.classes.find((klass) => klass.id === item.classId)?.name ?? item.classId,
          学科: plan ? planSubjectName(data, plan) : '',
          原任课教师: base ? findTeacher(data, base.teacherId)?.name ?? base.teacherId : '',
          代课教师: item.substituteTeacherId ? findTeacher(data, item.substituteTeacherId)?.name ?? item.substituteTeacherId : '',
          原因: item.reason ?? '',
          操作人: item.createdBy ?? '',
        };
      });
      const bytes = exportWorkbook({
        代课通知单: rows,
        汇总: [
          { 项目: '学校', 值: data.school.name },
          { 项目: '日期', 值: date + ' ' + weekLabelOf(date) },
          { 项目: '调整条数', 值: active.length },
          { 项目: '操作人', 值: operator },
          { 项目: '导出时间', 值: new Date().toLocaleString('zh-CN') },
        ],
      });
      const exported = await download(
        bytes,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'warpweft-notice-' + date + '.xlsx',
      );
      const message = exportMessage(exported, '代课通知单');
      if (!message) return;
      if (message.tone === 'error') setError(message.text);
      else setNotice(message.text);
    } catch (cause) {
      setError('导出通知单失败：' + messageOf(cause));
    }
  };

  const exportDay = async () => {
    try {
      const rows = dayAdjustments.map((item) => ({
        日期: item.date,
        类型: ADJUSTMENT_LABELS[item.type],
        班级: data.classes.find((klass) => klass.id === item.classId)?.name ?? item.classId,
        原时间: slotById.get(item.slotId)?.label ?? item.slotId,
        目标日期: item.type === 'swap' ? item.targetDate ?? '' : '',
        目标时间: item.targetSlotId ? slotById.get(item.targetSlotId)?.label ?? item.targetSlotId : '',
        代课教师: item.substituteTeacherId ? findTeacher(data, item.substituteTeacherId)?.name ?? item.substituteTeacherId : '',
        原因: item.reason ?? '',
        操作人: item.createdBy ?? '',
        状态: item.status === 'revoked' ? '已撤销' : isNoopMove(item) ? '原位置（无变化）' : '生效',
        记录时间: item.createdAt,
      }));
      const csv = exportCsv(rows);
      const exported = await download(
        new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }),
        'text/csv',
        'warpweft-adjustments-' + date + '.csv',
      );
      const message = exportMessage(exported, '调整清单');
      if (!message) return;
      if (message.tone === 'error') setError(message.text);
      else setNotice(message.text);
    } catch (cause) {
      setError('导出调整清单失败：' + messageOf(cause));
    }
  };

  const hasCandidate = Boolean(result && result.entries.length > 0);
  if (!hasCandidate) {
    return (
      <EmptyState
        title="还没有可调整的课表"
        message="先运行一次自动排课或载入长时任务的最佳解；调代课会叠加在这张周课表的某一天上。"
      />
    );
  }

  const renderSwapTargets = () => {
    if (!selected) return null;
    return (
      <div className="adjust-swap">
        <label className="adjust-field">
          目标日期
          <input
            type="date"
            value={swapTargetDate}
            min={addDays(date, 1)}
            onChange={(event) => setSwapTargetDate(event.target.value)}
          />
        </label>
        <div className="adjust-swap-head">
          <span>{weekLabelOf(swapTargetDate) || '无效日期'} · 目标日 {swapTargetDate}</span>
          <b>{swapValidCount} 节可对调{swapBlockedCount ? ' · ' + swapBlockedCount + ' 节不可' : ''}</b>
        </div>
        <p className="panel-note adjust-swap-note">
          对调只发生在同一班级；每班使用自己的固定教室，教室随班级走。系统同时检查两天的教师占用和不可用时间。
        </p>
        {swapPlans.length === 0 ? (
          <p className="panel-note">目标日期没有该班课程，换一个日期试试。</p>
        ) : (
          <div className="adjust-swap-list">
            {swapPlans.map(({ entry, plan }) => {
              const teacher = findTeacher(data, entry.teacherId)?.name ?? entry.teacherId;
              const room = findRoom(data, entry.roomId)?.name ?? entry.roomId;
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={'adjust-swap-target is-' + plan.kind}
                  disabled={plan.kind !== 'apply'}
                  title={plan.blockers.map((blocker) => blocker.text).join('；') || '与这节课对调'}
                  onClick={() => createSwap(selected, entry, swapTargetDate)}
                >
                  <span className="adjust-swap-target-time">第{periodOf(entry.slotId)}节</span>
                  <span className="adjust-swap-target-main">
                    <b>{subjectOfEntry(entry)}</b>
                    <small>{teacher} · {room}</small>
                  </span>
                  <em>{plan.kind === 'apply' ? '可对调' : plan.blockers[0]?.text ?? '不可对调'}</em>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderTargetGrid = () => {
    if (!focusBase || !moveMode) return null;
    return (
      <div className="adjust-target-grid" role="group" aria-label="目标节次">
        {daySlots.map((slot) => {
          const plan = targetPlans.get(slot.id);
          if (!plan) return null;
          const label =
            plan.kind === 'apply'
              ? '可调'
              : plan.kind === 'restore'
                ? '还原'
                : plan.kind === 'noop'
                  ? '当前'
                  : '不可调';
          return (
            <button
              key={slot.id}
              type="button"
              className={'adjust-target is-' + plan.kind}
              onClick={() => applyTarget(slot.id)}
              aria-disabled={plan.kind === 'blocked'}
              title={plan.blockers.map((blocker) => blocker.text).join('；') || label}
            >
              <b>第{slot.period}节</b>
              <small>{label}</small>
              {plan.kind === 'blocked' ? <em>{plan.blockers[0]?.text ?? '不可调'}</em> : null}
            </button>
          );
        })}
      </div>
    );
  };

  const renderRow = (slot: TimeSlot) => {
    const cards = cardsBySlot.get(slot.id) ?? [];
    const shadows = shadowsBySlot.get(slot.id) ?? [];
    const plan = moveMode ? targetPlans.get(slot.id) : undefined;
    const planClass = plan ? ' is-' + plan.kind : '';
    const badge =
      plan?.kind === 'apply'
        ? '可调到这里'
        : plan?.kind === 'restore'
          ? '↩ 还原'
          : plan?.kind === 'noop'
            ? '当前位置'
            : plan?.kind === 'blocked'
              ? '不可调'
              : '';
    const reasons = plan?.kind === 'blocked' ? plan.blockers.map((blocker) => blocker.text) : [];
    const time = timeRangeOf(slot);
    const kindLabel = KIND_LABELS[slot.kind ?? 'regular'] ?? '常规';
    return (
      <div
        key={slot.id}
        className={
          'adjust-row' +
          planClass +
          (hoverSlotId === slot.id && dragEntryId ? ' is-hover' : '') +
          (failedSlotId === slot.id ? ' is-failed' : '') +
          (impact?.slotIds.includes(slot.id) ? ' is-impact' : '') +
          (cards.length === 0 && shadows.length === 0 ? ' is-empty' : '')
        }
        role={moveMode ? 'button' : undefined}
        tabIndex={moveMode ? 0 : undefined}
        aria-label={
          moveMode && plan
            ? '第' + slot.period + '节，' + (badge || '') + (reasons.length ? '：' + reasons.join('；') : '')
            : '第' + slot.period + '节'
        }
        onDragOver={(event) => {
          if (!moveMode || !dragEntryId) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = plan && plan.kind !== 'blocked' ? 'move' : 'none';
          if (hoverSlotId !== slot.id) setHoverSlotId(slot.id);
        }}
        onDrop={(event) => {
          if (!moveMode) return;
          event.preventDefault();
          const entryId = event.dataTransfer.getData('text/plain') || dragEntryId;
          const base = entryId ? baseOf(entryId) : focusBase;
          if (!base) return;
          if (selectedEntryId !== base.id) setSelectedEntryId(base.id);
          applyTargetFor(base, slot.id);
          setDragEntryId('');
          setHoverSlotId('');
        }}
        onClick={(event) => {
          if (!moveMode) return;
          if ((event.target as HTMLElement).closest('button')) return;
          applyTarget(slot.id);
        }}
        onKeyDown={(event) => {
          if (!moveMode) return;
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            applyTarget(slot.id);
          }
        }}
      >
        <div className="adjust-slot-meta">
          <b>第{slot.period}节</b>
          {time ? <small>{time}</small> : null}
          {slot.kind && slot.kind !== 'regular' ? <em className={'adjust-kind is-' + slot.kind}>{kindLabel}</em> : null}
        </div>
        <div className="adjust-slot-body">
          {cards.map(({ entry, adjustment }) => {
            const entryPlan = planForEntry(entry);
            const teacherId = entry.teacherId;
            const roomId = entry.roomId;
            const base = baseOf(entry.id);
            const originalSlot = base ? slotById.get(base.slotId) : undefined;
            const canDrag = !adjustment || adjustment.type === 'move';
            return (
              <button
                key={entry.id}
                type="button"
                className={
                  'tt-card adjust-card' +
                  (entry.id === selectedEntryId ? ' is-selected' : '') +
                  (adjustment ? ' is-adjusted' : '') +
                  (adjustment?.type === 'substitute' ? ' is-substituted' : '')
                }
                draggable={canDrag}
                aria-pressed={entry.id === selectedEntryId}
                onClick={(event) => {
                  event.stopPropagation();
                  selectEntry(entry.id);
                }}
                onDragStart={(event) => {
                  if (!canDrag) {
                    event.preventDefault();
                    return;
                  }
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', entry.id);
                  if (selectedEntryId !== entry.id) selectEntry(entry.id);
                  else if (draftType !== 'move') setDraftType('move');
                  setDragEntryId(entry.id);
                  setStatus(null);
                }}
                onDragEnd={() => {
                  setDragEntryId('');
                  setHoverSlotId('');
                }}
                title={
                  adjustment && adjustment.type !== 'move'
                    ? '已有' + ADJUSTMENT_LABELS[adjustment.type] + '记录，先撤销后再调课'
                    : '点击查看，或拖动到其它节次'
                }
              >
                <span className="tt-card-top">
                  <span className="tt-card-subject">{subjectOfEntry(entry)}</span>
                  {adjustment ? <span className="tt-card-lock">{ADJUSTMENT_LABELS[adjustment.type]}</span> : null}
                </span>
                <span className="tt-card-meta">
                  {findTeacher(data, teacherId)?.name ?? teacherId} · {findRoom(data, roomId)?.name ?? roomId}
                </span>
                <span className="tt-card-badges">
                  {adjustment?.type === 'swap' ? (
                    <em>
                      对调 · 来自 {swapOriginDate(adjustment, entry.id)} 第
                      {periodOf(swapOriginSlot(adjustment, entry.id))}节
                    </em>
                  ) : null}
                  {adjustment?.type === 'move' && originalSlot && adjustment.targetSlotId !== adjustment.slotId ? (
                    <em>原第{originalSlot.period}节</em>
                  ) : null}
                  {adjustment?.type === 'substitute' ? <em>代 原任课</em> : null}
                  {adjustment && isNoopMove(adjustment) ? <em>原位置记录</em> : null}
                </span>
              </button>
            );
          })}
          {shadows.map((shadow) => {
            const shadowRestorePlan = shadow.kind === 'moved' ? restorePlanFor(shadow.adjustment) : null;
            const shadowRestoreBlocked = shadowRestorePlan?.kind === 'blocked';
            return (
              <div
                key={shadow.adjustment.id}
                className={'adjust-shadow is-' + shadow.kind + (shadowRestoreBlocked ? ' is-blocked-restore' : '')}
                title={shadowRestoreBlocked ? shadowRestorePlan?.blockers.map((blocker) => blocker.text).join('；') : undefined}
              >
                <span>
                  {subjectOfEntry(shadow.entry)} ·{' '}
                  {shadow.kind === 'moved'
                    ? shadow.adjustment.type === 'swap'
                      ? (() => {
                          const otherDate = swapOtherDate(shadow.adjustment, shadow.entry.id);
                          const otherSlot = swapOtherSlot(shadow.adjustment, shadow.entry.id);
                          return '已与 ' + (otherDate ?? '目标日') + ' 第' + periodOf(otherSlot) + '节 对调';
                        })()
                      : '已调至第' + periodOf(shadow.adjustment.targetSlotId) + '节'
                    : '已停课'}
                  {shadowRestoreBlocked ? ' · 原位置被占用' : ''}
                </span>
                <span className="adjust-shadow-actions">
                  {shadow.kind === 'moved' && shadow.adjustment.type === 'swap' ? (
                    <button
                      type="button"
                      className="adjust-shadow-action"
                      onClick={(event) => {
                        event.stopPropagation();
                        revokeAdjustment(shadow.adjustment);
                      }}
                    >
                      撤销对调
                    </button>
                  ) : null}
                  {shadow.kind === 'moved' && shadow.adjustment.type === 'move' && !shadowRestoreBlocked ? (
                    <button
                      type="button"
                      className="adjust-shadow-action"
                      onClick={(event) => {
                        event.stopPropagation();
                        requestRestore(shadow.adjustment);
                      }}
                    >
                      还原
                    </button>
                  ) : null}
                  {shadow.kind === 'cancelled' ? (
                    <button
                      type="button"
                      className="adjust-shadow-action"
                      onClick={(event) => {
                        event.stopPropagation();
                        revokeAdjustment(shadow.adjustment);
                      }}
                    >
                      撤销停课
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="adjust-shadow-action is-quiet"
                    onClick={(event) => {
                      event.stopPropagation();
                      selectEntry(shadow.entry.id);
                    }}
                  >
                    查看
                  </button>
                </span>
              </div>
            );
          })}
          {cards.length === 0 && shadows.length === 0 ? (
            plan ? (
              <span
                className={
                  'adjust-empty' +
                  (plan.kind === 'apply' ? ' is-valid' : '') +
                  (plan.kind === 'blocked' ? ' is-blocked' : '') +
                  (plan.kind === 'noop' ? ' is-current' : '')
                }
              >
                {plan.kind === 'apply'
                  ? '+ 调到第' + slot.period + '节'
                  : plan.kind === 'blocked'
                    ? '不可调'
                    : plan.kind === 'noop'
                      ? '当前位置'
                      : ''}
              </span>
            ) : (
              <span className="adjust-empty">空</span>
            )
          ) : null}
          {reasons.length > 0 ? (
            <span className="adjust-reason">
              {reasons.slice(0, 2).join('；')}
              {reasons.length > 2 ? ' 等 ' + reasons.length + ' 项' : ''}
            </span>
          ) : null}
          {plan?.kind === 'restore' && cards.length === 0 ? (
            <span className="adjust-reason is-restore">松手或点击即可还原到原时间</span>
          ) : null}
          {plan?.kind === 'noop' && cards.length === 0 ? (
            <span className="adjust-reason is-current">当前位置，不会产生调整</span>
          ) : null}
        </div>
        {badge ? <span className={'adjust-row-badge is-' + (plan?.kind ?? '')}>{badge}</span> : null}
      </div>
    );
  };

  const selectedCurrentSlot = selected ? slotById.get(selectedCurrentSlotId) : undefined;
  const selectedTeacher = findTeacher(data, selectedTeacherId);
  const selectedRoom = findRoom(data, selectedRoomId);
  const availableCandidates = candidates.filter((item) => !item.unavailable).length;
  const currentStep: number = impact ? 4 : selected ? 3 : 1;

  return (
    <div className="adjust-layout">
      <nav className="adjust-stepper" aria-label="调代课步骤">
        {[
          ['01', '选择日期/班级', currentStep === 1],
          ['02', '选择课程', currentStep === 2],
          ['03', '预览动作', currentStep === 3],
          ['04', '保存/撤销', currentStep === 4],
        ].map(([number, label, active]) => (
          <div key={String(number)} className={'adjust-step' + (active ? ' is-active' : '')}>
            <span>{number}</span><b>{label}</b>
          </div>
        ))}
      </nav>
      <p className="adjust-lead">
        调整只作用于所选日期，不改动周课表。调课用于同一天的空节次，也可以直接拖动课程卡片；对调用于与另一天的同班课程互换，每班固定教室随班级走，系统只检查两天的班级和教师占用。绿色可放，红色会说明原因。
      </p>

      <div className="tt-command adjust-command">
        <div className="adjust-date-nav">
          <button type="button" className="tt-btn tt-btn-quiet" onClick={() => shiftDate(-1)} title="前一天">◀</button>
          <input
            className="tt-date"
            type="date"
            value={date}
            aria-label="调整日期"
            onChange={(event) => changeDate(event.target.value)}
          />
          <button type="button" className="tt-btn tt-btn-quiet" onClick={() => shiftDate(1)} title="后一天">▶</button>
          <button type="button" className="tt-btn tt-btn-quiet" onClick={() => changeDate(todayLocal())}>今天</button>
        </div>
        <div className="adjust-scope-tabs" role="tablist" aria-label="调课视角">
          <button type="button" role="tab" aria-selected={scope === 'class'} className={scope === 'class' ? 'active' : ''} onClick={() => setScope('class')}>按班级</button>
          <button type="button" role="tab" aria-selected={scope === 'teacher'} className={scope === 'teacher' ? 'active' : ''} onClick={() => setScope('teacher')}>按教师</button>
        </div>
        {scope === 'class' ? (
          <label className="tt-entity">
            <span>班级</span>
            <select value={classId} onChange={(event) => changeClass(event.target.value)}>
              {classGroups.map(([grade, classes]) => (
                <optgroup key={grade || 'none'} label={grade ? GRADE_NAMES[grade] ?? grade + '年级' : '未分年级'}>
                  {classes.map((klass) => (
                    <option key={klass.id} value={klass.id}>
                      {klass.name}
                      {classCounts.get(klass.id) ? ' · ' + classCounts.get(klass.id) + ' 条' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        ) : (
          <label className="tt-entity">
            <span>请假教师</span>
            <select value={teacherId} onChange={(event) => { setTeacherId(event.target.value); clearSelection(); }}>
              {data.teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>{teacher.name} · 当天 {teacherLessonCounts.get(teacher.id) ?? 0} 节</option>
              ))}
            </select>
          </label>
        )}
        <label className="tt-entity adjust-operator">
          <span>操作人</span>
          <input value={operator} onChange={(event) => persistOperator(event.target.value)} placeholder="记录到审计日志" />
        </label>
        <div className="tt-command-spacer" />
        <span className="adjust-stats-scope">当天</span>
        <div className="tt-stats" aria-label="当天全部班级的调整统计">
          <span><b>{summary.move}</b><em>调课</em></span>
          <span><b>{summary.swap}</b><em>对调</em></span>
          <span><b>{summary.substitute}</b><em>代课</em></span>
          <span><b>{summary.cancel}</b><em>停课</em></span>
          <span><b>{summary.revoked}</b><em>已撤销</em></span>
          {summary.noop ? <span><b className="is-warn">{summary.noop}</b><em>原位置</em></span> : null}
        </div>
        <div className="tt-command-actions">
          <button type="button" className="tt-btn tt-btn-quiet" onClick={revokeDayAdjustments} disabled={effectiveDayAdjustments.length === 0}>
            撤销当天调整
          </button>
          <button type="button" className="tt-btn tt-btn-quiet" onClick={() => void exportDay()} disabled={dayAdjustments.length === 0}>
            导出当天调整
          </button>
          <button type="button" className="tt-btn tt-btn-quiet" onClick={() => void exportNotice()} disabled={effectiveDayAdjustments.length === 0}>
            导出代课通知单
          </button>
        </div>
      </div>

      {noopRecords.length > 0 ? (
        <div className="tt-warning adjust-noop-warning">
          <b>发现 {noopRecords.length} 条原位置调课记录</b>
          <span>它们的目标时间与原来相同，不会改变课表，也不计入调课统计。</span>
          <button type="button" className="tt-btn tt-btn-quiet" onClick={cleanupNoops}>清理</button>
        </div>
      ) : null}

      {scope === 'teacher' ? (
        <section className="section-panel adjust-teacher-worklist" aria-label="教师当天课程">
          <div className="panel-head">
            <div>
              <SectionHeading english="TEACHER DAY" title={(findTeacher(data, teacherId)?.name ?? '未选择教师') + ' 的当天课程'} />
              <p className="panel-note">直接列出该教师当天所有班级的课程；点击任意课程后可进入原有调课、代课或停课流程。</p>
            </div>
            <span className="status-tag">{teacherEntries.length} 节</span>
          </div>
          {teacherEntries.length > 0 ? (
            <div className="adjust-teacher-entries">
              {teacherEntries.map((entry) => {
                const slot = slotById.get(entry.slotId);
                const adjustment = activeOf(entry.id);
                return (
                  <button type="button" key={entry.id} className={'adjust-teacher-entry' + (entry.id === selectedEntryId ? ' is-selected' : '')} onClick={() => selectTeacherEntry(entry)}>
                    <span className="adjust-teacher-entry-time">{slot?.label ?? slotLabelOf(entry.slotId)}</span>
                    <span className="adjust-teacher-entry-main"><b>{findClass(data, entry.classId)?.name ?? entry.classId}</b><small>{subjectOfEntry(entry)} · {findRoom(data, entry.roomId)?.name ?? entry.roomId}</small></span>
                    {adjustment ? <em>{ADJUSTMENT_LABELS[adjustment.type]}</em> : null}
                  </button>
                );
              })}
            </div>
          ) : <p className="panel-note">该教师当天没有已排课程。</p>}
        </section>
      ) : null}

      <div className={'tt-selection adjust-selection' + (focusBase ? ' has-selection' : '')} aria-live="polite">
        {focusBase ? (
          <>
            <div className="tt-selection-copy">
              <span className="tt-selection-kicker">{dragEntryId ? 'DRAGGING LESSON' : 'SELECTED LESSON'}</span>
              <strong>{subjectOfEntry(focusBase)}</strong>
              <span>
                {classNameText} · {findTeacher(data, focusBase.teacherId)?.name ?? focusBase.teacherId} ·{' '}
                {slotLabelOf(focusBase.slotId)}
                {focusAdjustment ? ' · 已有' + ADJUSTMENT_LABELS[focusAdjustment.type] : ''}
              </span>
            </div>
            <div className="tt-selection-actions">
              {draftType === 'move' ? (
                <span className={'tt-move-hint' + (targetCounts.blocked === 0 ? '' : ' is-muted')}>
                  可调 {targetCounts.valid} 处
                  {targetCounts.restore ? ' · 还原 ' + targetCounts.restore + ' 处' : ''}
                  {targetCounts.blocked ? ' · 不可调 ' + targetCounts.blocked + ' 处' : ''}
                </span>
              ) : (
                <span className="tt-move-hint is-muted">当前为{ADJUSTMENT_LABELS[draftType]}模式</span>
              )}
              {focusNoop ? <span className="tt-move-hint is-muted">原位置记录，无变化</span> : null}
              {focusAdjustment?.type === 'move' && !focusNoop ? (
                <button
                  type="button"
                  className="tt-btn tt-btn-quiet"
                  disabled={focusRestorePlan?.kind === 'blocked'}
                  title={focusRestorePlan?.kind === 'blocked' ? focusRestorePlan.blockers.map((blocker) => blocker.text).join('；') : undefined}
                  onClick={() => requestRestore(focusAdjustment)}
                >
                  还原到原时间
                </button>
              ) : null}
              {!focusNoop && focusRestorePlan?.kind === 'blocked' ? (
                <span className="tt-move-hint is-muted" title={focusRestorePlan.blockers.map((blocker) => blocker.text).join('；')}>
                  原位置已被占用
                </span>
              ) : null}
              <button type="button" className="tt-btn tt-btn-quiet" onClick={clearSelection}>取消选择</button>
            </div>
          </>
        ) : (
          <span className="tt-selection-empty">
            点击左侧课程查看可调目标；调课只换同一天的空节次，对调则与另一天的同班课程互换。选中后点击目标节次或拖动课程放置。
          </span>
        )}
      </div>

      {status ? (
        <div
          className={'adjust-status is-' + status.tone}
          role={status.tone === 'error' ? 'alert' : 'status'}
          aria-live={status.tone === 'error' ? 'assertive' : 'polite'}
        >
          <span className="adjust-status-icon" aria-hidden="true">
            {status.tone === 'error' ? '!' : status.tone === 'success' ? '✓' : 'i'}
          </span>
          <span className="adjust-status-text">{status.text}</span>
          {status.undo ? <button type="button" className="tt-btn tt-btn-quiet" onClick={status.undo}>撤销</button> : null}
          <button type="button" className="adjust-status-close" aria-label="关闭提示" onClick={() => setStatus(null)}>×</button>
        </div>
      ) : null}

      {impact ? (
        <section className="adjust-impact" aria-label="本次调整影响范围">
          <div className="adjust-impact-head">
            <div>
              <span className="kicker">// IMPACT</span>
              <b>影响范围</b>
            </div>
            <span>{ADJUSTMENT_LABELS[impact.type]} · {impactClassName} · {impact.date}</span>
          </div>
          <div className="adjust-impact-chips">
            <span>教师：{impactTeacherNames || '—'}</span>
            <span>节次：{impactSlotLabels || '—'}</span>
            <span>变化：{impact.changes.length} 处</span>
          </div>
          <div className="adjust-impact-actions">
            <button type="button" className="tt-btn tt-btn-quiet" onClick={() => setImpactOpen(true)}>查看影响课表</button>
            {onQuickExport ? (
              <button type="button" className="tt-btn tt-btn-quiet" onClick={() => onQuickExport('class', impact.classId, impactWeekNo)}>导出班级课表</button>
            ) : null}
            {onQuickExport && impact.teacherIds[0] ? (
              <button type="button" className="tt-btn tt-btn-quiet" onClick={() => onQuickExport('teacher', impact.teacherIds[0], impactWeekNo)}>导出教师课表</button>
            ) : null}
          </div>
        </section>
      ) : null}

      {impactOpen && impact ? (
        <div className="impact-overlay" role="dialog" aria-modal="true" aria-label="影响课表">
          <div className="impact-dialog">
            <div className="impact-dialog-head">
              <div>
                <span className="kicker">// IMPACT TIMETABLE</span>
                <h3>影响范围</h3>
              </div>
              <button type="button" className="tt-btn tt-btn-quiet" onClick={() => setImpactOpen(false)}>关闭</button>
            </div>
            <div className="impact-columns">
              <section>
                <h4>班级 · {impactClassName}</h4>
                {renderImpactRows(impact.classBefore, impact.classAfter, 'class')}
              </section>
              <section>
                <h4>教师 · {impactTeacherNames || '—'}</h4>
                {renderImpactRows(impact.teacherBefore, impact.teacherAfter, 'teacher')}
              </section>
            </div>
            <div className="impact-actions">
              {onQuickExport ? (
                <button type="button" className="tt-btn tt-btn-primary" onClick={() => onQuickExport('class', impact.classId, impactWeekNo)}>导出班级课表</button>
              ) : null}
              {onQuickExport && impact.teacherIds[0] ? (
                <button type="button" className="tt-btn tt-btn-quiet" onClick={() => onQuickExport('teacher', impact.teacherIds[0], impactWeekNo)}>导出教师课表</button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="adjust-workspace">
        <section className="tt-board adjust-board" ref={boardRef} aria-label="班级日课表">
          <div className="adjust-board-head">
            <div>
              <span className="adjust-board-class">{classNameText}</span>
              <small>
                {date} · {weekday ? DAYS[weekday] : '无效日期'} · {daySlots.length} 个节次 · {classEffective.length} 节课
              </small>
            </div>
            <div className="adjust-board-legend" aria-label="状态图例">
              <span className="adjust-legend is-apply">可调</span>
              <span className="adjust-legend is-blocked">不可调</span>
              <span className="adjust-legend is-noop">当前位置</span>
              <span className="adjust-legend is-restore">还原</span>
            </div>
          </div>
          <div className="adjust-board-scroll">
            {daySlots.length === 0 ? (
              <p className="panel-note adjust-board-empty">这一天没有时间段，请先在基础资料里添加。</p>
            ) : (
              <div className="adjust-rows">
                {daySlots.map((slot) => renderRow(slot))}
              </div>
            )}
          </div>
        </section>

        <aside className="section-panel adjust-inspector">
          <div className="panel-head">
            <SectionHeading english="ADJUSTMENT INSPECTOR" title="调整这节课" />
            {selected ? <button type="button" className="ghost-button adjust-inspector-close" onClick={clearSelection}>取消</button> : null}
          </div>
          {!selected ? (
            <div className="adjust-guide">
              <p><b>1</b> 选择日期和班级</p>
              <p><b>2</b> 点击课程卡片</p>
              <p><b>3</b> 调课点目标节次；对调选目标日期和课程</p>
              <p className="panel-note">目标节次会直接显示可调/不可调及原因；对调只允许不同星期的同班课程，当前位置不会产生调整记录。</p>
            </div>
          ) : (
            <>
              <div className="adjust-selected">
                <span className="kicker">SELECTED LESSON</span>
                <b>{subjectOfEntry(selected)}</b>
                <small>
                  {classNameText} · {selectedTeacher?.name ?? selectedTeacherId} · {selectedCurrentSlot?.label ?? slotLabelOf(selected.slotId)} · {selectedRoom?.name ?? selectedRoomId}
                </small>
                {selectedAdjustment ? (
                  <em className={'adjust-selected-flag is-' + selectedAdjustment.type}>
                    {ADJUSTMENT_LABELS[selectedAdjustment.type]}
                  </em>
                ) : null}
              </div>

              {selectedAdjustment ? (
                <div className="adjust-existing">
                  <div className="adjust-existing-head">
                    <span className={'adjust-type is-' + selectedAdjustment.type}>{ADJUSTMENT_LABELS[selectedAdjustment.type]}</span>
                    <b>{describeAdjustment(selectedAdjustment, data)}</b>
                  </div>
                  {selectedAdjustment.reason ? <small>原因：{selectedAdjustment.reason}</small> : null}
                  {selectedAdjustment.updatedAt ? <small>改于 {timeText(selectedAdjustment.updatedAt)}</small> : null}
                  {selectedAdjustment.type === 'move' ? (
                    <>
                      <p className="panel-note">
                        {selectedNoop
                          ? '这条记录的目标时间与原来相同，不计入调课；点击目标节次会把它改造成有效调课。'
                          : '点击新的目标节次可以改期；点击原节次会直接还原，不会新增调课记录。'}
                      </p>
                      {renderTargetGrid()}
                      {selectedNoop ? (
                        <button type="button" className="ghost-button adjust-wide-button" onClick={() => revokeAdjustment(selectedAdjustment)}>
                          清理这条记录
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="ghost-button adjust-wide-button"
                            disabled={selectedRestorePlan?.kind === 'blocked'}
                            title={selectedRestorePlan?.kind === 'blocked' ? selectedRestorePlan.blockers.map((blocker) => blocker.text).join('；') : undefined}
                            onClick={() => requestRestore(selectedAdjustment)}
                          >
                            还原到原时间
                          </button>
                          {selectedRestorePlan?.kind === 'blocked' ? (
                            <p className="panel-note">
                              原位置已被占用：{selectedRestorePlan.blockers.map((blocker) => blocker.text).join('；')}。请先处理占用该节次的调整。
                            </p>
                          ) : null}
                        </>
                      )}
                    </>
                  ) : selectedAdjustment.type === 'swap' ? (
                    <>
                      <p className="panel-note">
                        已与{' '}
                        {swapOtherDate(selectedAdjustment, selected.id) ?? '目标日期'}{' '}
                        {slotLabelOf(swapOtherSlot(selectedAdjustment, selected.id))}{' '}
                        对调；两节课互换日期和时间。
                      </p>
                      <button type="button" className="ghost-button adjust-wide-button" onClick={() => revokeAdjustment(selectedAdjustment)}>
                        撤销对调
                      </button>
                    </>
                  ) : (
                    <button type="button" className="ghost-button adjust-wide-button" onClick={() => revokeAdjustment(selectedAdjustment)}>
                      {selectedAdjustment.type === 'substitute' ? '撤销代课' : '撤销停课'}
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="adjust-types" role="tablist" aria-label="调整类型">
                    {TYPES.map((value) => (
                      <button
                        key={value}
                        type="button"
                        role="tab"
                        aria-selected={draftType === value}
                        className={draftType === value ? 'active' : ''}
                        onClick={() => {
                          setDraftType(value);
                          setSubstituteTeacherId('');
                          setFailedSlotId('');
                          setHoverSlotId('');
                        }}
                      >
                        {ADJUSTMENT_LABELS[value]}
                      </button>
                    ))}
                  </div>

                  {draftType === 'move' ? (
                    <>
                      <label className="adjust-field">
                        原因（可选，先填写再点目标节次）
                        <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="如：教师出差、临时会议" />
                      </label>
                      <p className="panel-note">点击目标节次立即生效；也可以直接拖动左侧课程卡片。绿色可放，红色会说明原因。</p>
                      {renderTargetGrid()}
                    </>
                  ) : null}

                  {draftType === 'swap' ? (
                    <>
                      <label className="adjust-field">
                        原因（可选）
                        <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="如：教师出差、课程进度调整" />
                      </label>
                      <p className="panel-note">所选日期的这节课与目标日期的同班课程对调；两节课互换日期和时间。</p>
                      {renderSwapTargets()}
                    </>
                  ) : null}

                  {draftType === 'substitute' ? (
                    <>
                      <label className="adjust-field">
                        代课教师
                        <select className="adjust-teacher-select" value={substituteTeacherId} onChange={(event) => setSubstituteTeacherId(event.target.value)}>
                          <option value="">选择代课教师</option>
                          {candidates.map((item) => (
                            <option key={item.id} value={item.id} disabled={item.unavailable}>
                              {item.name}（{item.unavailable ? item.reason : [item.sameSubject ? '同学科' : '', '当天 ' + item.load + ' 节'].filter(Boolean).join(' · ') || '空闲'}）
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="panel-note">
                        空闲 {availableCandidates} 人；不可用的教师会显示具体原因。
                      </p>
                      <label className="adjust-field">
                        原因
                        <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="如：教师出差、临时会议（可留空）" />
                      </label>
                      {substituteCheck && !substituteCheck.ok ? (
                        <ul className="adjust-errors">
                          {substituteCheck.errors.map((error) => <li key={error}>{error}</li>)}
                        </ul>
                      ) : substituteCheck?.ok ? (
                        <p className="panel-note success-note">校验通过，可以保存。</p>
                      ) : null}
                      <div className="adjust-actions">
                        <button type="button" className="action-button" onClick={saveSubstitute} disabled={!substituteCheck?.ok}>
                          保存代课 <span>→</span>
                        </button>
                      </div>
                    </>
                  ) : null}

                  {draftType === 'cancel' ? (
                    <>
                      <p className="panel-note">停课后这节课程当天不再出现在课表里，周课表不受影响；可在课表上撤销。</p>
                      <label className="adjust-field">
                        原因
                        <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="如：学校活动、临时停课（可留空）" />
                      </label>
                      {cancelCheck && !cancelCheck.ok ? (
                        <ul className="adjust-errors">
                          {cancelCheck.errors.map((error) => <li key={error}>{error}</li>)}
                        </ul>
                      ) : cancelCheck?.ok ? (
                        <p className="panel-note success-note">校验通过，可以保存。</p>
                      ) : null}
                      <div className="adjust-actions">
                        <button type="button" className="action-button" onClick={saveCancel} disabled={!cancelCheck?.ok}>
                          确认停课 <span>→</span>
                        </button>
                      </div>
                    </>
                  ) : null}
                </>
              )}
            </>
          )}
        </aside>
      </div>

      <section className="section-panel adjust-history">
        <div className="panel-head">
          <div>
            <SectionHeading english="HISTORY" title="当天调整记录" />
            <p className="panel-note">撤销保留历史，审计日志里可以查到操作人和前后值。</p>
          </div>
          <span className={'status-tag ' + (dayAdjustments.length ? '' : 'muted')}>
            {dayAdjustments.length ? dayAdjustments.length + ' 条记录' : '当天无调整'}
          </span>
        </div>
        {dayAdjustments.length === 0 ? (
          <p className="panel-note">这一天还没有调整记录。</p>
        ) : (
          <ul className="adjust-history-list">
            {sortedHistory.map((item) => {
              const orphaned = !baseOf(item.originalEntryId);
              const noop = item.status === 'active' && isNoopMove(item);
              const historyRestorePlan =
                item.status === 'active' && item.type === 'move' && !noop ? restorePlanFor(item) : null;
              const historyRestoreBlocked = historyRestorePlan?.kind === 'blocked';
              return (
                <li
                  key={item.id}
                  className={
                    'adjust-history-row is-' +
                    item.status +
                    (orphaned ? ' is-orphaned' : '') +
                    (noop ? ' is-noop' : '')
                  }
                >
                  <span className={'adjust-type is-' + item.type}>{ADJUSTMENT_LABELS[item.type]}</span>
                  <div className="adjust-history-copy">
                    <b>
                      {describeAdjustment(item, data)}
                      {noop ? ' · 原位置（无变化）' : ''}
                    </b>
                    <small>
                      {item.reason ? item.reason + ' · ' : ''}
                      {item.createdBy ?? '未记录操作人'} · {timeText(item.createdAt)}
                      {item.updatedAt ? ' · 改于 ' + timeText(item.updatedAt) : ''}
                      {orphaned ? ' · 课表已重排，原课次不存在' : ''}
                      {historyRestoreBlocked ? ' · 原位置已被占用，暂不能还原' : ''}
                      {item.status === 'revoked'
                        ? ' · ' +
                          (item.type === 'move' ? (isNoopMove(item) ? '已清理 ' : '已还原 ') : '已撤销 ') +
                          timeText(item.revokedAt) +
                          (item.revokedBy ? '（' + item.revokedBy + '）' : '')
                        : ''}
                    </small>
                  </div>
                  <div className="adjust-history-actions">
                    <button type="button" className="ghost-button adjust-history-locate" onClick={() => locate(item)}>定位</button>
                    {item.status === 'active' ? (
                      historyRestoreBlocked ? (
                        <span
                          className="status-tag danger"
                          title={historyRestorePlan?.blockers.map((blocker) => blocker.text).join('；')}
                        >
                          原位置被占用
                        </span>
                      ) : (
                        <button type="button" className="ghost-button adjust-history-revoke" onClick={() => revokeAdjustment(item)}>
                          {noop ? '清理' : item.type === 'move' ? '还原' : '撤销'}
                        </button>
                      )
                    ) : (
                      <span className="status-tag muted">
                        {item.type === 'move' ? (isNoopMove(item) ? '已清理' : '已还原') : '已撤销'}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <LessonLogPanel
        data={data}
        commit={commit}
        date={date}
        operator={operator}
        setError={setError}
        setNotice={setNotice}
      />
    </div>
  );
}
