import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HeroUIProvider, Button, Card, CardBody, Chip, Progress, Select, SelectItem, Tabs, Tab } from '@heroui/react';
import { validateInput } from '../../../packages/validation/src';
import { buildImportTemplate, exportCsv, exportWorkbook, readWorkbook } from '../../../packages/import-export/src';
import { ApiError, cancelServerJob, deleteServerClient, fetchServerOverview, loadData, saveData, solveSchedule, updateServerConfig } from './api';
import { DAYS, SectionHeading } from './components';
import { PreparePage } from './PreparePage';
import type { PrepareSection } from './PreparePage';
import { download, exportMessage } from './download';
import type { ExportResult } from './download';
import { TimetableExportDialog } from './TimetableExportDialog';
import { timetableFileName } from './timetableExport';
import { loadTimetableTemplate } from './timetableTemplateLoader';
import { fillSemesterTemplate, fillTimetableTemplate } from './timetableTemplate';
import type { TimetableExportSettings } from './timetableExport';
import { checkMove, checkSwap } from './dnd';
import { semesterWeeks, weekOfDate } from '../../../packages/semester/src';
import { adjustedWeekEntries, semesterPatterns } from './semesterTimetable';
import { messageOf, todayLocal, uid } from './utils';
import { activeRules, describeRule, matchedPlans, unscheduledHints } from './rules';
import { RUN_MODE_OPTIONS } from './runConfig';
import type { RunProgress } from './runConfig';
import { EmptyState, RunProgressView } from './runViews';
import { findClass, findRoom, findSubject, findTeacher, missingPlans, planOf, planSubjectName } from './selectors';
import { RunsPage } from './RunsPage';
import { InspectionPage } from './InspectionPage';
import { KIND_LABELS, inspectTimetable, reportRows, weekMask, weeksOverlap } from '../../../packages/inspection/src';
import type { InspectionRefs, InspectionReport } from '../../../packages/inspection/src';
import { StatsPage } from './StatsPage';
import { AdjustmentsPage } from './AdjustmentsPage';
import { TodayPanel } from './TodayPanel';
import { buildStats, classRowsForExport, subjectRowsForExport, teacherRowsForExport } from '../../../packages/statistics/src';
import type { StatsReport } from '../../../packages/statistics/src';
import { ADJUSTMENT_LABELS, LESSON_STATUS_LABELS, activeAdjustments, buildActualStats, effectiveEntries, weekdayOf } from '../../../packages/adjustments/src';
import type { ActualStats } from '../../../packages/adjustments/src';
import type { ServerClient, ServerConfig, ServerConfigResult, ServerEffective, ServerJob, ServerLog, ServerStats } from './api';
import type { LongJobDetail } from './api';
import type {
  ClassRoom,
  CoursePlan,
  Room,
  RuleInstance,
  ScheduleEntry,
  SchoolData,
  Commit,
  SolverInput,
  SolverOutput,
  Subject,
  Teacher,
  TimeSlot,
  RunMode,
} from './types';
import './style.css';

const TABS = ['工作台', '排课准备', '排课任务', '课表预览', '调代课', '最终课表', '统计报表', '报表发布', '服务端', '设置'] as const;
type Tab = (typeof TABS)[number];
const EN: Record<Tab, string> = {
  工作台: 'OVERVIEW',
  排课准备: 'PREPARE',
  排课任务: 'SCHEDULE RUNS',
  课表预览: 'TIMETABLE PREVIEW',
  调代课: 'ADJUSTMENTS',
  最终课表: 'FINAL TIMETABLE',
  统计报表: 'WORKLOAD',
  报表发布: 'RELEASE',
  服务端: 'SERVER',
  设置: 'SETTINGS',
};
type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error';
type View = 'class' | 'teacher' | 'room';




function RuntimeModeDialog({ current, onSave, onClose }: { current: RunMode | null; onSave: (mode: RunMode, endpoint: string) => void; onClose?: () => void }) {
  const [mode, setMode] = useState<RunMode>(current ?? 'single');
  const selected = RUN_MODE_OPTIONS.find((item) => item.value === mode)!;
  const [endpoint, setEndpoint] = useState(() => window.localStorage.getItem('warpweft-runtime-endpoint') || selected.endpoint);
  const endpointValid = (() => { try { const url = new URL(endpoint); return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.host); } catch { return false; } })();
  useEffect(() => { setEndpoint(window.localStorage.getItem('warpweft-runtime-endpoint') || selected.endpoint); }, [mode]);
  return <div className="mode-overlay" role="dialog" aria-modal="true"><div className="mode-dialog"><div className="mode-dialog-head"><span className="kicker">// RUNTIME MODE</span>{onClose ? <button className="banner-close" onClick={onClose} aria-label="关闭设置">×</button> : null}</div><h2>{current ? '运行模式设置' : '选择运行模式'}</h2><p className="mode-lead">先选择数据和排课服务的运行位置，之后可以在设置中修改。</p><div className="mode-options">{RUN_MODE_OPTIONS.map((item) => <button key={item.value} className={'mode-option' + (mode === item.value ? ' selected' : '')} onClick={() => setMode(item.value)}><span className="mode-option-index">0{RUN_MODE_OPTIONS.indexOf(item) + 1}</span><span><b>{item.title}</b><em>{item.english}</em><small>{item.description}</small></span></button>)}</div><label className="mode-endpoint">服务地址<input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="http://192.168.1.20:4317" /><small>{mode === 'single' || mode === 'lan-server' ? '本机模式使用默认地址即可。' : '请输入可访问的服务端 API 地址。'}{endpoint && !endpointValid ? ' 地址格式无效。' : ''}</small></label><div className="mode-actions"><button className="ghost-button" onClick={onClose} disabled={!current}>取消</button><button className="action-button" disabled={!endpointValid} onClick={() => onSave(mode, endpoint)}>{current ? '保存设置' : '进入工作台'} <span>↗</span></button></div></div></div>;
}



function fmtTime(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}


function toSolverInput(
  data: SchoolData,
  timeLimit: number,
  locked: ScheduleEntry[],
): SolverInput {
  return {
    protocolVersion: '1.0',
    dataSnapshotVersion: 'local-' + Date.now(),
    timeSlots: data.timeSlots,
    classes: data.classes.map((item) => ({ id: item.id, name: item.name, size: item.size })),
    teachers: data.teachers,
    subjects: data.subjects,
    rooms: data.rooms,
    coursePlans: data.coursePlans,
    unavailableSlots: data.unavailableSlots ?? [],
    lockedEntries: locked,
    electiveGroups: data.electiveGroups ?? [],
    hardConstraints: ['NO_CLASS_CONFLICT', 'NO_TEACHER_CONFLICT', 'ROOM_CAPACITY'],
    rules: data.rules ?? [],
    softConstraints: data.softConstraints ?? [
      { kind: 'SUBJECT_DISTRIBUTION', weight: 3 },
      { kind: 'TEACHER_CONTINUOUS', weight: 2 },
      { kind: 'TEACHER_GAPS', weight: 1 },
      { kind: 'TEACHER_WORKLOAD_BALANCE', weight: 2 },
    ],
    timeLimitSeconds: timeLimit,
    randomSeed: 1,
  };
}

function preflight(data: SchoolData): string[] {
  const issues = validateInput(toSolverInput(data, 30, [])).map((issue) => issue.message);
  if (data.classes.length === 0) issues.push('至少需要一个班级');
  if (data.teachers.length === 0) issues.push('至少需要一位教师');
  if (data.rooms.length === 0) issues.push('至少需要一间教室');
  if (data.timeSlots.length === 0) issues.push('至少需要一个时间段');
  if (data.coursePlans.length === 0) issues.push('至少需要一条教学计划');
  if (data.subjects.length === 0) issues.push('至少需要一个学科');

  const slotCount = data.timeSlots.length;
  // A plan that runs every week occupies both parities; odd/even plans only one.
  const loadInWeek = (plans: CoursePlan[], parity: 'odd' | 'even') =>
    plans.reduce((sum, plan) => {
      const weeks = plan.weeks ?? 'all';
      if (weeks !== 'all' && weeks !== parity) return sum;
      return sum + Number(plan.weeklyPeriods || 0);
    }, 0);
  for (const item of data.classes) {
    const plans = data.coursePlans.filter((plan) => plan.classId === item.id);
    const load = Math.max(loadInWeek(plans, 'odd'), loadInWeek(plans, 'even'));
    if (load > slotCount) {
      issues.push(item.name + ' 的周课时 ' + load + ' 超过可用时间格 ' + slotCount);
    }
  }
  for (const item of data.teachers) {
    const plans = data.coursePlans.filter((plan) => plan.teacherId === item.id);
    const load = Math.max(loadInWeek(plans, 'odd'), loadInWeek(plans, 'even'));
    if (load > slotCount) {
      issues.push(item.name + ' 的周课时 ' + load + ' 超过可用时间格 ' + slotCount);
    }
  }
  for (const plan of data.coursePlans) {
    if (!findSubject(data, plan.subjectId)) {
      issues.push('教学计划 ' + plan.id + ' 引用了不存在的学科');
    }
    const planKind = plan.kind ?? 'regular';
    if (!data.timeSlots.some((slot) => (slot.kind ?? 'regular') === planKind)) {
      issues.push(
        planSubjectName(data, plan) + ' 是「' + (KIND_LABELS[planKind] ?? planKind) + '」计划，但没有对应类型的时段',
      );
    }
    const room = findClass(data, plan.classId);
    if (room && !data.rooms.some((item) => (!plan.roomType || item.type === plan.roomType) && item.capacity >= room.size)) {
      issues.push(room.name + ' / ' + planSubjectName(data, plan) + ' 没有容量足够的教室');
    }
  }
  const teacherIds = new Set(data.teachers.map((teacher) => teacher.id));
  const slotIds = new Set(data.timeSlots.map((slot) => slot.id));
  for (const item of data.unavailableSlots ?? []) {
    if (!teacherIds.has(item.teacherId) || !slotIds.has(item.slotId)) issues.push('教师不可用时间引用了不存在的教师或时间段');
  }
  const fixed = new Map<string, { id: string; weeks: string }[]>();
  for (const plan of data.coursePlans) {
    if (!plan.fixedSlotId) continue;
    const weeks = plan.weeks ?? 'all';
    for (const key of ['c:' + plan.classId + ':' + plan.fixedSlotId, 't:' + plan.teacherId + ':' + plan.fixedSlotId]) {
      const prior = fixed.get(key) ?? [];
      const clash = prior.find((item) => weeksOverlap(item.weeks, weeks));
      if (clash) issues.push('固定时间冲突：' + clash.id + ' 与 ' + plan.id);
      else prior.push({ id: plan.id, weeks });
      fixed.set(key, prior);
    }
  }
  return Array.from(new Set(issues));
}

function conflictIds(entries: ScheduleEntry[], plans: CoursePlan[] = []): Set<string> {
  const weeksOfPlan = new Map(plans.map((plan) => [plan.id, plan.weeks ?? 'all']));
  const weeksOf = (entry: ScheduleEntry) => entry.weeks ?? weeksOfPlan.get(entry.coursePlanId) ?? 'all';
  const groups = new Map<string, ScheduleEntry[]>();
  for (const entry of entries) {
    for (const key of [
      'class:' + entry.classId + ':' + entry.slotId,
      'teacher:' + entry.teacherId + ':' + entry.slotId,
      'room:' + entry.roomId + ':' + entry.slotId,
    ]) {
      const list = groups.get(key) ?? [];
      list.push(entry);
      groups.set(key, list);
    }
  }
  const ids = new Set<string>();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    // Odd and even lessons may share a slot; only overlapping weeks clash.
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (weeksOverlap(weeksOf(list[i]), weeksOf(list[j]))) {
          ids.add(list[i].id);
          ids.add(list[j].id);
        }
      }
    }
  }
  return ids;
}


function exportRows(data: SchoolData, result: SolverOutput): Record<string, string | number>[] {
  return result.entries.map((entry) => {
    const plan = planOf(data, entry);
    const slot = data.timeSlots.find((item) => item.id === entry.slotId);
    const weeks = entry.weeks ?? plan?.weeks ?? 'all';
    return {
      班级: findClass(data, entry.classId)?.name ?? entry.classId,
      星期: DAYS[slot?.day ?? 0] ?? '',
      节次: slot?.period ?? '',
      课程: planSubjectName(data, plan),
      教师: findTeacher(data, entry.teacherId)?.name ?? entry.teacherId,
      教室: findRoom(data, entry.roomId)?.name ?? entry.roomId,
      周次: weeks === 'odd' ? '单周' : weeks === 'even' ? '双周' : '每周',
      来源: entry.source === 'MANUAL' ? '手工' : '自动',
      锁定: entry.locked ? '是' : '否',
    };
  });
}

function Banner({
  tone,
  title,
  children,
  onClose,
}: {
  tone: 'error' | 'success' | 'warning' | 'info';
  title: string;
  children: React.ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className={'banner ' + tone} role={tone === 'error' ? 'alert' : 'status'}>
      <div>
        <strong>{title}</strong>
        <div className="banner-body">{children}</div>
      </div>
      {onClose ? (
        <button className="banner-close" onClick={onClose} aria-label="关闭提示">
          ×
        </button>
      ) : null}
    </div>
  );
}



function EmptyDataScreen({ message, onRetry, onSettings }: { message: string; onRetry: () => void; onSettings: () => void }) {
  return <div className="empty-data-screen"><div className="empty-data-mark">W</div><span className="kicker">// WORKSPACE NOT LOADED</span><h1>还没有加载工作区</h1><p>{message || '请启动本地服务，或检查运行模式中的服务地址。'}</p><div className="hero-actions"><button className="action-button" onClick={onRetry}>重新连接 <span>↗</span></button><button className="ghost-button" onClick={onSettings}>打开设置</button></div></div>;
}

function App() {
  const params = new URLSearchParams(window.location.search);
  const requestedTab = params.get('tab');
  const normalizedTab = requestedTab === '基础资料' || requestedTab === '教学计划' ? '排课准备' : requestedTab;
  const initialTheme = params.get('theme');
  const [tab, setTab] = useState<Tab>(
    normalizedTab && (TABS as readonly string[]).includes(normalizedTab) ? (normalizedTab as Tab) : '工作台',
  );
  const validSections: PrepareSection[] = ['import', 'classes', 'teachers', 'subjects', 'rooms', 'timeSlots', 'semester', 'plans', 'electives', 'availability', 'rules'];
  const requestedSection = params.get('section') as PrepareSection | null;
  const [prepareSection, setPrepareSection] = useState<PrepareSection>(
    requestedSection && validSections.includes(requestedSection)
      ? requestedSection
      : requestedTab === '教学计划'
        ? 'plans'
        : 'classes',
  );
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (initialTheme === 'dark' || initialTheme === 'light') return initialTheme;
    const saved = window.localStorage.getItem('warpweft-theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [runMode, setRunMode] = useState<RunMode | null>(() => {
    // Deep links can pin the runtime mode/endpoint, e.g. a LAN server handing
    // out `?mode=single&endpoint=http://192.168.1.20:4317` to its clients.
    const forcedMode = params.get('mode');
    const forcedEndpoint = params.get('endpoint');
    const modes: RunMode[] = ['single', 'lan-server', 'lan-client', 'cloud'];
    if (forcedMode && modes.includes(forcedMode as RunMode)) {
      window.localStorage.setItem('warpweft-runtime-mode', forcedMode);
      if (forcedEndpoint) window.localStorage.setItem('warpweft-runtime-endpoint', forcedEndpoint.replace(/\/+$/, ''));
      return forcedMode as RunMode;
    }
    const saved = window.localStorage.getItem('warpweft-runtime-mode');
    return saved === 'single' || saved === 'lan-server' || saved === 'lan-client' || saved === 'cloud' ? saved : null;
  });
  const [modeSettingsOpen, setModeSettingsOpen] = useState(false);
  const [data, setData] = useState<SchoolData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [result, setResult] = useState<SolverOutput | null>(null);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RunProgress>({ phase: 'idle', message: '等待开始排课' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [view, setView] = useState<View>('class');
  const [entityId, setEntityId] = useState('');
  const [selectedEntryId, setSelectedEntryId] = useState('');
  const [exportOpen, setExportOpen] = useState<null | 'export' | 'publish'>(null);
  const [exportWeek, setExportWeek] = useState<number | null>(null);
  const [history, setHistory] = useState<SolverOutput[]>([]);
  const [timeLimit, setTimeLimit] = useState(30);
  const saveTimer = useRef<number | null>(null);
  const pending = useRef<SchoolData | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('warpweft-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!runMode) return;
    let cancelled = false;
    loadData()
      .then((loaded) => {
        if (cancelled) return;
        setData(loaded);
        setLoadError('');
        setApiOnline(true);
        setSelectedClassId(loaded.classes[0]?.id ?? '');
        setResult(loaded.candidate ?? loaded.published ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setApiOnline(false);
        setLoadError('本地服务未连接，当前没有加载任何测试数据。');
      });
    return () => {
      cancelled = true;
    };
  }, [runMode]);

  const saveRunMode = (nextMode: RunMode, endpoint: string) => {
    const normalized = endpoint.trim().replace(/\/+$/, '');
    window.localStorage.setItem('warpweft-runtime-mode', nextMode);
    window.localStorage.setItem('warpweft-runtime-endpoint', normalized || RUN_MODE_OPTIONS.find((item) => item.value === nextMode)!.endpoint);
    setRunMode(nextMode);
    setModeSettingsOpen(false);
    setApiOnline(null);
    if (nextMode === 'lan-server') setTab('服务端');
    else if (tab === '服务端') setTab('工作台');
  };

  useEffect(() => {
    if (!data) return;
    if (!data.classes.some((item) => item.id === selectedClassId)) {
      setSelectedClassId(data.classes[0]?.id ?? '');
    }
  }, [data, selectedClassId]);

  useEffect(() => {
    if (!data) return;
    const entities = view === 'class' ? data.classes : view === 'teacher' ? data.teachers : data.rooms;
    if (!entities.some((item) => item.id === entityId)) {
      setEntityId(entities[0]?.id ?? '');
    }
  }, [data, view, entityId]);

  useEffect(() => {
    if (tab === '服务端' && runMode !== 'lan-server') setTab('工作台');
  }, [tab, runMode]);

  const flush = async (value: SchoolData) => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (!apiOnline) {
      setSaveState('offline');
      return;
    }
    setSaveState('saving');
    try {
      const saved = await saveData(value);
      setData((current) => (current ? { ...current, updatedAt: saved.updatedAt } : saved));
      setSaveState('saved');
    } catch (cause) {
      setSaveState('error');
      setError('保存失败：' + messageOf(cause));
    }
  };

  const commit: Commit = (next, options = {}) => {
    let value = next;
    if (options.invalidate) {
      value = { ...next, candidate: null };
      setResult(null);
      setSelectedEntryId('');
      setHistory([]);
    }
    setData(value);
    pending.current = value;
    if (!apiOnline) {
      setSaveState('offline');
      return;
    }
    setSaveState('saving');
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    if (options.immediate) {
      saveTimer.current = null;
      void flush(value);
    } else {
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        void flush(value);
      }, 350);
    }
  };

  const applyResult = (next: SolverOutput) => {
    setResult(next);
    if (!data) return;
    const updated = { ...data, candidate: next };
    setData(updated);
    pending.current = updated;
    if (apiOnline) {
      setSaveState('saving');
      void flush(updated);
    }
  };

  const adjustmentDays = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, Record<string, number>>();
    for (const item of data.adjustments ?? []) {
      if (item.status !== 'active') continue;
      const counts = map.get(item.date) ?? {};
      counts[item.type] = (counts[item.type] ?? 0) + 1;
      map.set(item.date, counts);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({
        date,
        label: date + ' ' + (DAYS[weekdayOf(date)] ?? ''),
        count: Object.values(counts).reduce((sum, value) => sum + value, 0),
        summary: Object.entries(counts).map(([type, value]) => (ADJUSTMENT_LABELS as Record<string, string>)[type] + ' ' + value).join(' · '),
      }));
  }, [data]);

  const report = useMemo<InspectionReport | null>(() => {
    if (!data || !result) return null;
    try {
      return inspectTimetable({ ...data, entries: result.entries });
    } catch {
      return null;
    }
  }, [data, result]);

  const locateInspection = (refs: InspectionRefs) => {
    const teacherId = refs.teacherIds?.[0];
    const roomId = refs.roomIds?.[0];
    const classId = refs.classIds?.[0];
    if (teacherId) {
      setView('teacher');
      setEntityId(teacherId);
    } else if (roomId) {
      setView('room');
      setEntityId(roomId);
    } else if (classId) {
      setView('class');
      setEntityId(classId);
    }
    setSelectedEntryId(refs.entryIds?.[0] ?? '');
    setTab('课表预览');
  };

  const exportInspectionExcel = async () => {
    if (!data || !report) return;
    try {
      const ratio = (value: number) => Math.round(value * 1000) / 10 + '%';
      const bytes = exportWorkbook({
        汇总: [
          { 项目: '学校', 值: data.school.name },
          { 项目: '生成时间', 值: new Date(report.generatedAt).toLocaleString('zh-CN') },
          { 项目: '结论', 值: report.ok ? '可以发布' : '不可发布' },
          { 项目: '已排课时', 值: report.summary.placed },
          { 项目: '未排课时', 值: report.summary.unplaced },
          { 项目: '硬冲突', 值: report.summary.hard },
          { 项目: '必须规则违反', 值: report.summary.must },
          { 项目: '尽量规则违反', 值: report.summary.prefer },
        ],
        问题清单: reportRows(report),
        教室利用率: report.utilization.rooms.map((row) => ({
          教室类型: row.name,
          已用: row.used,
          可用: row.capacity,
          占用率: ratio(row.ratio),
        })),
        教师周课时: report.utilization.teachers.map((row) => ({
          教师: row.name,
          已排课时: row.used,
          可用时段: row.capacity,
          占用率: ratio(row.ratio),
        })),
        班级课时: report.utilization.classes.map((row) => ({
          班级: row.name,
          已排课时: row.used,
          可用时段: row.capacity,
          占用率: ratio(row.ratio),
        })),
      });
      const result = await download(
        bytes,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'warpweft-inspection.xlsx',
      );
      const message = exportMessage(result, '检测报告');
      if (!message) return;
      if (message.tone === 'error') setError(message.text);
      else setNotice(message.text);
    } catch (cause) {
      setError('导出检测报告失败：' + messageOf(cause));
    }
  };

  const exportInspectionCsv = async () => {
    if (!report) return;
    try {
      const csv = exportCsv(reportRows(report));
      const result = await download(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), 'text/csv', 'warpweft-inspection.csv');
      const message = exportMessage(result, '检测 CSV');
      if (!message) return;
      if (message.tone === 'error') setError(message.text);
      else setNotice(message.text);
    } catch (cause) {
      setError('导出检测 CSV 失败：' + messageOf(cause));
    }
  };

  const actualStats = useMemo<ActualStats | null>(() => {
    if (!data) return null;
    try {
      return buildActualStats(data.lessonLogs ?? [], data.teachers);
    } catch {
      return null;
    }
  }, [data]);

  const stats = useMemo<StatsReport | null>(() => {
    if (!data) return null;
    try {
      return buildStats({ ...data, entries: result?.entries ?? data.published?.entries ?? [] });
    } catch {
      return null;
    }
  }, [data, result]);

  const exportStatsExcel = async () => {
    if (!data || !stats) return;
    try {
      const bytes = exportWorkbook({
        汇总: [
          { 项目: '学校', 值: data.school.name },
          { 项目: '生成时间', 值: new Date(stats.generatedAt).toLocaleString('zh-CN') },
          { 项目: '口径', 值: '计划 = 教学计划周课时；已排 = 当前候选课表条目' },
          { 项目: '计划周课时', 值: stats.summary.planned },
          { 项目: '折算平均周课时', 值: stats.summary.averagePlanned },
          { 项目: '已排课时', 值: stats.summary.placed },
          { 项目: '未排课时', 值: stats.summary.missing },
          { 项目: '班级', 值: stats.summary.classes },
          { 项目: '教师', 值: stats.summary.teachers },
          { 项目: '学科', 值: stats.summary.subjects },
          { 项目: '时间格', 值: stats.summary.slots },
        ],
        教师周课时: teacherRowsForExport(stats),
        学科周课时: subjectRowsForExport(stats),
        班级周课时: classRowsForExport(stats),
        每天分布: stats.days.map((row) => ({
          星期: '周' + row.day,
          班级时间格: row.capacity,
          已排课时: row.placed,
          占用率: Math.round(row.ratio * 1000) / 10 + '%',
        })),
        时段类型: stats.byKind.map((row) => ({
          时段类型: row.label,
          计划课时: row.planned,
          已排课时: row.placed,
          未排课时: Math.max(0, row.planned - row.placed),
        })),
        实际上课: (data.lessonLogs ?? []).map((log) => ({
          日期: log.date,
          时间: data.timeSlots.find((slot) => slot.id === log.slotId)?.label ?? log.slotId,
          班级: data.classes.find((klass) => klass.id === log.classId)?.name ?? log.classId,
          学科: findSubject(data, log.subjectId)?.name ?? log.subjectId,
          实际教师: findTeacher(data, log.teacherId)?.name ?? log.teacherId,
          原任课教师: findTeacher(data, log.originalTeacherId)?.name ?? log.originalTeacherId,
          状态: LESSON_STATUS_LABELS[log.status],
          确认: log.confirmed ? '是' : '否',
          备注: log.note ?? '',
        })),
      });
      const result = await download(
        bytes,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'warpweft-workload.xlsx',
      );
      const message = exportMessage(result, '统计报表');
      if (!message) return;
      if (message.tone === 'error') setError(message.text);
      else setNotice(message.text);
    } catch (cause) {
      setError('导出统计报表失败：' + messageOf(cause));
    }
  };

  const exportStatsCsv = async () => {
    if (!stats) return;
    try {
      const csv = exportCsv(teacherRowsForExport(stats));
      const result = await download(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), 'text/csv', 'warpweft-teacher-workload.csv');
      const message = exportMessage(result, '教师周课时表');
      if (!message) return;
      if (message.tone === 'error') setError(message.text);
      else setNotice(message.text);
    } catch (cause) {
      setError('导出教师周课时表失败：' + messageOf(cause));
    }
  };

  const applyLongResult = (job: LongJobDetail) => {
    if (!data) return;
    // The workspace can change while a long job runs; never persist entries that
    // point at deleted classes, rooms or slots.
    const classIds = new Set(data.classes.map((item) => item.id));
    const teacherIds = new Set(data.teachers.map((item) => item.id));
    const roomIds = new Set(data.rooms.map((item) => item.id));
    const slotIds = new Set(data.timeSlots.map((item) => item.id));
    const planIds = new Set(data.coursePlans.map((item) => item.id));
    const entries = job.bestEntries.filter(
      (entry) =>
        planIds.has(entry.coursePlanId) &&
        classIds.has(entry.classId) &&
        teacherIds.has(entry.teacherId) &&
        roomIds.has(entry.roomId) &&
        slotIds.has(entry.slotId),
    );
    const dropped = job.bestEntries.length - entries.length;
    if (entries.length === 0) {
      setError('长时任务的最佳解与当前工作区数据不匹配（可能数据在任务期间被修改），无法载入');
      return;
    }
    const output: SolverOutput = {
      protocolVersion: '1.0',
      status: job.unplaced === 0 && dropped === 0 ? 'COMPLETED' : 'FEASIBLE',
      entries,
      hardConstraintViolations: [],
      softScore: job.score ?? 0,
      scoreBreakdown: {},
      unsatisfiedRules: [],
      explanation:
        '长时任务最佳解：' +
        entries.length +
        '/' +
        job.total +
        ' 课时' +
        (job.unplaced > 0 || dropped > 0 ? '（未排满，可继续计算）' : ''),
      elapsedMs: job.elapsedMs,
      hasFeasibleSolution: job.unplaced === 0 && dropped === 0,
    };
    applyResult(output);
    setSelectedEntryId('');
    setHistory([]);
    setNotice(
      '已载入长时任务最佳课表：' + entries.length + ' 条' + (dropped > 0 ? '，已忽略 ' + dropped + ' 条失效条目' : ''),
    );
  };

  const run = async () => {
    if (!data || running) return;
    setProgress({ phase: 'checking', message: '正在检查排课配置', startedAt: Date.now() });
    const issues = preflight(data);
    if (issues.length > 0) {
      setProgress({ phase: 'failed', message: '配置检查未通过，请先处理提示项' });
      setError(issues.join('\n'));
      setTab('排课任务');
      return;
    }
    const locked = data.candidate?.entries.filter((entry) => entry.locked) ?? [];
    if (locked.length > 0 && !window.confirm('重新排课会重新计算全部课程，已锁定的课程会保留在原位置。继续？')) {
      setProgress({ phase: 'idle', message: '等待开始排课' });
      return;
    }
    setRunning(true);
    setProgress({ phase: 'preparing', message: '正在整理锁定课程和 Solver 输入', startedAt: Date.now() });
    setError('');
    setNotice('');
    try {
      setProgress({ phase: 'solving', message: 'Solver 正在计算可行课表', startedAt: Date.now() });
      const output = await solveSchedule(toSolverInput(data, timeLimit, locked));
      setProgress({ phase: 'finalizing', message: '正在保存候选课表并整理结果', startedAt: Date.now() });
      setResult(output);
      const updated = { ...data, candidate: output };
      setData(updated);
      pending.current = updated;
      if (apiOnline) {
        setSaveState('saving');
        await flush(updated);
      }
      setSelectedEntryId('');
      setHistory([]);
      if (output.hasFeasibleSolution) {
        setTab('课表预览');
        setProgress({ phase: 'completed', message: '排课完成：共 ' + output.entries.length + ' 条课表', startedAt: Date.now() });
        setNotice('排课完成：共 ' + output.entries.length + ' 条课表');
      } else {
        setTab('排课任务');
        setProgress({ phase: 'failed', message: output.explanation || '未找到可行课表', startedAt: Date.now() });
        setError(output.explanation || '未找到可行课表');
      }
    } catch (cause) {
      setResult(null);
      setProgress({ phase: 'failed', message: '排课失败：' + messageOf(cause), startedAt: Date.now() });
      setError('排课失败：' + messageOf(cause));
      setTab('排课任务');
    } finally {
      setRunning(false);
    }
  };

  const simulateRule = async (rule: RuleInstance) => {
    if (!data) return null;
    const temp = { ...data, rules: (data.rules ?? []).map((item) => item.id === rule.id ? { ...item, enabled: false } : item) };
    const locked = data.candidate?.entries.filter((entry) => entry.locked) ?? [];
    try {
      const output = await solveSchedule(toSolverInput(temp, 30, locked));
      const total = data.coursePlans.reduce((sum, plan) => sum + Number(plan.weeklyPeriods || 0), 0);
      const before = data.candidate?.entries.length ?? 0;
      return { entries: output.entries.length, total, before, feasible: output.hasFeasibleSolution, elapsedMs: output.elapsedMs };
    } catch (cause) {
      setError('模拟失败：' + messageOf(cause));
      return null;
    }
  };

  const repairSchedule = async (scope: 'class' | 'teacher' | 'rule', id: string) => {
    if (!data || !result || running || !id) return;
    const originalLocked = new Set(result.entries.filter((entry) => entry.locked).map((entry) => entry.id));
    const originalSources = new Map(result.entries.map((entry) => [entry.id, entry.source]));
    const scopeRule = scope === 'rule' ? (data.rules ?? []).find((rule) => rule.id === id) : undefined;
    const affectedPlans = scopeRule ? new Set(matchedPlans(scopeRule, data).map((plan) => plan.id)) : null;
    const locked = result.entries.filter((entry) => entry.locked || (scope === 'class' ? entry.classId !== id : scope === 'teacher' ? entry.teacherId !== id : !affectedPlans?.has(entry.coursePlanId)));
    setRunning(true);
    setError('');
    setProgress({ phase: 'solving', message: '正在局部重排所选范围', startedAt: Date.now() });
    try {
      const output = await solveSchedule(toSolverInput(data, timeLimit, locked));
      const repaired = {
        ...output,
        entries: output.entries.map((entry) => ({
          ...entry,
          locked: originalLocked.has(entry.id),
          source: originalSources.get(entry.id) ?? entry.source,
        })),
      };
      setResult(repaired);
      const updated = { ...data, candidate: repaired };
      setData(updated);
      pending.current = updated;
      if (apiOnline) {
        setSaveState('saving');
        await flush(updated);
      }
      setProgress({ phase: repaired.hasFeasibleSolution ? 'completed' : 'failed', message: repaired.hasFeasibleSolution ? '局部重排完成' : (repaired.explanation || '局部重排未完成'), startedAt: Date.now() });
      if (repaired.hasFeasibleSolution) {
        setNotice('局部重排完成：已保留范围外课程的位置');
      } else {
        setError(repaired.explanation || '局部重排未完成');
      }
    } catch (cause) {
      setProgress({ phase: 'failed', message: '局部重排失败：' + messageOf(cause), startedAt: Date.now() });
      setError('局部重排失败：' + messageOf(cause));
    } finally {
      setRunning(false);
    }
  };

  const swapEntry = (entryId: string, targetSlotId: string) => {
    if (!result || !data || view !== 'class') return;
    const moving = result.entries.find((entry) => entry.id === entryId);
    if (!moving || moving.locked) return;
    const target = result.entries.find(
      (entry) => entry.slotId === targetSlotId && entry.classId === moving.classId,
    );
    if (target && target.locked) {
      setError('目标课程已锁定，请先解锁再调整');
      return;
    }
    if (moving.slotId === targetSlotId) return;
    const movingPlan = planOf(data, moving);
    if (movingPlan?.fixedSlotId && movingPlan.fixedSlotId !== targetSlotId) {
      setError('该课程设置了固定时间，不能移动');
      return;
    }
    if (target) {
      const targetPlan = planOf(data, target);
      if (targetPlan?.fixedSlotId && targetPlan.fixedSlotId !== moving.slotId) {
        setError('目标课程设置了固定时间，不能交换');
        return;
      }
    }
    const weeksOfEntry = (entry: ScheduleEntry) => entry.weeks ?? planOf(data, entry)?.weeks ?? 'all';
    const movingWeeks = weeksOfEntry(moving);
    const blocking = result.entries.find((entry) => entry.id !== moving.id && entry.id !== target?.id && entry.slotId === targetSlotId
      && weeksOverlap(weeksOfEntry(entry), movingWeeks)
      && (entry.teacherId === moving.teacherId || entry.roomId === moving.roomId));
    if (blocking) {
      setError('目标时间已有同一教师或教室的课程，不能移动到这里');
      return;
    }
    const entries = result.entries.map((entry) => ({ ...entry }));
    const source = entries.find((entry) => entry.id === moving.id);
    if (!source) return;
    if (target) {
      const destination = entries.find((entry) => entry.id === target.id);
      if (!destination) return;
      const slot = source.slotId;
      source.slotId = destination.slotId;
      destination.slotId = slot;
      destination.source = 'MANUAL';
    } else {
      source.slotId = targetSlotId;
    }
    source.source = 'MANUAL';
    const conflicts = conflictIds(entries, data.coursePlans);
    if (conflicts.has(source.id) || (target && conflicts.has(target.id))) {
      setError('调整后会产生教师、教室或班级冲突，请选择其他时间');
      return;
    }
    setHistory((current) => [...current.slice(-19), result]);
    applyResult({ ...result, entries });
  };

  const toggleLock = (entryId: string) => {
    if (!result) return;
    setHistory((current) => [...current.slice(-19), result]);
    const entries = result.entries.map((entry) =>
      entry.id === entryId ? { ...entry, locked: !entry.locked } : entry,
    );
    applyResult({ ...result, entries });
  };

  const undo = () => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setHistory((current) => current.slice(0, -1));
    applyResult(previous);
  };

  const publishVersion = (settings: TimetableExportSettings, outcome: ExportResult) => {
    if (!data || !result) return;
    const createdAt = new Date().toISOString();
    const version = {
      id: uid('version'),
      createdAt,
      name: settings.title || '班级课表',
      title: settings.title || '班级课表',
      schoolName: settings.schoolName || data.school.name,
      fileName: timetableFileName(data, settings),
      filePath: outcome.path ?? null,
      result,
      note: '手动发布',
    };
    const audit = {
      id: uid('audit'),
      at: createdAt,
      action: 'PUBLISH',
      detail: `发布课表 ${version.id} · ${version.fileName}${version.filePath ? ' · ' + version.filePath : ''}`,
    };
    commit(
      {
        ...data,
        published: result,
        publishedVersions: [...(data.publishedVersions ?? []), version],
        auditLog: [...(data.auditLog ?? []), audit],
      },
      { immediate: true },
    );
    setNotice('已发布正式版：' + version.fileName + (version.filePath ? '（' + version.filePath + '）' : ''));
  };

  const publish = () => {
    if (!data || !result) return;
    if (report && !report.ok) {
      setError(
        '检测未通过：' +
          report.summary.hard +
          ' 项硬冲突、' +
          report.summary.must +
          ' 条「必须」规则违反。请先在「最终课表」处理阻断项，再保存为正式版。',
      );
      setTab('最终课表');
      return;
    }
    setExportOpen('publish');
  };

  const renameVersion = (id: string) => {
    if (!data) return;
    const current = (data.publishedVersions ?? []).find((version) => version.id === id);
    if (!current) return;
    const next = window.prompt('版本名称', current.name ?? current.title ?? '班级课表');
    if (!next || !next.trim()) return;
    commit({
      ...data,
      publishedVersions: (data.publishedVersions ?? []).map((version) => (version.id === id ? { ...version, name: next.trim() } : version)),
    }, { immediate: true });
    setNotice('版本名称已更新为「' + next.trim() + '」');
  };

  const revealVersion = async (path?: string | null) => {
    if (!path) {
      setError('该版本没有记录本地文件路径：浏览器下载由下载目录管理，桌面端保存时才会记录路径。');
      return;
    }
    const bridge = (window as unknown as { warpweft?: { showItemInFolder?: (value: string) => void } }).warpweft;
    if (bridge?.showItemInFolder) {
      bridge.showItemInFolder(path);
      return;
    }
    try {
      await navigator.clipboard.writeText(path);
      setNotice('已复制文件路径：' + path);
    } catch {
      setNotice('文件路径：' + path);
    }
  };

  const clearCandidate = () => {
    if (!data) return;
    if (!window.confirm('清空候选课表？已发布版本不受影响。')) return;
    setResult(null);
    setSelectedEntryId('');
    setHistory([]);
    commit({ ...data, candidate: null }, { immediate: true });
    setNotice('候选课表已清空');
  };

  const exportCsvFile = async () => {
    if (!data) return;
    const target = result ?? data.published;
    if (!target) return;
    try {
      const csv = exportCsv(exportRows(data, target));
      const result = await download(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), 'text/csv', 'warpweft-timetable.csv');
      const message = exportMessage(result, 'CSV');
      if (!message) return;
      if (message.tone === 'error') setError(message.text);
      else setNotice(message.text);
    } catch (cause) {
      setError('导出 CSV 失败：' + messageOf(cause));
    }
  };

  const openTimetableExport = () => {
    if (!data) return;
    if (!(result ?? data.published)) return;
    setExportWeek(null);
    setExportOpen('export');
  };

  const openAdjustedExport = (date: string) => {
    if (!data) return;
    if (!(result ?? data.published)) return;
    const week = weekOfDate(data.semester, date);
    if (!week) {
      setError('无法定位该日期属于第几周，请先在「排课准备 → 学期周次」设置学期起止日期。');
      return;
    }
    setExportWeek(week);
    setExportOpen('export');
  };

  const viewAdjustedDate = (date: string) => {
    try {
      window.localStorage.setItem('warpweft-adjust-date', date);
    } catch {
      // ignore
    }
    setTab('课表预览');
  };

  const exportTimetable = async (settings: TimetableExportSettings, onStage: (stage: 'generating' | 'writing') => void): Promise<boolean> => {
    if (!data) return false;
    const target = result ?? data.published;
    if (!target) return false;
    try {
      const template = await loadTimetableTemplate(settings.layout);
      let buffer: Uint8Array;
      if (settings.scope === 'semester' && data.semester) {
        const patterns = semesterPatterns(data, target, data.adjustments ?? [], settings);
        const filled = await fillSemesterTemplate(template, data, target, settings, patterns);
        buffer = filled.buffer;
      } else {
        const weekStart = settings.weekNo ? semesterWeeks(data.semester).find((week) => week.index === settings.weekNo)?.startDate : null;
        const entries = weekStart ? adjustedWeekEntries(data, target, data.adjustments ?? [], weekStart) : target.entries;
        const filled = await fillTimetableTemplate(template, data, { ...target, entries }, settings);
        buffer = filled.buffer;
      }
      onStage('writing');
      const outcome = await download(
        buffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        timetableFileName(data, settings),
      );
      const message = exportMessage(outcome, '课表');
      if (!message) return false;
      if (message.tone === 'error') {
        setError(message.text);
        return false;
      }
      setNotice(message.text);
      if (exportOpen === 'publish') publishVersion(settings, outcome);
      return true;
    } catch (cause) {
      setError('导出课表失败：' + messageOf(cause));
      return false;
    }
  };

  if (!runMode) {
    return <RuntimeModeDialog current={null} onSave={saveRunMode} />;
  }

  if (!data) {
    if (apiOnline === false) {
      return <EmptyDataScreen message={loadError} onRetry={() => window.location.reload()} onSettings={() => setRunMode(null)} />;
    }
    return (
      <div className="boot-screen">
        <div className="boot-mark">W</div>
        <strong>WARPWEFT</strong>
        <span>正在载入本地数据…</span>
      </div>
    );
  }

  const issues = preflight(data);
  const visibleTabs = runMode === 'lan-server' ? TABS : TABS.filter((item) => item !== '服务端');
  const saveLabel =
    saveState === 'saving'
      ? '保存中…'
      : saveState === 'saved'
        ? '已保存'
        : saveState === 'error'
          ? '保存失败'
          : saveState === 'offline'
            ? '仅本地演示'
            : '';

  return (
    <div className="app-shell">
      <div className="signal-bar">
        <i />
        <i />
        <i />
      </div>
      <aside className="command-rail">
        <div className="brand-lockup">
          <span className="brand-mark">W</span>
          <div>
            <span className="brand-name">WARPWEFT</span>
            <span className="brand-sub">SCHEDULER / LOCAL</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="主导航">
          {visibleTabs.map((item, index) => (
            <button
              key={item}
              className={tab === item ? 'nav-item active' : 'nav-item'}
              onClick={() => setTab(item)}
              aria-current={tab === item ? 'page' : undefined}
            >
              <span className="nav-no">0{index + 1}</span>
              <span>{item}</span>
              <em>{EN[item]}</em>
            </button>
          ))}
        </nav>
        <div className="rail-footer">
          <span>DATA SOURCE</span>
          <strong>{data.school.name}</strong>
          <small>{apiOnline === false ? 'LOCAL DATA / NOT SAVED' : 'LOCAL FILE / OFFLINE'}</small>
          <small>{data.updatedAt ? '更新 ' + fmtTime(data.updatedAt) : '尚未保存'}</small>
        </div>
      </aside>
      <main className={'workspace' + (tab === '课表预览' ? ' workspace-timetable' : '')}>
        <header className="topbar">
          <div>
            <span className="kicker">// {EN[tab]}</span>
            <h1>{tab}</h1>
          </div>
          <div className="top-actions">
            <span className={apiOnline === false ? 'node-status offline' : 'node-status'}>
              <i />
              {apiOnline === null ? '连接本地服务…' : apiOnline ? '本地服务在线' : '本地服务未连接'}
            </span>
            {running ? <span className="run-phase-pill">{progress.message}</span> : null}
            {saveLabel ? <span className={'save-state ' + saveState}>{saveLabel}</span> : null}
            <button className="mode-pill" onClick={() => setModeSettingsOpen(true)} title="修改运行模式">
              运行：{RUN_MODE_OPTIONS.find((item) => item.value === runMode)?.title}
            </button>
            <button
              className="theme-toggle"
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              aria-label={theme === 'light' ? '切换深色主题' : '切换浅色主题'}
            >
              <span>{theme === 'light' ? '☾' : '☀'}</span>
              {theme === 'light' ? '深色' : '浅色'}
            </button>
          </div>
        </header>
        {apiOnline === false ? (
          <Banner tone="warning" title="本地服务未连接">
            当前服务未连接，修改不会保存。请通过桌面端启动，或先运行 <code>npm run dev:api</code> 再打开界面。
          </Banner>
        ) : null}
        {error ? (
          <Banner tone="error" title="操作未完成" onClose={() => setError('')}>
            {error}
          </Banner>
        ) : null}
        {notice ? (
          <Banner tone="success" title="已完成" onClose={() => setNotice('')}>
            {notice}
          </Banner>
        ) : null}
        {tab === '工作台' ? (
          <Dashboard
            data={data}
            result={result}
            issues={issues}
            running={running}
            progress={progress}
            onPrepare={() => { setPrepareSection('plans'); setTab('排课准备'); }}
            onRun={() => setTab('排课任务')}
            onTimetable={() => setTab('课表预览')}
            onAdjust={() => setTab('调代课')}
          />
        ) : null}
        {tab === '排课准备' ? (
          <PreparePage
            data={data}
            commit={commit}
            issues={issues}
            section={prepareSection}
            setSection={setPrepareSection}
            setError={setError}
            setNotice={setNotice}
            onGoRun={() => setTab('排课任务')}
            onSimulate={simulateRule}
          />
        ) : null}
        {tab === '排课任务' ? (
          <RunsPage
            data={data}
            result={result}
            issues={issues}
            running={running}
            progress={progress}
            runMode={runMode}
            timeLimit={timeLimit}
            setTimeLimit={setTimeLimit}
            onRun={run}
            onRepair={repairSchedule}
            onTimetable={() => setTab('课表预览')}
            onClear={clearCandidate}
            inputFactory={(seconds) => toSolverInput(data, seconds, data.candidate?.entries.filter((entry) => entry.locked) ?? [])}
            onApplyLongResult={applyLongResult}
            onNotice={setNotice}
            onError={setError}
          />
        ) : null}
        {tab === '课表预览' ? (
          <TimetablePage
            data={data}
            result={result}
            report={report}
            view={view}
            setView={setView}
            entityId={entityId}
            setEntityId={setEntityId}
            selectedEntryId={selectedEntryId}
            setSelectedEntryId={setSelectedEntryId}
            onSwap={swapEntry}
            onToggleLock={toggleLock}
            onUndo={undo}
            canUndo={history.length > 0}
            onRun={run}
            running={running}
            onInspect={() => setTab('最终课表')}
            onExportCsv={exportCsvFile}
            onExportExcel={openTimetableExport}
            onPrint={() => window.print()}
          />
        ) : null}
        {tab === '调代课' ? (
          <AdjustmentsPage data={data} commit={commit} setError={setError} setNotice={setNotice} />
        ) : null}
        {tab === '最终课表' ? (
          <InspectionPage
            report={report}
            hasCandidate={Boolean(result)}
            published={Boolean(data.published)}
            onLocate={locateInspection}
            onExportExcel={exportInspectionExcel}
            onExportCsv={exportInspectionCsv}
            onPrint={() => window.print()}
            onTimetable={() => setTab('课表预览')}
            onRun={() => setTab('排课任务')}
            onPublish={publish}
            onExportTimetable={openTimetableExport}
            adjustmentDays={adjustmentDays}
            onViewAdjustment={viewAdjustedDate}
            onExportAdjustment={(date) => openAdjustedExport(date)}
            versions={data.publishedVersions ?? []}
            onRenameVersion={renameVersion}
            onRevealVersion={(path) => void revealVersion(path)}
          />
        ) : null}
        {tab === '统计报表' ? (
          <StatsPage
            report={stats}
            actual={actualStats}
            hasCandidate={Boolean(result)}
            onExportExcel={exportStatsExcel}
            onExportCsv={exportStatsCsv}
            onRun={() => setTab('排课任务')}
            onTimetable={() => setTab('课表预览')}
          />
        ) : null}
        {tab === '报表发布' ? (
          <ReleasePage
            data={data}
            result={result}
            report={report}
            onInspect={() => setTab('最终课表')}
            onPublish={publish}
            onClear={clearCandidate}
            onExportCsv={exportCsvFile}
            onExportExcel={openTimetableExport}
            onPrint={() => {
              if (!result) return;
              setTab('课表预览');
              window.setTimeout(() => window.print(), 350);
            }}
          />
        ) : null}
        {tab === '服务端' && runMode === 'lan-server' ? <ServerPage apiOnline={apiOnline} /> : null}
        {tab === '设置' ? <SettingsPage runMode={runMode} theme={theme} onThemeChange={setTheme} onEditMode={() => setModeSettingsOpen(true)} apiOnline={apiOnline} data={data} commit={commit} /> : null}
      </main>
      {exportOpen && data && (result ?? data.published) ? (
        <TimetableExportDialog
          data={data}
          result={result ?? data.published!}
          initialView={view}
          initialEntityId={entityId || selectedClassId || data.classes[0]?.id || ''}
          initialWeekNo={exportWeek}
          mode={exportOpen}
          onClose={() => setExportOpen(null)}
          onConfirm={exportTimetable}
        />
      ) : null}
      {modeSettingsOpen ? <RuntimeModeDialog current={runMode} onSave={saveRunMode} onClose={() => setModeSettingsOpen(false)} /> : null}
    </div>
  );
}

function Dashboard({
  data,
  result,
  issues,
  running,
  onPrepare,
  onRun,
  progress,
  onTimetable,
  onAdjust,
}: {
  data: SchoolData;
  result: SolverOutput | null;
  issues: string[];
  running: boolean;
  progress: RunProgress;
  onPrepare: () => void;
  onRun: () => void;
  onTimetable: () => void;
  onAdjust: () => void;
}) {
  const periods = data.coursePlans.reduce((sum, plan) => sum + Number(plan.weeklyPeriods || 0), 0);
  const stats = [
    { code: 'CLS', label: '班级', value: data.classes.length, note: '行政班' },
    { code: 'TCH', label: '教师', value: data.teachers.length, note: '任课关系' },
    { code: 'ROM', label: '教室', value: data.rooms.length, note: '可用教室' },
    { code: 'HRS', label: '待排课时', value: periods, note: '每周总量' },
  ];
  const ready = issues.length === 0;
  const stateLabel = result
    ? ['COMPLETED', 'FEASIBLE', 'IMPROVED', 'OPTIMAL'].includes(result.status)
      ? 'READY'
      : result.status === 'TIMEOUT'
        ? 'TIMEOUT'
        : 'FAILED'
    : 'IDLE';
  return (
    <>
      <section className="hero-panel">
        <div className="hero-copy">
          <h2>
            <strong>经纬排课已就绪</strong>
          </h2>
          <p className="hero-subtitle">WarpWeft-Scheduler</p>
          <button className="ink-button" onClick={onPrepare}>
            继续准备数据 <span>→</span>
          </button>
        </div>
        <div className="hero-readout">
          <span>TASK STATE</span>
          <strong>{stateLabel}</strong>
          <div className="readout-track">
            <i style={{ width: result ? '100%' : ready ? '62%' : '28%' }} />
          </div>
          <small>{result ? '候选方案已生成' : ready ? '数据已就绪，可以排课' : '还有 ' + issues.length + ' 项需要处理'}</small>
        </div>
      </section>
      <section className="number-strip">
        {stats.map((stat) => (
          <div className="metric" key={stat.code}>
            <span className="metric-code">{stat.code}</span>
            <strong>{String(stat.value).padStart(2, '0')}</strong>
            <div>
              <b>{stat.label}</b>
              <small>{stat.note}</small>
            </div>
          </div>
        ))}
      </section>
      <TodayPanel data={data} now={new Date()} onAdjust={onAdjust} onTimetable={onTimetable} />
      <section className="dashboard-grid">
        <article className="section-panel progress-panel">
          <SectionHeading english="CURRENT STATE" title="当前进度" />
          <div className="state-line">
            <span className={ready ? 'state-mark done' : 'state-mark'}>{ready ? '✓' : '01'}</span>
            <div>
              <b>{ready ? '数据检查通过' : '数据准备未完成'}</b>
              <p>{ready ? '可以开始自动排课，或继续微调教学计划。' : '先处理下面列出的数据问题，再开始排课。'}</p>
            </div>
          </div>
          <div className="mechanical-progress">
            <i style={{ width: ready ? '100%' : '42%' }} />
          </div>
          {progress.phase !== 'idle' ? <RunProgressView progress={progress} /> : null}
          <div className="field-row">
            <span>DATA SNAPSHOT</span>
            <b>{data.updatedAt ? fmtTime(data.updatedAt) : 'LOCAL'}</b>
            <span>PLANS</span>
            <b>{data.coursePlans.length}</b>
          </div>
          <div className="hero-actions">
            <button className="action-button" onClick={onRun} disabled={running}>
              {running ? '计算中…' : '进入排课任务'} <span>→</span>
            </button>
            {result ? (
              <button className="ghost-button" onClick={onTimetable}>
                查看候选课表
              </button>
            ) : null}
          </div>
        </article>
        <article className="section-panel next-panel">
          <SectionHeading english="NEXT ACTIONS" title="下一步" />
          {issues.length > 0 ? (
            <ol>
              {issues.slice(0, 4).map((issue, index) => (
                <li key={issue}>
                  <span>0{index + 1}</span>
                  {issue}
                </li>
              ))}
            </ol>
          ) : (
            <ol>
              <li>
                <span>01</span>确认班级、教师和教室资料
              </li>
              <li>
                <span>02</span>检查教学计划的周课时
              </li>
              <li>
                <span>03</span>开始一次自动排课
              </li>
            </ol>
          )}
        </article>
      </section>
    </>
  );
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return size.toFixed(size >= 10 ? 0 : 1) + ' ' + units[index];
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return days + '天 ' + hours + '小时';
  if (hours > 0) return hours + '小时 ' + minutes + '分';
  return Math.max(0, minutes) + '分 ' + Math.floor(seconds % 60) + '秒';
}

function jobStateLabel(status: string): string {
  if (status === 'queued') return '排队中';
  if (status === 'running') return '求解中';
  if (status === 'completed') return '已完成';
  if (status === 'timeout') return '超时';
  if (status === 'failed') return '失败';
  if (status === 'cancelled') return '已取消';
  return status;
}

function relativeTime(timestamp: number): string {
  if (!timestamp) return '—';
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 15) return '刚刚';
  if (seconds < 60) return seconds + ' 秒前';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + ' 分钟前';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + ' 小时前';
  return Math.floor(hours / 24) + ' 天前';
}

function shortClientId(id: string | null | undefined): string {
  if (!id) return '—';
  return id.length > 12 ? id.slice(0, 8) : id;
}

type ConfigNumberKey =
  | 'maxClients'
  | 'maxConcurrentJobs'
  | 'queueCapacity'
  | 'perClientActive'
  | 'perClientQueued'
  | 'jobTimeoutSeconds';

interface ConfigDraft {
  bindAddress: ServerConfig['bindAddress'];
  maxClients: string;
  maxConcurrentJobs: string;
  queueCapacity: string;
  perClientActive: string;
  perClientQueued: string;
  jobTimeoutSeconds: string;
  allowedCidrs: string;
}

const CONFIG_NUMBER_FIELDS: { key: ConfigNumberKey; label: string; min: number; max: number }[] = [
  { key: 'maxClients', label: '允许连接的电脑数', min: 1, max: 32 },
  { key: 'maxConcurrentJobs', label: '并发求解数', min: 1, max: 8 },
  { key: 'queueCapacity', label: '队列容量', min: 4, max: 100 },
  { key: 'perClientActive', label: '每台在跑上限', min: 1, max: 8 },
  { key: 'perClientQueued', label: '每台排队上限', min: 0, max: 100 },
  { key: 'jobTimeoutSeconds', label: '任务超时（秒）', min: 30, max: 600 },
];

function draftOf(config: ServerConfig): ConfigDraft {
  return {
    bindAddress: config.bindAddress,
    maxClients: String(config.maxClients),
    maxConcurrentJobs: String(config.maxConcurrentJobs),
    queueCapacity: String(config.queueCapacity),
    perClientActive: String(config.perClientActive),
    perClientQueued: String(config.perClientQueued),
    jobTimeoutSeconds: String(config.jobTimeoutSeconds),
    allowedCidrs: (config.allowedCidrs ?? []).join(', '),
  };
}

function configPatch(draft: ConfigDraft): Partial<ServerConfig> {
  return {
    bindAddress: draft.bindAddress,
    maxClients: Number(draft.maxClients),
    maxConcurrentJobs: Number(draft.maxConcurrentJobs),
    queueCapacity: Number(draft.queueCapacity),
    perClientActive: Number(draft.perClientActive),
    perClientQueued: Number(draft.perClientQueued),
    jobTimeoutSeconds: Number(draft.jobTimeoutSeconds),
    allowedCidrs: draft.allowedCidrs
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

function ServerConfigCard({
  stats,
  config,
  effective,
  onSaved,
}: {
  stats: ServerStats;
  config: ServerConfig;
  effective: ServerEffective;
  onSaved: (result: ServerConfigResult) => void;
}) {
  const [draft, setDraft] = useState<ConfigDraft>(() => draftOf(config));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saveError, setSaveError] = useState('');
  const [savedAt, setSavedAt] = useState(0);

  useEffect(() => {
    if (saving || dirty) return;
    setDraft(draftOf(config));
  }, [config, dirty, saving]);

  useEffect(() => {
    if (!savedAt) return;
    const timer = window.setTimeout(() => setSavedAt(0), 3000);
    return () => window.clearTimeout(timer);
  }, [savedAt]);

  const updateDraft = (patch: Partial<ConfigDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
  };

  const save = async (override?: ConfigDraft) => {
    if (saving) return;
    const source = override ?? draft;
    setSaving(true);
    setSaveError('');
    try {
      const result = await updateServerConfig(configPatch(source));
      setDraft(draftOf(result.config));
      setDirty(false);
      setWarnings(result.warnings ?? []);
      setSavedAt(Date.now());
      onSaved(result);
    } catch (cause) {
      setWarnings([]);
      setSaveError(
        cause instanceof ApiError && cause.code === 'INVALID_CONFIG'
          ? '配置无效：' + cause.message
          : '保存失败：' + messageOf(cause),
      );
    } finally {
      setSaving(false);
    }
  };

  const lan = draft.bindAddress === 'lan';
  return (
    <section className="section-panel server-config-panel">
      <div className="panel-head">
        <SectionHeading english="LAN SHARING" title="局域网共享" />
        <span className={config.bindAddress === 'lan' ? 'status-tag' : 'status-tag muted'}>
          {config.bindAddress === 'lan' ? '局域网可访问' : '仅本机'}
        </span>
      </div>
      <div className="server-warning">局域网内不做身份验证：同网段任何人都能读写本工作区数据，请只在可信网络使用。</div>
      <div className="server-config-grid">
        <label className="server-field">
          <span>监听模式</span>
          <select
            value={draft.bindAddress}
            disabled={saving}
            onChange={(event) => updateDraft({ bindAddress: event.target.value === 'lan' ? 'lan' : 'loopback' })}
          >
            <option value="loopback">仅本机</option>
            <option value="lan">局域网</option>
          </select>
          <small>仅本机监听 127.0.0.1 · 局域网监听 0.0.0.0</small>
        </label>
        {CONFIG_NUMBER_FIELDS.map((field) => (
          <label className="server-field" key={field.key}>
            <span>{field.label}</span>
            <input
              type="number"
              min={field.min}
              max={field.max}
              step={1}
              value={draft[field.key]}
              disabled={saving}
              onChange={(event) => updateDraft({ [field.key]: event.target.value })}
            />
            <small>{field.min}–{field.max}</small>
          </label>
        ))}
        <label className="server-field server-field-wide">
          <span>允许网段</span>
          <input
            type="text"
            value={draft.allowedCidrs}
            disabled={saving}
            placeholder="留空 = 全部允许，例如 192.168.1.0/24, 10.0.0.0/8"
            onChange={(event) => updateDraft({ allowedCidrs: event.target.value })}
          />
          <small>逗号分隔的 IPv4 CIDR，留空 = 全部允许；请包含本机地址，否则页面会失去连接</small>
        </label>
      </div>
      {lan ? (
        <>
          <div className="server-address-chips">
            {stats.addresses.length === 0 ? (
              <span className="server-address-empty">未检测到局域网地址，请检查网络连接</span>
            ) : (
              stats.addresses.map((item, index) => {
                const url = 'http://' + item.address + ':' + stats.port;
                return (
                  <a key={item.name + ':' + item.address + ':' + index} className="server-address-chip" href={url} target="_blank" rel="noreferrer" title={item.name}>
                    {url}
                  </a>
                );
              })
            )}
          </div>
          <p className="server-config-hint">
            局域网内的电脑打开这个地址即可连接，无需验证。{config.bindAddress === 'lan' ? '' : '（保存后生效）'}
          </p>
        </>
      ) : null}
      <div className="server-config-actions">
        <button type="button" className="tt-btn tt-btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? '正在保存…' : '保存并应用'}
        </button>
        {savedAt > 0 ? <span className="server-saved">已应用</span> : null}
        {dirty ? <span className="status-tag muted">未保存</span> : null}
        {config.maxConcurrentJobs > effective.maxConcurrentJobs ? (
          <span className="server-config-hint">已按内存限制为 {effective.maxConcurrentJobs}</span>
        ) : null}
      </div>
      {warnings.length > 0 ? (
        <ul className="server-config-warnings">
          {warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {saveError ? <p className="server-save-error">{saveError}</p> : null}
      {config.bindAddress === 'loopback' ? (
        <p className="server-config-hint">
          当前仅监听 127.0.0.1（仅本机）。
          <button type="button" className="server-inline-btn" disabled={saving} onClick={() => void save({ ...draft, bindAddress: 'lan' })}>
            切换为局域网并保存
          </button>
        </p>
      ) : (
        <p className="server-config-hint">
          当前监听 0.0.0.0:{stats.port}，共 {stats.addresses.length} 个局域网地址。切换监听模式会短暂断连后自动恢复。
        </p>
      )}
    </section>
  );
}

function ServerClientsCard({
  clients,
  active,
  max,
  busyId,
  onDisconnect,
}: {
  clients: ServerClient[];
  active: number;
  max: number;
  busyId: string;
  onDisconnect: (id: string) => void;
}) {
  return (
    <section className="section-panel">
      <div className="panel-head">
        <SectionHeading english="CONNECTED COMPUTERS" title="已连接电脑" />
        <span className="status-tag muted">{active}/{max} 台</span>
      </div>
      {clients.length === 0 ? (
        <EmptyState title="还没有电脑连接" message="其他电脑连接本机地址并发出请求后，会显示在这里。" />
      ) : (
        <div className="table-scroll">
          <table className="server-job-table server-client-table">
            <thead>
              <tr><th>客户端</th><th>最近活动</th><th>任务</th><th>请求数</th><th>操作</th></tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id}>
                  <td>
                    <b>{client.idShort}</b>
                    <small>
                      {client.ip}
                      {client.anonymous ? <em className="server-client-tag">匿名</em> : null}
                    </small>
                  </td>
                  <td>{relativeTime(client.lastSeen)}</td>
                  <td>{client.running} 在跑 / {client.queued} 排队</td>
                  <td>{client.requests}</td>
                  <td>
                    <button type="button" className="tt-btn tt-btn-quiet" disabled={busyId === client.id} onClick={() => onDisconnect(client.id)}>
                      {busyId === client.id ? '断开中…' : '断开'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ServerPage({ apiOnline }: { apiOnline: boolean | null }) {
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [jobs, setJobs] = useState<ServerJob[]>([]);
  const [logs, setLogs] = useState<ServerLog[]>([]);
  const [clients, setClients] = useState<ServerClient[]>([]);
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [effective, setEffective] = useState<ServerEffective | null>(null);
  const [pollError, setPollError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyJobId, setBusyJobId] = useState('');
  const [busyClientId, setBusyClientId] = useState('');
  const sinceRef = useRef(0);
  const logRef = useRef<HTMLDivElement | null>(null);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const overview = await fetchServerOverview(sinceRef.current);
      setStats(overview.stats);
      setJobs(overview.jobs);
      setClients(overview.clients);
      setConfig(overview.config);
      setEffective(overview.effective);
      if (overview.logs.items.length > 0) {
        setLogs((current) => {
          const merged = new Map(current.map((item) => [item.seq, item]));
          for (const item of overview.logs.items) merged.set(item.seq, item);
          return Array.from(merged.values()).sort((a, b) => a.seq - b.seq).slice(-400);
        });
        sinceRef.current = Math.max(sinceRef.current, overview.logs.lastSeq);
      }
      setPollError((current) => (current ? '' : current));
    } catch (cause) {
      const next = '服务端监控连接失败：' + messageOf(cause);
      setPollError((current) => (current === next ? current : next));
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (!cancelled) void refresh();
    };
    void tick();
    const timer = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const cancelJob = async (id: string) => {
    if (busyJobId) return;
    setBusyJobId(id);
    setActionError('');
    try {
      await cancelServerJob(id);
      await refresh();
    } catch (cause) {
      setActionError(
        cause instanceof ApiError && cause.code === 'JOB_NOT_FOUND'
          ? '任务已结束，无法取消。'
          : '取消失败：' + messageOf(cause),
      );
    } finally {
      setBusyJobId('');
    }
  };

  const disconnectClient = async (id: string) => {
    if (busyClientId) return;
    setBusyClientId(id);
    setActionError('');
    try {
      await deleteServerClient(id);
      await refresh();
    } catch (cause) {
      if (cause instanceof ApiError && (cause.status === 409 || cause.code === 'CLIENT_BUSY')) {
        setActionError('无法断开：' + cause.message);
      } else if (cause instanceof ApiError && cause.code === 'NOT_FOUND') {
        setActionError('无法断开：该电脑已经离线。');
        await refresh();
      } else {
        setActionError('断开失败：' + messageOf(cause));
      }
    } finally {
      setBusyClientId('');
    }
  };

  const handleConfigSaved = (result: ServerConfigResult) => {
    setConfig(result.config);
    setEffective(result.effective);
    // A bind-mode switch closes the listener and re-opens it right after the
    // response; waiting a moment avoids a spurious "monitor failed" banner.
    window.setTimeout(() => {
      void refresh();
    }, result.rebinding ? 600 : 0);
  };

  const queueCount = stats ? stats.queue.queued + stats.queue.running : 0;
  return (
    <div className="server-layout">
      {pollError ? <Banner tone="error" title="服务端监控异常" onClose={() => setPollError('')}>{pollError}</Banner> : null}
      {actionError ? <Banner tone="error" title="操作未完成" onClose={() => setActionError('')}>{actionError}</Banner> : null}
      {apiOnline === false ? <Banner tone="warning" title="本地服务未连接">当前无法读取服务端状态，请先启动本地 API。</Banner> : null}
      {!stats ? (
        <div className="server-loading"><span className="kicker">// SERVER TELEMETRY</span><strong>正在读取本机服务端状态…</strong></div>
      ) : (
        <>
          <section className="section-panel server-panel">
            <div className="server-head">
              <div><span className="kicker">// SERVER TELEMETRY</span><h2>本机服务端</h2><p>监控本机资源、Java 求解器和排队中的排课任务；单机与局域网服务端使用同一套 Java 求解线路。</p></div>
              <div className="server-head-status">
                <span className={stats.solver.ready ? 'server-live' : 'server-live is-offline'}><i />{stats.solver.ready ? '服务在线' : '求解器未就绪'}</span>
                <button type="button" className="tt-btn tt-btn-quiet" onClick={() => void refresh()}>刷新</button>
              </div>
            </div>
            <div className="server-metrics">
              <article className="server-metric"><span>CPU 使用率</span><strong>{stats.cpu.usage}%</strong><small>{stats.cpu.cores} 核 · {stats.cpu.model}</small><div className="server-bar"><i style={{ width: stats.cpu.usage + '%' }} /></div></article>
              <article className="server-metric"><span>内存使用</span><strong>{stats.memory.usage}%</strong><small>{formatBytes(stats.memory.used)} / {formatBytes(stats.memory.total)}</small><div className="server-bar"><i style={{ width: stats.memory.usage + '%' }} /></div></article>
              <article className="server-metric"><span>任务队列</span><strong>{queueCount}</strong><small>运行 {stats.queue.running} · 等待 {stats.queue.queued} · 完成 {stats.queue.completed}</small><div className="server-bar is-queue"><i style={{ width: queueCount > 0 ? '100%' : '0%' }} /></div></article>
              <article className="server-metric"><span>服务运行时间</span><strong>{formatDuration(stats.uptimeSeconds)}</strong><small>OS 运行 {formatDuration(stats.osUptimeSeconds)}</small><div className="server-meta-inline">PID {stats.pid} · Node {stats.node}</div></article>
            </div>
            <div className="server-meta">
              <span><b>监听</b> {stats.host}:{stats.port}</span>
              <span><b>已连接</b> {stats.clients.active}/{stats.clients.max}</span>
              <span><b>Java</b> {stats.java.version ?? '未检测'}</span>
              <span><b>求解器</b> {stats.solver.engine} · {stats.solver.ready ? '就绪' : '未就绪'}</span>
              <span><b>系统</b> {stats.platform}/{stats.arch}</span>
            </div>
            {stats.warnings.length > 0 ? <div className="server-warning">{stats.warnings.join('；')}</div> : null}
          </section>
          {config && effective ? <ServerConfigCard stats={stats} config={config} effective={effective} onSaved={handleConfigSaved} /> : null}
          <ServerClientsCard clients={clients} active={stats.clients.active} max={stats.clients.max} busyId={busyClientId} onDisconnect={(id) => void disconnectClient(id)} />
          <section className="section-panel">
            <div className="panel-head">
              <SectionHeading english="TASK QUEUE" title="任务队列" />
              <span className={stats.queue.running > 0 ? 'status-tag' : 'status-tag muted'}>
                {stats.queue.running > 0 ? '正在求解' : '空闲'} · 运行 {stats.queue.running}/{stats.queue.concurrency} · 排队 {stats.queue.queued}/{stats.queue.capacity}
              </span>
            </div>
            {jobs.length === 0 ? <EmptyState title="还没有求解任务" message="在排课任务页发起一次排课，这里会显示队列、耗时和结果。" /> : (
              <div className="table-scroll">
                <table className="server-job-table is-wide">
                  <thead><tr><th>状态</th><th>任务</th><th>客户端</th><th>规模</th><th>耗时</th><th>结果</th><th>操作</th></tr></thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr key={job.id}>
                        <td><span className={'server-job-state is-' + job.status}><i />{jobStateLabel(job.status)}</span></td>
                        <td><b>{job.id}</b><small>{fmtTime(job.createdAt)}</small></td>
                        <td><span title={job.clientId ?? ''}>{shortClientId(job.clientId)}</span></td>
                        <td>{job.classes} 班 / {job.lessons} 课时</td>
                        <td>{job.elapsedMs > 0 ? Math.round(job.elapsedMs) + ' ms' : '—'}</td>
                        <td><span className={job.error ? 'server-job-result is-error' : 'server-job-result'}>{job.error ? job.error : (job.resultStatus ?? '—')}</span></td>
                        <td>
                          {job.status === 'queued' || job.status === 'running' ? (
                            <button type="button" className="tt-btn tt-btn-quiet" disabled={busyJobId === job.id} onClick={() => void cancelJob(job.id)}>
                              {busyJobId === job.id ? '取消中…' : '取消'}
                            </button>
                          ) : (
                            <span className="server-job-result">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="section-panel">
            <div className="panel-head"><SectionHeading english="SOLVER LOGS" title="求解状态日志" /><span className="server-live is-small"><i /> 实时 · 2s</span></div>
            <div className="server-log" ref={logRef}>
              {logs.length === 0 ? <div className="server-log-empty">等待服务端日志…</div> : logs.map((item) => (
                <div key={item.seq} className={'server-log-line is-' + item.level}>
                  <time>{new Date(item.at).toLocaleTimeString('zh-CN', { hour12: false })}</time>
                  <b>{item.level}</b>
                  <span>{item.message}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function SettingsPage({ runMode, theme, onThemeChange, onEditMode, apiOnline, data, commit }: { runMode: RunMode | null; theme: 'light' | 'dark'; onThemeChange: (theme: 'light' | 'dark') => void; onEditMode: () => void; apiOnline: boolean | null; data: SchoolData; commit: Commit }) {
  const mode = RUN_MODE_OPTIONS.find((item) => item.value === runMode);
  const endpoint = window.localStorage.getItem('warpweft-runtime-endpoint') || 'http://127.0.0.1:4317';
  return <div className="settings-layout"><Card className="business-card settings-card"><CardBody><SectionHeading english="RUNTIME" title="运行模式" /><p className="panel-note">决定数据和排课服务连接到哪里。修改后会重新连接工作区。</p><div className="settings-value"><span>当前模式</span><strong>{mode?.title ?? '未选择'}</strong><small>{mode?.english ?? 'NOT CONFIGURED'}</small></div><div className="settings-value"><span>服务地址</span><strong className="settings-endpoint">{endpoint}</strong></div><Button color="primary" onPress={onEditMode}>修改运行模式</Button></CardBody></Card><Card className="business-card settings-card"><CardBody><SectionHeading english="APPEARANCE" title="外观" /><p className="panel-note">调整工作台的显示主题。</p><Tabs selectedKey={theme} onSelectionChange={(key) => onThemeChange(String(key) as 'light' | 'dark')} aria-label="主题"><Tab key="light" title="浅色" /><Tab key="dark" title="深色" /></Tabs><div className="settings-value"><span>深色背景</span><strong>#1C1C1C</strong></div></CardBody></Card><Card className="business-card settings-card"><CardBody><SectionHeading english="WORKSPACE" title="当前工作区" /><label className="settings-value"><span>学校名称</span><input className="settings-input" value={data.school.name} onChange={(event) => commit({ ...data, school: { ...data.school, name: event.target.value } })} /></label><div className="settings-stats"><span>班级 <b>{data.classes.length}</b></span><span>教师 <b>{data.teachers.length}</b></span><span>教学计划 <b>{data.coursePlans.length}</b></span><span>服务状态 <Chip size="sm" color={apiOnline ? 'success' : 'warning'}>{apiOnline ? '在线' : apiOnline === false ? '离线' : '检测中'}</Chip></span></div><p className="panel-note">工作区数据由当前服务端管理。设置页不会自动填充演示数据。</p></CardBody></Card></div>;
}



function TimetablePage({
  data,
  result,
  report,
  view,
  setView,
  entityId,
  setEntityId,
  selectedEntryId,
  setSelectedEntryId,
  onSwap,
  onToggleLock,
  onUndo,
  canUndo,
  onRun,
  running,
  onInspect,
  onExportCsv,
  onExportExcel,
  onPrint,
}: {
  data: SchoolData;
  result: SolverOutput | null;
  report: InspectionReport | null;
  view: View;
  setView: (value: View) => void;
  entityId: string;
  setEntityId: (value: string) => void;
  selectedEntryId: string;
  setSelectedEntryId: (value: string) => void;
  onSwap: (entryId: string, slotId: string) => void;
  onToggleLock: (entryId: string) => void;
  onUndo: () => void;
  canUndo: boolean;
  onRun: () => void;
  running: boolean;
  onInspect: () => void;
  onExportCsv: () => void;
  onExportExcel: () => void;
  onPrint: () => void;
}) {
  const [dragId, setDragId] = useState('');
  const [dragOver, setDragOver] = useState('');
  const [focus, setFocus] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [swapMode, setSwapMode] = useState(false);
  const [weekFilter, setWeekFilter] = useState<'all' | 'odd' | 'even'>('all');
  const [weekNo, setWeekNo] = useState<number | null>(null);
  const [overlayDate, setOverlayDate] = useState(
    () => new URLSearchParams(window.location.search).get('adjustDate') || window.localStorage.getItem('warpweft-adjust-date') || '',
  );
  const overlay = focus || immersive;

  useEffect(() => {
    if (!overlay) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setImmersive(false);
        setFocus(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [overlay]);

  useEffect(() => {
    setSelectedEntryId('');
    setSwapMode(false);
  }, [view, entityId, setSelectedEntryId]);

  const days = Array.from(new Set(data.timeSlots.map((slot) => slot.day))).sort((a, b) => a - b);
  const periods = Array.from(new Set(data.timeSlots.map((slot) => slot.period))).sort((a, b) => a - b);
  const kindOfSlot = (slotId: string) => data.timeSlots.find((slot) => slot.id === slotId)?.kind ?? 'regular';
  const kindOfPeriod = (period: number) => data.timeSlots.find((slot) => slot.period === period)?.kind ?? 'regular';
  const hasCustomKinds = data.timeSlots.some((slot) => (slot.kind ?? 'regular') !== 'regular');
  const entities = view === 'class' ? data.classes : view === 'teacher' ? data.teachers : data.rooms;
  // Date overlay: show what actually happens on one date (base + adjustments).
  const baseEntries: ScheduleEntry[] = result
    ? overlayDate
      ? (effectiveEntries({ ...data, entries: result.entries }, overlayDate, data.adjustments ?? []) as unknown as ScheduleEntry[])
      : result.entries
    : [];
  const overlayCount = overlayDate ? (data.adjustments ?? []).filter((item) => item.status === 'active' && item.date === overlayDate).length : 0;
  const conflicts = report && !overlayDate ? new Set(report.summary.conflictEntryIds) : conflictIds(baseEntries, data.coursePlans);
  const selected = baseEntries.find((entry) => entry.id === selectedEntryId);
  const selectedPlan = selected ? planOf(data, selected) : undefined;
  const selectedSlot = selected ? data.timeSlots.find((slot) => slot.id === selected.slotId) : undefined;
  const selectedClass = selected ? findClass(data, selected.classId) : undefined;
  const selectedTeacher = selected ? findTeacher(data, selected.teacherId) : undefined;
  const selectedRoom = selected ? findRoom(data, selected.roomId) : undefined;
  const missing = result ? missingPlans(data, result) : [];
  const totalMissing = missing.reduce((sum, item) => sum + item.missing, 0);
  const viewLabel = view === 'class' ? '班级' : view === 'teacher' ? '教师' : '教室';
  const entityName = entities.find((item) => item.id === entityId)?.name ?? '';
  // Week parity: "odd"/"even" views hide lessons that do not run that week.
  const weeksOf = (entry: ScheduleEntry): string => entry.weeks ?? planOf(data, entry)?.weeks ?? 'all';
  const inWeek = (entry: ScheduleEntry) => weekFilter === 'all' || weeksOverlap(weeksOf(entry), weekFilter);
  const groupOfEntry = (entry: ScheduleEntry) =>
    entry.groupId ? (data.electiveGroups ?? []).find((group) => group.id === entry.groupId) : undefined;
  const blockOfEntry = (entry: ScheduleEntry) => groupOfEntry(entry)?.blocks.find((block) => block.id === entry.blockId);
  const subjectIdOfEntry = (entry: ScheduleEntry) => groupOfEntry(entry)?.subjectId ?? planOf(data, entry)?.subjectId;
  const subjectNameOfEntry = (entry: ScheduleEntry) => findSubject(data, subjectIdOfEntry(entry) ?? '')?.name ?? '未命名课程';
  const belongsHere = (entry: ScheduleEntry) => {
    if (view === 'class') return entry.classId === entityId || Boolean(groupOfEntry(entry)?.classIds.includes(entityId));
    if (view === 'teacher') return entry.teacherId === entityId;
    return entry.roomId === entityId;
  };
  const viewEntries = result ? baseEntries.filter(belongsHere).filter(inWeek) : [];
  // A class sees one elective lesson even though it is stored as several blocks.
  const electiveLessonKeys = new Set(
    viewEntries.filter((entry) => entry.groupId).map((entry) => entry.groupId + '|' + entry.slotId),
  );
  const viewLessonCount =
    view === 'class'
      ? viewEntries.filter((entry) => !entry.groupId).length + electiveLessonKeys.size
      : viewEntries.length;
  const planInWeek = (plan: CoursePlan) => weekFilter === 'all' || weeksOverlap(plan.weeks ?? 'all', weekFilter);
  const overlayWeekday = overlayDate ? weekdayOf(overlayDate) : 0;
  const overlayBaseCount =
    overlayDate && result
      ? result.entries.filter(
          (entry) =>
            data.timeSlots.find((slot) => slot.id === entry.slotId)?.day === overlayWeekday && belongsHere(entry),
        ).length
      : null;
  const overlayCancelled =
    overlayDate && result
      ? activeAdjustments(data.adjustments, overlayDate).filter((item) => {
          if (item.type !== 'cancel') return false;
          const base = result.entries.find((entry) => entry.id === item.originalEntryId);
          return base ? belongsHere(base) : false;
        }).length
      : 0;
  const electiveLoadForClass = (classId: string) =>
    (data.electiveGroups ?? [])
      .filter((group) => group.classIds.includes(classId))
      .reduce((sum, group) => sum + Number(group.weeklyPeriods || 0), 0);
  const electiveLoadForTeacher = (teacherId: string) =>
    (data.electiveGroups ?? [])
      .filter((group) => group.blocks.some((block) => block.teacherId === teacherId))
      .reduce((sum, group) => sum + Number(group.weeklyPeriods || 0), 0);
  const expectedForView =
    overlayBaseCount !== null
      ? overlayBaseCount
      : view === 'class'
        ? data.coursePlans.filter((plan) => plan.classId === entityId && planInWeek(plan)).reduce((sum, plan) => sum + Number(plan.weeklyPeriods || 0), 0) + electiveLoadForClass(entityId)
        : view === 'teacher'
          ? data.coursePlans.filter((plan) => plan.teacherId === entityId && planInWeek(plan)).reduce((sum, plan) => sum + Number(plan.weeklyPeriods || 0), 0) + electiveLoadForTeacher(entityId)
          : null;
  const missingForView =
    expectedForView === null ? null : overlayDate
      ? Math.max(0, expectedForView - viewLessonCount - overlayCancelled)
      : Math.max(0, expectedForView - viewLessonCount);
  const viewConflictCount = viewEntries.filter((entry) => conflicts.has(entry.id)).length;
  const viewFreeSlots = Math.max(0, data.timeSlots.length - viewLessonCount);
  const canMove = Boolean(selected) && view === 'class' && !selected?.locked && !selectedPlan?.fixedSlotId && !selected?.groupId && !overlayDate;
  const selectedGroup = selected ? groupOfEntry(selected) : undefined;
  const selectedBlock = selected ? blockOfEntry(selected) : undefined;
  const slotAt = (day: number, period: number) => data.timeSlots.find((slot) => slot.day === day && slot.period === period);
  const entriesAt = (slotId: string) => viewEntries.filter((entry) => entry.slotId === slotId);
  const dropContext = {
    data,
    entries: result?.entries ?? [],
    view,
    overlay: Boolean(overlayDate),
  };
  const canPlaceSelected = (slot: TimeSlot): boolean =>
    Boolean(selected) && Boolean(result) && canMove && checkMove(selected as ScheduleEntry, slot, dropContext).ok;
  const moveTargets = canMove ? data.timeSlots.filter((slot) => slot.id !== selected?.slotId && canPlaceSelected(slot)) : [];
  const canSwapSelectedWith = (targetEntry: ScheduleEntry): boolean =>
    Boolean(selected) && Boolean(result) && checkSwap(selected as ScheduleEntry, targetEntry, dropContext).ok;
  const swapTargets = selected && view === 'class' && result ? result.entries.filter(canSwapSelectedWith) : [];
  const swapTargetIds = new Set(swapTargets.map((entry) => entry.id));
  const moveLabel = selected ? planSubjectName(data, selectedPlan) : '';
  const draggedEntry = dragId ? baseEntries.find((entry) => entry.id === dragId) : undefined;
  const dragDecisionFor = (slot: TimeSlot | undefined, cellEntries: ScheduleEntry[]): { ok: boolean; reason: string } | null => {
    if (!draggedEntry || !slot || view !== 'class' || overlayDate) return null;
    if (cellEntries.length === 0) return checkMove(draggedEntry, slot, dropContext);
    if (cellEntries.length === 1) return checkSwap(draggedEntry, cellEntries[0], dropContext);
    return { ok: false, reason: '时间格内有多门课程，无法放置' };
  };

  if (!result) {
    return (
      <EmptyState
        title="还没有候选课表"
        message="先运行一次自动排课，候选课表会显示在这里；之后可以拖动课程、锁定位置并导出。"
        action={
          <button className="tt-btn tt-btn-primary" onClick={onRun} disabled={running}>
            {running ? '正在排课…' : '开始排课'} <span>↗</span>
          </button>
        }
      />
    );
  }

  return (
    <div
      className={'timetable-layout' + (focus ? ' is-focus' : '') + (immersive ? ' is-immersive' : '') + (swapMode ? ' is-swapping' : '')}
      role={overlay ? 'dialog' : undefined}
      aria-modal={overlay ? true : undefined}
      aria-label={immersive ? '沉浸式课表预览' : focus ? '全屏课表预览' : undefined}
    >
      <div className="tt-head">
        <div className="tt-head-copy">
          <span className="kicker">// TIMETABLE WORKSPACE</span>
          <h2>课表预览与手动调整</h2>
          <p>选择班级、教师或教室查看课表；在班级视图中拖动课程，或选中课程后点击空白时间格移动。</p>
        </div>
        <div className="tt-head-actions">
          <span className={'tt-status ' + (result.hasFeasibleSolution ? 'is-ok' : 'is-warn')}>
            <i />
            {result.status} · {result.entries.length} 课时
          </span>
          <button
            className="tt-btn tt-btn-quiet"
            onClick={() => setFocus((value) => !value)}
            aria-pressed={focus}
            title={focus ? '退出全屏（Esc）' : '放大到全屏查看和调整课表'}
          >
            {focus ? '退出全屏' : '全屏预览'}
          </button>
          <button className="tt-btn tt-btn-quiet" onClick={() => setImmersive(true)} title="隐藏状态栏和工具栏，最大化课表区域">
            隐藏工具栏
          </button>
          <button
            className={'tt-btn ' + (report && !report.ok ? 'tt-btn-primary' : 'tt-btn-quiet')}
            onClick={onInspect}
            title="打开最终课表报告（发布门禁）"
          >
            检测{report ? (report.ok ? '通过' : ' · ' + report.summary.hard + ' 项') : '报告'}
          </button>
          <button className="tt-btn tt-btn-primary" onClick={onRun} disabled={running}>
            {running ? '正在排课…' : '重新排课'}
          </button>
        </div>
      </div>

      <div className="tt-command">
        <div className="tt-view-tabs" role="tablist" aria-label="课表视图">
          {([['class', '班级'], ['teacher', '教师'], ['room', '教室']] as [View, string][]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              className={view === value ? 'active' : ''}
              onClick={() => setView(value)}
            >
              {label}视图
            </button>
          ))}
        </div>
        <div className="tt-view-tabs tt-week-tabs" role="tablist" aria-label="周次">
          {([['all', '全部'], ['odd', '单周'], ['even', '双周']] as ['all' | 'odd' | 'even', string][]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={weekFilter === value && weekNo === null}
              className={weekFilter === value && weekNo === null ? 'active' : ''}
              onClick={() => {
                setWeekFilter(value);
                setWeekNo(null);
                setSelectedEntryId('');
                setSwapMode(false);
              }}
              title={value === 'all' ? '显示每周都上的课和单双周课' : '只显示该周次会上的课'}
            >
              {label}
            </button>
          ))}
          {semesterWeeks(data.semester).length > 0 ? (
            <select
              className="tt-week-select"
              value={weekNo ?? ''}
              aria-label="按周次查看"
              onChange={(event) => {
                const next = event.target.value ? Number(event.target.value) : null;
                setWeekNo(next);
                setWeekFilter(next ? (next % 2 === 1 ? 'odd' : 'even') : 'all');
                setSelectedEntryId('');
                setSwapMode(false);
              }}
            >
              <option value="">按周次…</option>
              {semesterWeeks(data.semester).map((week) => (
                <option key={week.index} value={week.index}>{week.label}</option>
              ))}
            </select>
          ) : null}
        </div>
        {weekNo ? (() => {
          const week = semesterWeeks(data.semester).find((item) => item.index === weekNo);
          return week ? (
            <div className="tt-warning is-info">
              <b>第{weekNo}周 · {week.startDate} ~ {week.endDate}（{week.parity === 'odd' ? '单周' : '双周'}）</b>
              <span>当前只显示这一周会上的课程；单双周课程按周次序号过滤。</span>
            </div>
          ) : null;
        })() : null}
        <label className="tt-week-overlay" title="把所选日期的调课/代课/停课叠加到课表上查看">
          <input
            type="checkbox"
            checked={Boolean(overlayDate)}
            onChange={(event) => {
              const next = event.target.checked ? overlayDate || todayLocal() : '';
              setOverlayDate(next);
              try {
                window.localStorage.setItem('warpweft-adjust-date', next);
              } catch {
                // ignore
              }
              setSelectedEntryId('');
              setSwapMode(false);
            }}
          />
          叠加日期调整
        </label>
        {overlayDate ? (
          <input
            className="tt-date"
            type="date"
            value={overlayDate}
            onChange={(event) => {
              setOverlayDate(event.target.value);
              try {
                window.localStorage.setItem('warpweft-adjust-date', event.target.value);
              } catch {
                // ignore
              }
              setSelectedEntryId('');
            }}
          />
        ) : null}
        <label className="tt-entity">
          <span>{viewLabel}</span>
          <select value={entityId} onChange={(event) => setEntityId(event.target.value)}>
            {entities.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <div className="tt-command-spacer" />
        <div className="tt-stats" aria-label="课表统计">
          <span><b>{viewLessonCount}</b><em>已排</em></span>
          <span><b>{expectedForView ?? '—'}</b><em>计划</em></span>
          <span><b className={missingForView ? 'is-warn' : ''}>{missingForView ?? '—'}</b><em>未排</em></span>
          <span><b className={viewConflictCount ? 'is-danger' : ''}>{viewConflictCount}</b><em>硬冲突</em></span>
        </div>
        <div className="tt-command-actions">
          <button type="button" className="tt-btn tt-btn-quiet" onClick={onUndo} disabled={!canUndo}>
            撤销
          </button>
          <button type="button" className="tt-btn tt-btn-quiet" onClick={onExportCsv}>
            导出 CSV
          </button>
          <button type="button" className="tt-btn tt-btn-quiet" onClick={onExportExcel}>
            导出 Excel
          </button>
          <button type="button" className="tt-btn tt-btn-quiet" onClick={onPrint}>
            打印
          </button>
        </div>
      </div>

      <div className={'tt-selection' + (selected ? ' has-selection' : '')} aria-live="polite">
        {selected ? (
          <>
            <div className="tt-selection-copy">
              <span className="tt-selection-kicker">SELECTED LESSON</span>
              <strong>
                {selectedGroup
                  ? findSubject(data, selectedGroup.subjectId)?.name ?? '走班'
                  : planSubjectName(data, selectedPlan)}
              </strong>
              <span>
                {selectedGroup
                  ? selectedGroup.name +
                    ' · ' +
                    selectedGroup.classIds.map((classId) => findClass(data, classId)?.name ?? classId).join('、') +
                    ' · ' +
                    (selectedBlock?.name ?? '并行班')
                  : (selectedClass?.name ?? '') +
                    ' · ' +
                    (selectedTeacher?.name ?? '') +
                    ' · ' +
                    (selectedRoom?.name ?? '')}
                {' · '}
                {selectedSlot?.label ?? '未知时间'}
                {weeksOf(selected) === 'odd' ? ' · 单周' : weeksOf(selected) === 'even' ? ' · 双周' : ''}
              </span>
            </div>
            <div className="tt-selection-actions">
              {swapMode ? <span className={'tt-move-hint' + (swapTargets.length === 0 ? ' is-muted' : '')}>{swapTargets.length > 0 ? '交换模式：点击高亮课程（' + swapTargets.length + ' 个可交换）' : '交换模式：没有可交换的课程'}</span> : null}
              {!swapMode && canMove && moveTargets.length > 0 ? <span className="tt-move-hint">点击空白时间格移动（{moveTargets.length} 个可用）</span> : null}
              {!swapMode && canMove && moveTargets.length === 0 ? <span className="tt-move-hint is-muted" title="教师或教室在该时段已被占用；增加时间段或教师可释放空间">没有无冲突的移动目标</span> : null}
              {!swapMode && selected.locked ? <span className="tt-move-hint is-muted">已锁定，不可移动</span> : null}
              {!swapMode && selectedPlan?.fixedSlotId && !selected.locked ? <span className="tt-move-hint is-muted">固定时间，不可移动</span> : null}
              {!swapMode && selected.groupId ? <span className="tt-move-hint is-muted">走班课程由走班组统一安排，不能单独移动</span> : null}
              {view === 'class' && !overlayDate && !selected.groupId && !selected.locked && !selectedPlan?.fixedSlotId ? <button className={'tt-btn' + (swapMode ? ' tt-btn-primary' : '')} onClick={() => setSwapMode((value) => !value)}>{swapMode ? '退出交换' : '交换课程'}</button> : null}
              <button className="tt-btn tt-btn-primary" onClick={() => onToggleLock(selected.id)} disabled={Boolean(overlayDate) || Boolean(selected.groupId)} title={overlayDate ? '日期调整视图为只读' : selected.groupId ? '走班课程不能单独锁定' : undefined}>
                {selected.locked ? '解锁课程' : '锁定课程'}
              </button>
              <button className="tt-btn tt-btn-quiet" onClick={onUndo} disabled={!canUndo}>
                撤销
              </button>
              <button className="tt-btn tt-btn-quiet" onClick={() => setSelectedEntryId('')}>
                取消选择
              </button>
            </div>
          </>
        ) : (
          <span className="tt-selection-empty">
            点击课程查看详情；选中课程后可以在班级视图点击空白时间格移动，或使用拖动交换。
          </span>
        )}
      </div>

      {viewFreeSlots === 0 ? (
        <div className="tt-warning">
          <b>本视图已排满</b>
          <span>没有空档可用于移动。可在基础资料增加时间段或教师，或使用交换课程。</span>
        </div>
      ) : null}
      {missing.length ? (
        <div className="tt-warning">
          <b>还有 {totalMissing} 课时未排</b>
          <span>{missing.map((item) => (findClass(data, item.plan.classId)?.name ?? '') + ' ' + planSubjectName(data, item.plan)).join('；')}</span>
        </div>
      ) : null}

      {overlayDate ? (
        <div className="tt-warning is-info">
          <b>正在查看 {overlayDate}（{DAYS[weekdayOf(overlayDate)] ?? '未知'}）的课表</b>
          <span>
            已叠加 {overlayCount} 条调整；此视图只读，修改请到「调代课」页。
            {data.coursePlans.some((plan) => (plan.weeks ?? 'all') !== 'all')
              ? ' 未设置学期起始周，单双周课程会同时显示，请用周次筛选查看。'
              : ''}
          </span>
        </div>
      ) : null}

      <div className="tt-board">
        <div className="tt-board-scroll" style={{ ['--tt-rows' as string]: Math.max(periods.length, 1) } as React.CSSProperties}>
          <table className="tt-table">
            <thead>
              <tr>
                <th className="tt-period-head">
                  <span>节次</span>
                  <small>PERIOD</small>
                </th>
                {days.map((day) => (
                  <th key={day} className="tt-day-head">
                    <span>{DAYS[day] ?? '第' + day + '天'}</span>
                    <small>DAY {String(day).padStart(2, '0')}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map((period, periodIndex) => {
                const periodKind = kindOfPeriod(period);
                const previousKind = periodIndex > 0 ? kindOfPeriod(periods[periodIndex - 1]) : null;
                return (
                  <React.Fragment key={period}>
                    {hasCustomKinds && periodKind !== previousKind ? (
                      <tr className={'tt-kind-row is-' + periodKind}>
                        <th colSpan={days.length + 1}>
                          <span>{KIND_LABELS[periodKind] ?? periodKind}</span>
                        </th>
                      </tr>
                    ) : null}
                    <tr key={period} className={'tt-period-row is-' + periodKind}>
                  <th className="tt-period-cell">
                    <span>第{period}节</span>
                    <small>P{period}</small>
                  </th>
                  {days.map((day) => {
                    const slot = slotAt(day, period);
                    const cellEntries = slot ? entriesAt(slot.id) : [];
                    const isDragOver = dragOver === slot?.id;
                    const dragDecision = dragDecisionFor(slot, cellEntries);
                    const moveHere = Boolean(slot) && canMove && cellEntries.length === 0 && (slot ? canPlaceSelected(slot) : false);
                    return (
                      <td
                        key={day + '-' + period}
                        data-slot-id={slot?.id ?? ''}
                        className={
                          'tt-cell' +
                          (cellEntries.length ? ' is-filled' : ' is-empty') +
                          (isDragOver ? ' is-drop' : '') +
                          (moveHere ? ' can-move' : '') +
                          (dragDecision && dragId ? (dragDecision.ok ? ' is-drag-ok' : ' is-drag-bad') : '')
                        }
                        title={dragDecision && dragId ? (dragDecision.ok ? '可用：松开移动到这里' : '不可用：' + dragDecision.reason) : moveHere && selected ? '把「' + moveLabel + '」移动到这里' : undefined}
                        onDragOver={(event) => {
                          if (view !== 'class' || !slot) return;
                          event.preventDefault();
                          if (dragDecision) event.dataTransfer.dropEffect = dragDecision.ok ? 'move' : 'none';
                          setDragOver(slot.id);
                        }}
                        onDragLeave={() => setDragOver('')}
                        onDrop={(event) => {
                          if (view !== 'class' || !slot) return;
                          event.preventDefault();
                          if (dragDecision && !dragDecision.ok) {
                            setDragOver('');
                            setDragId('');
                            return;
                          }
                          const entryId = event.dataTransfer.getData('text/plain') || dragId;
                          setDragOver('');
                          setDragId('');
                          if (entryId) onSwap(entryId, slot.id);
                        }}
                        onClick={() => {
                          if (cellEntries.length > 0) return;
                          if (moveHere && selected && slot) onSwap(selected.id, slot.id);
                          else if (!canMove) setSelectedEntryId('');
                        }}
                      >
                        {dragDecision && dragId && isDragOver ? (
                          <span className={'tt-drop-badge ' + (dragDecision.ok ? 'ok' : 'bad')} role="status">
                            {dragDecision.ok ? '可用' : '不可用'}
                          </span>
                        ) : null}
                        {cellEntries.length ? (
                          <>
                          {(view === 'class' ? cellEntries.filter((entry) => !entry.groupId) : cellEntries).map((entry) => {
                            const plan = planOf(data, entry);
                            const electiveGroup = groupOfEntry(entry);
                            const electiveBlock = blockOfEntry(entry);
                            const isConflict = conflicts.has(entry.id);
                            const teacher = findTeacher(data, entry.teacherId)?.name ?? '';
                            const room = findRoom(data, entry.roomId)?.name ?? '';
                            const className = electiveGroup ? electiveGroup.name : findClass(data, entry.classId)?.name ?? '';
                            return (
                              <button
                                key={entry.id}
                                type="button"
                                data-entry-id={entry.id}
                                className={
                                  'tt-card' +
                                  (entry.locked ? ' is-locked' : '') +
                                  (isConflict ? ' is-conflict' : '') +
                                  (entry.id === selectedEntryId ? ' is-selected' : '') +
                                  (swapMode && swapTargetIds.has(entry.id) ? ' is-swap-target' : '')
                                }
                                draggable={view === 'class' && !entry.locked && !overlayDate && !entry.groupId}
                                aria-pressed={entry.id === selectedEntryId}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (swapMode && selected && view === 'class') {
                                    if (swapTargetIds.has(entry.id)) {
                                      onSwap(selected.id, entry.slotId);
                                      setSwapMode(false);
                                    }
                                    return;
                                  }
                                  setSelectedEntryId(entry.id);
                                }}
                                onDragStart={(event) => {
                                  if (view !== 'class' || entry.locked || entry.groupId) {
                                    event.preventDefault();
                                    return;
                                  }
                                  event.dataTransfer.effectAllowed = 'move';
                                  event.dataTransfer.setData('text/plain', entry.id);
                                  setDragId(entry.id);
                                }}
                                onDragEnd={() => setDragId('')}
                                title={
                                  entry.groupId
                                    ? '走班课程由走班组统一安排，不能单独拖动'
                                    : entry.locked
                                      ? '已锁定，重新排课时保留位置'
                                      : view === 'class'
                                        ? '拖动课程交换时间，或选中后点击空白格移动'
                                        : subjectNameOfEntry(entry)
                                }
                              >
                                <span className="tt-card-top">
                                  <span className="tt-card-subject">{subjectNameOfEntry(entry)}</span>
                                  {entry.groupId ? <span className="tt-card-lock">走班</span> : null}
                                  {entry.locked ? <span className="tt-card-lock">锁定</span> : null}
                                </span>
                                <span className="tt-card-meta">
                                  {view === 'class'
                                    ? teacher + ' · ' + room
                                    : view === 'teacher'
                                      ? className + ' · ' + room
                                      : className + ' · ' + teacher}
                                </span>
                                {entry.source === 'MANUAL' || isConflict || weeksOf(entry) !== 'all' || entry.groupId ? (
                                  <span className="tt-card-badges">
                                    {weeksOf(entry) === 'odd' ? <em>单周</em> : weeksOf(entry) === 'even' ? <em>双周</em> : null}
                                    {entry.groupId ? <em>走班{electiveBlock ? '·' + electiveBlock.name : ''}</em> : null}
                                    {entry.source === 'MANUAL' ? <em>手工</em> : null}
                                    {isConflict ? <em className="is-danger">硬冲突</em> : null}
                                  </span>
                                ) : null}
                              </button>
                            );
                          })}
                          {view === 'class'
                            ? Array.from(
                                new Map(
                                  cellEntries
                                    .filter((entry) => entry.groupId)
                                    .map((entry) => [entry.groupId as string, cellEntries.filter((item) => item.groupId === entry.groupId)]),
                                ),
                              ).map(([groupId, list]) => {
                                const group = (data.electiveGroups ?? []).find((item) => item.id === groupId);
                                const first = list[0];
                                const clash = list.some((entry) => conflicts.has(entry.id));
                                return (
                                  <button
                                    key={'elective-' + groupId}
                                    type="button"
                                    className={
                                      'tt-card is-elective' +
                                      (clash ? ' is-conflict' : '') +
                                      (first.id === selectedEntryId ? ' is-selected' : '')
                                    }
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setSelectedEntryId(first.id);
                                    }}
                                    title="走班组统一安排：组内并行班同时上课，行政班在该时段让出"
                                  >
                                    <span className="tt-card-top">
                                      <span className="tt-card-subject">{findSubject(data, group?.subjectId ?? '')?.name ?? '走班'}</span>
                                      <span className="tt-card-lock">走班</span>
                                    </span>
                                    <span className="tt-card-meta">
                                      {(group?.blocks.length ?? list.length)} 个并行班 · {list.map((entry) => findTeacher(data, entry.teacherId)?.name ?? '').join(' / ')}
                                    </span>
                                    <span className="tt-card-badges">
                                      <em>走班</em>
                                      {clash ? <em className="is-danger">硬冲突</em> : null}
                                    </span>
                                  </button>
                                );
                              })
                            : null}
                          </>
                        ) : (
                          <span className="tt-empty">
                            {moveHere ? (
                              <>
                                <b>+</b>
                                <em>移动到这里</em>
                              </>
                            ) : (
                              '·'
                            )}
                          </span>
                        )}
                      </td>
                    );
                  })}
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="tt-footer">
        <div className="tt-legend">
          <span><i className="tt-dot is-normal" />普通课程</span>
          <span><i className="tt-dot is-locked" />已锁定</span>
          <span><i className="tt-dot is-conflict" />硬冲突</span>
          <span><i className="tt-dot is-manual" />手工调整</span>
        </div>
        <span className="tt-footer-note">
          {hasCustomKinds ? (
            <>
              {['morning', 'regular', 'evening', 'makeup'].map((kind) => {
                const count = viewEntries.filter((entry) => kindOfSlot(entry.slotId) === kind).length;
                if (count === 0 && kind !== 'regular') return null;
                return (KIND_LABELS[kind] ?? kind) + ' ' + count + ' · ';
              })}
            </>
          ) : null}
          本视图空档 {viewFreeSlots} 个 · 拖动课程可交换位置 · 锁定后重新排课保留原时间
        </span>
      </div>
      {immersive ? (
        <div className="tt-immersive-bar">
          <span><b>{entityName}</b> · {viewLabel}视图 · {viewEntries.length} 课时</span>
          <button type="button" className="tt-btn tt-btn-quiet" onClick={() => setImmersive(false)}>显示工具栏</button>
          <button type="button" className="tt-btn tt-btn-quiet" onClick={() => { setImmersive(false); setFocus(false); }}>退出</button>
        </div>
      ) : null}
    </div>
  );
}

function ReleasePage({
  data,
  result,
  report,
  onInspect,
  onPublish,
  onClear,
  onExportCsv,
  onExportExcel,
  onPrint,
}: {
  data: SchoolData;
  result: SolverOutput | null;
  report: InspectionReport | null;
  onInspect: () => void;
  onPublish: () => void;
  onClear: () => void;
  onExportCsv: () => void;
  onExportExcel: () => void;
  onPrint: () => void;
}) {
  const exportable = result ?? data.published ?? null;
  const blocked = Boolean(result) && Boolean(report) && !report!.ok;
  return (
    <div className="release-layout">
      <section className="section-panel">
        <SectionHeading english="RELEASE" title="发布与导出" />
        <p className="panel-note">候选课表通过检测后，可保存为正式版并导出 Excel、CSV 或打印。</p>
        <div className="summary-grid">
          <div>
            <span>候选状态</span>
            <b>{result?.status ?? '无'}</b>
          </div>
          <div>
            <span>候选课时</span>
            <b>{result?.entries.length ?? 0}</b>
          </div>
          <div>
            <span>检测结论</span>
            <b className={blocked ? 'is-danger' : ''}>
              {!result ? '—' : !report ? '未检测' : report.ok ? '通过' : '未通过'}
            </b>
          </div>
          <div>
            <span>正式版</span>
            <b>{data.published ? '已保存' : '未发布'}</b>
          </div>
        </div>
        <div className={'release-gate ' + (blocked ? 'is-blocked' : result && report?.ok ? 'is-ready' : '')}>
          <div>
            <b>{blocked ? '发布被检测结果阻断' : result && report?.ok ? '检测通过，可以发布' : '尚未生成可发布的候选课表'}</b>
            <small>
              {report
                ? report.summary.hard +
                  ' 项硬冲突 · ' +
                  report.summary.must +
                  ' 条必须规则 · ' +
                  report.summary.prefer +
                  ' 条尽量规则 · 未排 ' +
                  report.summary.unplaced +
                  ' 课时'
                : '运行排课后会自动生成检测报告。'}
            </small>
          </div>
          <button className="ghost-button" onClick={onInspect} disabled={!result}>
            查看检测报告
          </button>
        </div>
        <div className="export-row">
          <button onClick={onExportCsv} disabled={!exportable}>
            导出 CSV
          </button>
          <button onClick={onExportExcel} disabled={!exportable}>
            导出 Excel
          </button>
          <button onClick={onPrint} disabled={!result}>
            打印课表
          </button>
        </div>
        <div className="hero-actions">
          <button
            className="action-button"
            onClick={onPublish}
            disabled={!result || blocked}
            title={blocked ? '存在硬冲突或必须规则违反，先处理检测报告中的问题' : undefined}
          >
            保存为正式版 <span>↗</span>
          </button>
          <button className="ghost-button" onClick={onClear} disabled={!result}>
            清空候选
          </button>
        </div>
        {blocked ? (
          <p className="panel-note">
            门禁规则：存在硬冲突或「必须」规则违反时不能发布；「尽量」规则只提示，不阻断。
          </p>
        ) : null}
        <div className="version-history"><h3>正式版版本与审计</h3>{(data.publishedVersions ?? []).length === 0 ? <p className="panel-note">尚无正式版发布记录。</p> : <ol>{(data.publishedVersions ?? []).slice().reverse().map((version) => <li key={version.id}><strong>{version.id}</strong><span>{fmtTime(version.createdAt)} · {version.result.entries.length} 课时</span></li>)}</ol>}</div>
      </section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<HeroUIProvider><App /></HeroUIProvider>);






























