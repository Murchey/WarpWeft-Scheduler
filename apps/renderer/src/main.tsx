import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HeroUIProvider, Button, Card, CardBody, Chip, Progress, Select, SelectItem, Tabs, Tab } from '@heroui/react';
import { validateInput } from '../../../packages/validation/src';
import { exportCsv, exportWorkbook, readWorkbook } from '../../../packages/import-export/src';
import { loadData, saveData, solveSchedule } from './api';
import type {
  ClassRoom,
  CoursePlan,
  Room,
  ScheduleEntry,
  SchoolData,
  SolverInput,
  SolverOutput,
  Subject,
  Teacher,
  TimeSlot,
  RunMode,
} from './types';
import './style.css';

const TABS = ['工作台', '基础资料', '教学计划', '排课任务', '课表预览', '报表发布', '设置'] as const;
type Tab = (typeof TABS)[number];
const EN: Record<Tab, string> = {
  工作台: 'OVERVIEW',
  基础资料: 'RESOURCES',
  教学计划: 'COURSE PLANS',
  排课任务: 'SCHEDULE RUNS',
  课表预览: 'TIMETABLE PREVIEW',
  报表发布: 'RELEASE',
  设置: 'SETTINGS',
};
const DAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error';
type View = 'class' | 'teacher' | 'room';
type Commit = (next: SchoolData, options?: { invalidate?: boolean; immediate?: boolean }) => void;
type RunPhase = 'idle' | 'checking' | 'preparing' | 'solving' | 'finalizing' | 'completed' | 'failed';
interface RunProgress { phase: RunPhase; message: string; startedAt?: number; }

const RUN_STEPS: { phase: RunPhase; label: string }[] = [
  { phase: 'checking', label: '检查' },
  { phase: 'preparing', label: '准备' },
  { phase: 'solving', label: '计算' },
  { phase: 'finalizing', label: '保存' },
  { phase: 'completed', label: '完成' },
];


const RUN_MODE_OPTIONS: { value: RunMode; title: string; english: string; description: string; endpoint: string }[] = [
  { value: 'single', title: '单机', english: 'SINGLE MACHINE', description: '数据和 Solver 都运行在本机，适合个人教务工作站。', endpoint: 'http://127.0.0.1:4317' },
  { value: 'lan-server', title: '局域网（服务端）', english: 'LAN SERVER', description: '本机作为局域网服务端，其他电脑可连接此工作区。', endpoint: 'http://127.0.0.1:4317' },
  { value: 'lan-client', title: '局域网（客户端）', english: 'LAN CLIENT', description: '连接局域网内另一台 WarpWeft 服务端。', endpoint: 'http://127.0.0.1:4317' },
  { value: 'cloud', title: '链接云端', english: 'CLOUD', description: '连接远程部署的 WarpWeft API。', endpoint: 'https://' },
];

function RuntimeModeDialog({ current, onSave, onClose }: { current: RunMode | null; onSave: (mode: RunMode, endpoint: string) => void; onClose?: () => void }) {
  const [mode, setMode] = useState<RunMode>(current ?? 'single');
  const selected = RUN_MODE_OPTIONS.find((item) => item.value === mode)!;
  const [endpoint, setEndpoint] = useState(() => window.localStorage.getItem('warpweft-runtime-endpoint') || selected.endpoint);
  const endpointValid = (() => { try { const url = new URL(endpoint); return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.host); } catch { return false; } })();
  useEffect(() => { setEndpoint(window.localStorage.getItem('warpweft-runtime-endpoint') || selected.endpoint); }, [mode]);
  return <div className="mode-overlay" role="dialog" aria-modal="true"><div className="mode-dialog"><div className="mode-dialog-head"><span className="kicker">// RUNTIME MODE</span>{onClose ? <button className="banner-close" onClick={onClose} aria-label="关闭设置">×</button> : null}</div><h2>{current ? '运行模式设置' : '选择运行模式'}</h2><p className="mode-lead">先选择数据和排课服务的运行位置，之后可以在设置中修改。</p><div className="mode-options">{RUN_MODE_OPTIONS.map((item) => <button key={item.value} className={'mode-option' + (mode === item.value ? ' selected' : '')} onClick={() => setMode(item.value)}><span className="mode-option-index">0{RUN_MODE_OPTIONS.indexOf(item) + 1}</span><span><b>{item.title}</b><em>{item.english}</em><small>{item.description}</small></span></button>)}</div><label className="mode-endpoint">服务地址<input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="http://192.168.1.20:4317" /><small>{mode === 'single' || mode === 'lan-server' ? '本机模式使用默认地址即可。' : '请输入可访问的服务端 API 地址。'}{endpoint && !endpointValid ? ' 地址格式无效。' : ''}</small></label><div className="mode-actions"><button className="ghost-button" onClick={onClose} disabled={!current}>取消</button><button className="action-button" disabled={!endpointValid} onClick={() => onSave(mode, endpoint)}>{current ? '保存设置' : '进入工作台'} <span>↗</span></button></div></div></div>;
}

function uid(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return prefix + '-' + random.slice(0, 8);
}

function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
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

function findClass(data: SchoolData, id: string): ClassRoom | undefined {
  return data.classes.find((item) => item.id === id);
}
function findTeacher(data: SchoolData, id: string): Teacher | undefined {
  return data.teachers.find((item) => item.id === id);
}
function findRoom(data: SchoolData, id: string): Room | undefined {
  return data.rooms.find((item) => item.id === id);
}
function findSubject(data: SchoolData, id: string): Subject | undefined {
  return data.subjects.find((item) => item.id === id);
}
function planOf(data: SchoolData, entry: ScheduleEntry): CoursePlan | undefined {
  return data.coursePlans.find((item) => item.id === entry.coursePlanId);
}
function planSubjectName(data: SchoolData, plan?: CoursePlan): string {
  if (!plan) return '未命名课程';
  return findSubject(data, plan.subjectId)?.name ?? '未命名课程';
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
    rooms: data.rooms,
    coursePlans: data.coursePlans,
    unavailableSlots: data.unavailableSlots ?? [],
    lockedEntries: locked,
    hardConstraints: ['NO_CLASS_CONFLICT', 'NO_TEACHER_CONFLICT', 'ROOM_CAPACITY'],
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
  for (const item of data.classes) {
    const load = data.coursePlans
      .filter((plan) => plan.classId === item.id)
      .reduce((sum, plan) => sum + Number(plan.weeklyPeriods || 0), 0);
    if (load > slotCount) {
      issues.push(item.name + ' 的周课时 ' + load + ' 超过可用时间格 ' + slotCount);
    }
  }
  for (const item of data.teachers) {
    const load = data.coursePlans
      .filter((plan) => plan.teacherId === item.id)
      .reduce((sum, plan) => sum + Number(plan.weeklyPeriods || 0), 0);
    if (load > slotCount) {
      issues.push(item.name + ' 的周课时 ' + load + ' 超过可用时间格 ' + slotCount);
    }
  }
  for (const plan of data.coursePlans) {
    if (!findSubject(data, plan.subjectId)) {
      issues.push('教学计划 ' + plan.id + ' 引用了不存在的学科');
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
  const fixed = new Map<string, string>();
  for (const plan of data.coursePlans) {
    if (!plan.fixedSlotId) continue;
    for (const key of ['c:' + plan.classId + ':' + plan.fixedSlotId, 't:' + plan.teacherId + ':' + plan.fixedSlotId]) {
      const prior = fixed.get(key);
      if (prior) issues.push('固定时间冲突：' + prior + ' 与 ' + plan.id);
      else fixed.set(key, plan.id);
    }
  }
  return Array.from(new Set(issues));
}

function conflictIds(entries: ScheduleEntry[]): Set<string> {
  const groups = new Map<string, string[]>();
  for (const entry of entries) {
    for (const key of [
      'class:' + entry.classId + ':' + entry.slotId,
      'teacher:' + entry.teacherId + ':' + entry.slotId,
      'room:' + entry.roomId + ':' + entry.slotId,
    ]) {
      const list = groups.get(key) ?? [];
      list.push(entry.id);
      groups.set(key, list);
    }
  }
  const ids = new Set<string>();
  for (const list of groups.values()) {
    if (list.length > 1) list.forEach((id) => ids.add(id));
  }
  return ids;
}

function missingPlans(data: SchoolData, result: SolverOutput): { plan: CoursePlan; missing: number }[] {
  return data.coursePlans
    .map((plan) => ({
      plan,
      missing:
        Number(plan.weeklyPeriods || 0) -
        result.entries.filter((entry) => entry.coursePlanId === plan.id).length,
    }))
    .filter((item) => item.missing > 0);
}

function exportRows(data: SchoolData, result: SolverOutput): Record<string, string | number>[] {
  return result.entries.map((entry) => {
    const plan = planOf(data, entry);
    const slot = data.timeSlots.find((item) => item.id === entry.slotId);
    return {
      班级: findClass(data, entry.classId)?.name ?? entry.classId,
      星期: DAYS[slot?.day ?? 0] ?? '',
      节次: slot?.period ?? '',
      课程: planSubjectName(data, plan),
      教师: findTeacher(data, entry.teacherId)?.name ?? entry.teacherId,
      教室: findRoom(data, entry.roomId)?.name ?? entry.roomId,
      来源: entry.source === 'MANUAL' ? '手工' : '自动',
      锁定: entry.locked ? '是' : '否',
    };
  });
}

function download(content: BlobPart, type: string, filename: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SectionHeading({ english, title }: { english: string; title: string }) {
  return (
    <div className="section-heading">
      <span className="kicker">// {english}</span>
      <h2>{title}</h2>
    </div>
  );
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

function EmptyState({ title, message, action }: { title: string; message: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <span>00</span>
      <p>
        <b>{title}</b>
        <br />
        {message}
      </p>
      {action}
    </div>
  );
}

type Column<T> = {
  key: keyof T & string;
  label: string;
  type?: 'text' | 'number' | 'select';
  options?: { value: string; label: string }[];
  width?: string;
};

function EditableTable<T extends { id: string }>({
  title,
  english,
  rows,
  columns,
  onChange,
  onAdd,
  onRemove,
  addLabel,
  note,
}: {
  title: string;
  english: string;
  rows: T[];
  columns: Column<T>[];
  onChange: (id: string, key: string, value: string | number) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  addLabel: string;
  note?: string;
}) {
  return (
    <section className="section-panel resource-panel">
      <div className="panel-head">
        <SectionHeading english={english} title={title} />
        <button className="mini-button" onClick={onAdd}>
          + {addLabel}
        </button>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} style={{ width: column.width }}>
                  {column.label}
                </th>
              ))}
              <th className="action-column">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="table-empty" colSpan={columns.length + 1}>
                  暂无数据，点击右上角新增。
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  {columns.map((column) => (
                    <td key={column.key}>
                      {column.type === 'select' ? (
                        <select
                          value={String(row[column.key] ?? '')}
                          onChange={(event) => onChange(row.id, column.key, event.target.value)}
                        >
                          {column.options?.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={column.type === 'number' ? 'number' : 'text'}
                          min={column.type === 'number' ? 0 : undefined}
                          value={String(row[column.key] ?? '')}
                          onChange={(event) =>
                            onChange(
                              row.id,
                              column.key,
                              column.type === 'number' ? Number(event.target.value) : event.target.value,
                            )
                          }
                        />
                      )}
                    </td>
                  ))}
                  <td className="action-column">
                    <button className="danger-link" onClick={() => onRemove(row.id)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {note ? <p className="panel-note">{note}</p> : null}
    </section>
  );
}

function RunProgressView({ progress }: { progress: RunProgress }) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!progress.startedAt || progress.phase === 'completed' || progress.phase === 'failed' || progress.phase === 'idle') return;
    const timer = window.setInterval(() => forceTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [progress.phase, progress.startedAt]);
  const activeIndex = progress.phase === 'failed' ? 2 : progress.phase === 'idle' ? -1 : RUN_STEPS.findIndex((step) => step.phase === progress.phase);
  return (
    <div className={'run-progress ' + progress.phase} aria-live="polite">
      <div className="run-progress-head">
        <div><span className="kicker">// SCHEDULE PROGRESS</span><strong>{progress.message}</strong></div>
        {progress.startedAt ? <small>{Math.max(0, Math.round((Date.now() - progress.startedAt) / 1000))}s</small> : null}
      </div>
      <div className="run-progress-track">
        {RUN_STEPS.map((step, index) => <div key={step.phase} className={'run-progress-step' + (index <= activeIndex ? ' active' : '') + (step.phase === progress.phase ? ' current' : '')}><i /> <span>{step.label}</span></div>)}
      </div>
      <Progress className="hero-ui-progress" size="sm" aria-label="排课阶段进度" value={activeIndex < 0 ? 0 : ((activeIndex + 1) / RUN_STEPS.length) * 100} color={progress.phase === 'failed' ? 'danger' : 'primary'} />
      {progress.phase === 'solving' ? <div className="run-progress-pulse" /> : null}
    </div>
  );
}

function EmptyDataScreen({ message, onRetry, onSettings }: { message: string; onRetry: () => void; onSettings: () => void }) {
  return <div className="empty-data-screen"><div className="empty-data-mark">W</div><span className="kicker">// WORKSPACE NOT LOADED</span><h1>还没有加载工作区</h1><p>{message || '请启动本地服务，或检查运行模式中的服务地址。'}</p><div className="hero-actions"><button className="action-button" onClick={onRetry}>重新连接 <span>↗</span></button><button className="ghost-button" onClick={onSettings}>打开设置</button></div></div>;
}

function App() {
  const params = new URLSearchParams(window.location.search);
  const initialTab = params.get('tab');
  const initialTheme = params.get('theme');
  const [tab, setTab] = useState<Tab>(
    initialTab && (TABS as readonly string[]).includes(initialTab) ? (initialTab as Tab) : '工作台',
  );
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (initialTheme === 'dark' || initialTheme === 'light') return initialTheme;
    const saved = window.localStorage.getItem('warpweft-theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [runMode, setRunMode] = useState<RunMode | null>(() => {
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
      setTab('课表预览');
      if (output.hasFeasibleSolution) {
        setProgress({ phase: 'completed', message: '排课完成：共 ' + output.entries.length + ' 条课表', startedAt: Date.now() });
        setNotice('排课完成：共 ' + output.entries.length + ' 条课表');
      } else {
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
    const blocking = result.entries.find((entry) => entry.id !== moving.id && entry.id !== target?.id && entry.slotId === targetSlotId && (
      entry.teacherId === moving.teacherId || entry.roomId === moving.roomId
    ));
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
    const conflicts = conflictIds(entries);
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

  const publish = () => {
    if (!data || !result) return;
    const version = { id: uid('version'), createdAt: new Date().toISOString(), result, note: '手动发布' };
    const audit = { id: uid('audit'), at: version.createdAt, action: 'PUBLISH', detail: `发布课表 ${version.id}` };
    commit({ ...data, published: result, publishedVersions: [...(data.publishedVersions ?? []), version], auditLog: [...(data.auditLog ?? []), audit] }, { immediate: true });
    setNotice('当前候选课表已保存为正式版');
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

  const exportCsvFile = () => {
    if (!data) return;
    const target = result ?? data.published;
    if (!target) return;
    const csv = exportCsv(exportRows(data, target));
    download(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), 'text/csv', 'warpweft-timetable.csv');
  };

  const exportExcelFile = () => {
    if (!data) return;
    const target = result ?? data.published;
    if (!target) return;
    const bytes = exportWorkbook({
      课表: exportRows(data, target),
      元数据: [
        { 项目: '学校', 值: data.school.name },
        { 项目: '导出时间', 值: new Date().toLocaleString('zh-CN') },
        { 项目: '课表状态', 值: target.status },
      ],
    });
    download(
      new Blob([bytes.buffer as ArrayBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'warpweft-timetable.xlsx',
    );
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
          {TABS.map((item, index) => (
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
      <main className="workspace">
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
            onPrepare={() => setTab('排课任务')}
            onTimetable={() => setTab('课表预览')}
          />
        ) : null}
        {tab === '基础资料' ? <ResourcesPage data={data} commit={commit} setError={setError} /> : null}
        {tab === '教学计划' ? <PlansPage data={data} commit={commit} setError={setError} /> : null}
        {tab === '排课任务' ? (
          <RunsPage
            data={data}
            commit={commit}
            result={result}
            issues={issues}
            running={running}
            progress={progress}
            runMode={runMode}
            timeLimit={timeLimit}
            setTimeLimit={setTimeLimit}
            onRun={run}
            onTimetable={() => setTab('课表预览')}
            onClear={clearCandidate}
          />
        ) : null}
        {tab === '课表预览' ? (
          <TimetablePage
            data={data}
            result={result}
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
            onRun={() => setTab('排课任务')}
            running={running}
            onExportCsv={exportCsvFile}
            onExportExcel={exportExcelFile}
          />
        ) : null}
        {tab === '报表发布' ? (
          <ReleasePage
            data={data}
            result={result}
            onPublish={publish}
            onClear={clearCandidate}
            onExportCsv={exportCsvFile}
            onExportExcel={exportExcelFile}
            onPrint={() => {
              if (!result) return;
              setTab('课表预览');
              window.setTimeout(() => window.print(), 350);
            }}
          />
        ) : null}
        {tab === '设置' ? <SettingsPage runMode={runMode} theme={theme} onThemeChange={setTheme} onEditMode={() => setModeSettingsOpen(true)} apiOnline={apiOnline} data={data} commit={commit} /> : null}
      </main>
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
  progress,
  onTimetable,
}: {
  data: SchoolData;
  result: SolverOutput | null;
  issues: string[];
  running: boolean;
  progress: RunProgress;
  onPrepare: () => void;
  onTimetable: () => void;
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
            把一周课表
            <br />
            <strong>排得有序。</strong>
          </h2>
          <p>从教学计划开始，生成一份可检查、可调整、可发布的候选课表。</p>
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
            <button className="action-button" onClick={onPrepare} disabled={running}>
              {running ? '计算中…' : '进入排课向导'} <span>→</span>
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

function SettingsPage({ runMode, theme, onThemeChange, onEditMode, apiOnline, data, commit }: { runMode: RunMode | null; theme: 'light' | 'dark'; onThemeChange: (theme: 'light' | 'dark') => void; onEditMode: () => void; apiOnline: boolean | null; data: SchoolData; commit: Commit }) {
  const mode = RUN_MODE_OPTIONS.find((item) => item.value === runMode);
  const endpoint = window.localStorage.getItem('warpweft-runtime-endpoint') || 'http://127.0.0.1:4317';
  return <div className="settings-layout"><Card className="business-card settings-card"><CardBody><SectionHeading english="RUNTIME" title="运行模式" /><p className="panel-note">决定数据和排课服务连接到哪里。修改后会重新连接工作区。</p><div className="settings-value"><span>当前模式</span><strong>{mode?.title ?? '未选择'}</strong><small>{mode?.english ?? 'NOT CONFIGURED'}</small></div><div className="settings-value"><span>服务地址</span><strong className="settings-endpoint">{endpoint}</strong></div><Button color="primary" onPress={onEditMode}>修改运行模式</Button></CardBody></Card><Card className="business-card settings-card"><CardBody><SectionHeading english="APPEARANCE" title="外观" /><p className="panel-note">调整工作台的显示主题。</p><Tabs selectedKey={theme} onSelectionChange={(key) => onThemeChange(String(key) as 'light' | 'dark')} aria-label="主题"><Tab key="light" title="浅色" /><Tab key="dark" title="深色" /></Tabs><div className="settings-value"><span>深色背景</span><strong>#1C1C1C</strong></div></CardBody></Card><Card className="business-card settings-card"><CardBody><SectionHeading english="WORKSPACE" title="当前工作区" /><label className="settings-value"><span>学校名称</span><input className="settings-input" value={data.school.name} onChange={(event) => commit({ ...data, school: { ...data.school, name: event.target.value } })} /></label><div className="settings-stats"><span>班级 <b>{data.classes.length}</b></span><span>教师 <b>{data.teachers.length}</b></span><span>教学计划 <b>{data.coursePlans.length}</b></span><span>服务状态 <Chip size="sm" color={apiOnline ? 'success' : 'warning'}>{apiOnline ? '在线' : apiOnline === false ? '离线' : '检测中'}</Chip></span></div><p className="panel-note">工作区数据由当前服务端管理。设置页不会自动填充演示数据。</p></CardBody></Card></div>;
}

function ResourcesPage({
  data,
  commit,
  setError,
}: {
  data: SchoolData;
  commit: Commit;
  setError: (value: string) => void;
}) {
  const days = DAYS.slice(1).map((label, index) => ({ value: String(index + 1), label }));
  const update = (
    collection: 'classes' | 'teachers' | 'subjects' | 'rooms' | 'timeSlots',
    id: string,
    key: string,
    value: string | number,
  ) => {
    const rows = (data[collection] as unknown as Array<Record<string, unknown> & { id: string }>).map((row) =>
      row.id === id ? { ...row, [key]: value } : row,
    );
    const invalidate = collection === 'timeSlots' && (key === 'day' || key === 'period');
    commit({ ...data, [collection]: rows } as unknown as SchoolData, { invalidate });
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
    if (!window.confirm('确定删除这条记录？')) return;
    const rows = (data[collection] as Array<{ id: string }>).filter((row) => row.id !== id);
    commit({ ...data, [collection]: rows } as unknown as SchoolData, { invalidate: true });
  };
  const add = (collection: 'classes' | 'teachers' | 'subjects' | 'rooms' | 'timeSlots') => {
    let row: Record<string, unknown>;
    if (collection === 'classes') row = { id: uid('class'), name: '新班级', grade: '未设置', size: 40 };
    else if (collection === 'teachers') row = { id: uid('teacher'), name: '新教师' };
    else if (collection === 'subjects') row = { id: uid('subject'), name: '新学科' };
    else if (collection === 'rooms') row = { id: uid('room'), name: '新教室', capacity: 40, type: '普通教室' };
    else {
      const periods = data.timeSlots.filter((slot) => slot.day === 1).map((slot) => slot.period);
      const period = (periods.length ? Math.max(...periods) : 0) + 1;
      row = { id: uid('slot'), day: 1, period, label: '周一 第' + period + '节' };
    }
    commit({ ...data, [collection]: [...(data[collection] as unknown as Array<Record<string, unknown>>), row] } as unknown as SchoolData, {
      invalidate: true,
    });
  };

  const importWorkbookFile = async (file: File) => {
    try {
      const rows = readWorkbook(await file.arrayBuffer());
      const imported = { ...data };
      const issues: string[] = [];
      for (const row of rows) {
        const v = row.values;
        const sheet = row.sheet.toLowerCase();
        if (sheet.includes('班级') || sheet.includes('class')) {
          if (!v['名称'] && !v['班级名称'] && !v['name']) { issues.push(`${row.sheet} 第${row.row}行缺少班级名称`); continue; }
          imported.classes = [...imported.classes, { id: uid('class'), name: String(v['名称'] ?? v['班级名称'] ?? v['name']), grade: String(v['年级'] ?? v['grade'] ?? ''), size: Number(v['人数'] ?? v['size'] ?? 0) || 40 }];
        } else if (sheet.includes('教师') || sheet.includes('teacher')) {
          const name = v['名称'] ?? v['教师名称'] ?? v['name'];
          if (!name) { issues.push(`${row.sheet} 第${row.row}行缺少教师名称`); continue; }
          imported.teachers = [...imported.teachers, { id: uid('teacher'), name: String(name) }];
        } else if (sheet.includes('学科') || sheet.includes('subject')) {
          const name = v['名称'] ?? v['学科名称'] ?? v['name'];
          if (!name) { issues.push(`${row.sheet} 第${row.row}行缺少学科名称`); continue; }
          imported.subjects = [...imported.subjects, { id: uid('subject'), name: String(name) }];
        } else if (sheet.includes('教室') || sheet.includes('room')) {
          const name = v['名称'] ?? v['教室名称'] ?? v['name'];
          if (!name) { issues.push(`${row.sheet} 第${row.row}行缺少教室名称`); continue; }
          imported.rooms = [...imported.rooms, { id: uid('room'), name: String(name), capacity: Number(v['容量'] ?? v['capacity'] ?? 40) || 40, type: String(v['类型'] ?? v['type'] ?? '普通教室') }];
        }
      }
      if (issues.length) setError('导入校验未通过：\n' + issues.join('\n'));
      const changed = imported.classes.length !== data.classes.length || imported.teachers.length !== data.teachers.length || imported.subjects.length !== data.subjects.length || imported.rooms.length !== data.rooms.length;
      if (changed) commit(imported, { invalidate: true, immediate: true });
      if (!issues.length && changed) setError('');
    } catch (cause) {
      setError('Excel 导入失败：' + messageOf(cause));
    }
  };

  return (
    <div className="resource-grid">
      <section className="section-panel resource-panel import-panel">
        <div className="panel-head"><SectionHeading english="IMPORT / VALIDATE" title="Excel 导入" /></div>
        <p className="panel-note">按工作表名称识别班级、教师、学科、教室；导入前会逐行检查必填名称，成功后自动清空候选课表。</p>
        <label className="file-button">选择 Excel 文件<input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importWorkbookFile(file); event.currentTarget.value = ''; }} /></label>
      </section>
      <EditableTable<ClassRoom>
        title="班级"
        english="CLASS REGISTER"
        rows={data.classes}
        columns={[
          { key: 'name', label: '班级名称', width: '38%' },
          { key: 'grade', label: '年级', width: '30%' },
          { key: 'size', label: '人数', type: 'number', width: '22%' },
        ]}
        onChange={(id, key, value) => update('classes', id, key, value)}
        onAdd={() => add('classes')}
        onRemove={(id) => remove('classes', id)}
        addLabel="新增班级"
        note="班级人数会影响教室容量校验；被教学计划引用的班级不能删除。"
      />
      <EditableTable<Teacher>
        title="教师"
        english="TEACHER REGISTER"
        rows={data.teachers}
        columns={[{ key: 'name', label: '教师姓名', width: '78%' }]}
        onChange={(id, key, value) => update('teachers', id, key, value)}
        onAdd={() => add('teachers')}
        onRemove={(id) => remove('teachers', id)}
        addLabel="新增教师"
        note="教师不能在同一时间上两门课；被教学计划引用的教师不能删除。"
      />
      <EditableTable<Subject>
        title="学科"
        english="SUBJECT REGISTER"
        rows={data.subjects}
        columns={[{ key: 'name', label: '学科名称', width: '78%' }]}
        onChange={(id, key, value) => update('subjects', id, key, value)}
        onAdd={() => add('subjects')}
        onRemove={(id) => remove('subjects', id)}
        addLabel="新增学科"
        note="教学计划通过学科引用课程名称。"
      />
      <EditableTable<Room>
        title="教室"
        english="ROOM REGISTER"
        rows={data.rooms}
        columns={[
          { key: 'name', label: '教室名称', width: '38%' },
          { key: 'capacity', label: '容量', type: 'number', width: '22%' },
          { key: 'type', label: '类型', width: '34%' },
        ]}
        onChange={(id, key, value) => update('rooms', id, key, value)}
        onAdd={() => add('rooms')}
        onRemove={(id) => remove('rooms', id)}
        addLabel="新增教室"
        note="教室类型会与教学计划的教室类型要求匹配；容量必须大于等于班级人数。"
      />
      <EditableTable<TimeSlot>
        title="时间段"
        english="TIME SLOTS"
        rows={data.timeSlots}
        columns={[
          { key: 'day', label: '星期', type: 'select', options: days, width: '28%' },
          { key: 'period', label: '节次', type: 'number', width: '18%' },
          { key: 'label', label: '显示名称', width: '44%' },
        ]}
        onChange={(id, key, value) => update('timeSlots', id, key, value)}
        onAdd={() => add('timeSlots')}
        onRemove={(id) => remove('timeSlots', id)}
        addLabel="新增时间段"
        note="修改星期或节次会清空候选课表；请先确认课表结构。"
      />
      <AvailabilityEditor data={data} commit={commit} />
    </div>
  );
}

function AvailabilityEditor({ data, commit }: { data: SchoolData; commit: Commit }) {
  const unavailable = data.unavailableSlots ?? [];
  const toggle = (teacherId: string, slotId: string) => {
    const exists = unavailable.some((item) => item.teacherId === teacherId && item.slotId === slotId);
    const next = exists ? unavailable.filter((item) => !(item.teacherId === teacherId && item.slotId === slotId)) : [...unavailable, { teacherId, slotId }];
    commit({ ...data, unavailableSlots: next }, { invalidate: true });
  };
  return <section className="section-panel resource-panel"><div className="panel-head"><SectionHeading english="TEACHER AVAILABILITY" title="教师不可用时间" /></div><p className="panel-note">勾选后，求解器会把这些时间视为教师不可用。</p><div className="availability-grid">{data.teachers.map((teacher) => <div className="availability-row" key={teacher.id}><strong>{teacher.name}</strong>{data.timeSlots.map((slot) => <label key={slot.id} title={slot.label}><input type="checkbox" checked={unavailable.some((item) => item.teacherId === teacher.id && item.slotId === slot.id)} onChange={() => toggle(teacher.id, slot.id)} />{slot.label}</label>)}</div>)}</div></section>;
}

function PlansPage({
  data,
  commit,
  setError,
}: {
  data: SchoolData;
  commit: Commit;
  setError: (value: string) => void;
}) {
  const roomTypes = Array.from(new Set(data.rooms.map((room) => room.type).filter(Boolean)));
  const total = data.coursePlans.reduce((sum, plan) => sum + Number(plan.weeklyPeriods || 0), 0);
  const update = (id: string, patch: Partial<CoursePlan>) => {
    const plans = data.coursePlans.map((plan) => (plan.id === id ? { ...plan, ...patch } : plan));
    commit({ ...data, coursePlans: plans }, { invalidate: true });
  };
  const remove = (id: string) => {
    if (!window.confirm('删除这条教学计划？相关候选课表会被清空。')) return;
    commit({ ...data, coursePlans: data.coursePlans.filter((plan) => plan.id !== id) }, { invalidate: true });
  };
  const add = () => {
    if (!data.classes.length || !data.subjects.length || !data.teachers.length) {
      setError('请先在基础资料中至少添加一个班级、一个学科和一位教师');
      return;
    }
    const plan: CoursePlan = {
      id: uid('plan'),
      classId: data.classes[0].id,
      subjectId: data.subjects[0].id,
      teacherId: data.teachers[0].id,
      weeklyPeriods: 1,
      roomType: data.rooms[0]?.type ?? '',
      fixedSlotId: '',
    };
    commit({ ...data, coursePlans: [...data.coursePlans, plan] }, { invalidate: true });
  };

  return (
    <section className="section-panel table-panel">
      <div className="panel-head">
        <SectionHeading english="COURSE PLAN REGISTER" title="教学计划" />
        <button className="mini-button" onClick={add}>
          + 新增计划
        </button>
      </div>
      <div className="plan-summary">
        <span>
          共 <b>{data.coursePlans.length}</b> 条计划
        </span>
        <span>
          每周 <b>{total}</b> 课时
        </span>
        <span>
          可用时间格 <b>{data.timeSlots.length}</b>
        </span>
      </div>
      <div className="table-scroll">
        <table className="data-table plan-table">
          <thead>
            <tr>
              <th>班级</th>
              <th>学科</th>
              <th>教师</th>
              <th>周课时</th>
              <th>教室类型</th>
              <th>固定时间</th>
              <th className="action-column">操作</th>
            </tr>
          </thead>
          <tbody>
            {data.coursePlans.length === 0 ? (
              <tr>
                <td className="table-empty" colSpan={7}>
                  暂无教学计划，先新增一条。
                </td>
              </tr>
            ) : (
              data.coursePlans.map((plan) => (
                <tr key={plan.id}>
                  <td>
                    <select value={plan.classId} onChange={(event) => update(plan.id, { classId: event.target.value })}>
                      {data.classes.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={plan.subjectId} onChange={(event) => update(plan.id, { subjectId: event.target.value })}>
                      {data.subjects.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={plan.teacherId} onChange={(event) => update(plan.id, { teacherId: event.target.value })}>
                      {data.teachers.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      value={plan.weeklyPeriods}
                      onChange={(event) => update(plan.id, { weeklyPeriods: Number(event.target.value) })}
                    />
                  </td>
                  <td>
                    <select value={plan.roomType ?? ''} onChange={(event) => update(plan.id, { roomType: event.target.value })}>
                      <option value="">不限</option>
                      {roomTypes.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={plan.fixedSlotId ?? ''} onChange={(event) => update(plan.id, { fixedSlotId: event.target.value })}>
                      <option value="">不固定</option>
                      {data.timeSlots.map((slot) => (
                        <option key={slot.id} value={slot.id}>
                          {slot.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="action-column">
                    <button className="danger-link" onClick={() => remove(plan.id)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="panel-note">
        固定时间会优先占用指定时间格；修改教学计划会清空候选课表，避免旧课表与新计划混用。
      </p>
    </section>
  );
}

function RunsPage({ data, commit, result, issues, running, progress, timeLimit, setTimeLimit, onRun, onTimetable, onClear, runMode }: {
  data: SchoolData; commit: Commit; result: SolverOutput | null; issues: string[]; running: boolean; progress: RunProgress;
  timeLimit: number; setTimeLimit: (value: number) => void; onRun: () => void; onTimetable: () => void; onClear: () => void; runMode?: RunMode | null;
}) {
  const expected = data.coursePlans.reduce((sum, plan) => sum + Number(plan.weeklyPeriods || 0), 0);
  const missing = result ? missingPlans(data, result) : [];
  const soft = data.softConstraints ?? [
    { kind: 'SUBJECT_DISTRIBUTION' as const, weight: 3 }, { kind: 'TEACHER_CONTINUOUS' as const, weight: 2 },
    { kind: 'TEACHER_GAPS' as const, weight: 1 }, { kind: 'TEACHER_WORKLOAD_BALANCE' as const, weight: 2 },
  ];
  const labels: Record<string, string> = { SUBJECT_DISTRIBUTION: '学科分布', TEACHER_CONTINUOUS: '教师连堂', TEACHER_GAPS: '教师空档', TEACHER_WORKLOAD_BALANCE: '教师日负荷均衡' };
  const checked = issues.length === 0;
  const canConfigure = checked && !running;
  const lockedCount = data.candidate?.entries.filter((entry) => entry.locked).length ?? 0;
  const modeLabel = RUN_MODE_OPTIONS.find((item) => item.value === runMode)?.title ?? '当前模式';
  return <div className="runs-wizard">
    <section className="section-panel wizard-intro"><SectionHeading english="SCHEDULE RUN" title="排课向导" /><p className="panel-note">按 01 → 02 → 03 → 04 完成配置。数据检查未通过时，后续步骤会锁定。</p><div className="wizard-stepper">{['数据检查', '约束与权重', '计算设置', '开始排课'].map((label, index) => <div key={label} className={'wizard-stepper-item ' + (index === 0 && checked || index > 0 && canConfigure ? 'done' : '')}><b>0{index + 1}</b><span>{label}</span></div>)}</div>{progress.phase !== 'idle' ? <RunProgressView progress={progress} /> : null}</section>
    <div className="wizard-grid">
      <section className="section-panel wizard-card"><div className="wizard-card-head"><span className="wizard-number">01</span><div><span className="kicker">PREFLIGHT</span><h2>数据检查</h2></div><span className={issues.length ? 'status-tag danger' : 'status-tag'}>{issues.length ? issues.length + ' 项待处理' : '通过'}</span></div>{issues.length ? <ul className="issue-list">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : <p className="panel-note success-note">检查通过：{expected} 周课时、{data.timeSlots.length} 个可用时间格。</p>}<div className="hero-actions"><button className="ghost-button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>回到顶部查看状态</button></div></section>
      <section className={'section-panel wizard-card ' + (!checked ? 'wizard-locked' : '')}><div className="wizard-card-head"><span className="wizard-number">02</span><div><span className="kicker">SOFT RULES</span><h2>约束与权重</h2></div><span className="status-tag">{checked ? '可配置' : '待检查'}</span></div>{!checked ? <p className="panel-note">请先修复第 01 步的问题。</p> : <div className="soft-rules">{soft.map((rule) => <label key={rule.kind}>{labels[rule.kind]}<input type="range" min={0} max={10} value={rule.weight} disabled={!canConfigure} onChange={(event) => commit({ ...data, softConstraints: soft.map((item) => item.kind === rule.kind ? { ...item, weight: Number(event.target.value) } : item) })} /><output>{rule.weight}</output></label>)}</div>}</section>
      <section className={'section-panel wizard-card ' + (!checked ? 'wizard-locked' : '')}><div className="wizard-card-head"><span className="wizard-number">03</span><div><span className="kicker">SOLVER SETTINGS</span><h2>计算设置</h2></div><span className="status-tag">{checked ? '已就绪' : '待检查'}</span></div>{!checked ? <p className="panel-note">完成数据检查后配置计算时限。</p> : <><div className="run-controls"><label>计算时限<select value={timeLimit} disabled={!canConfigure} onChange={(event) => setTimeLimit(Number(event.target.value))}><option value={10}>10 秒</option><option value={30}>30 秒</option><option value={60}>60 秒</option><option value={120}>120 秒</option></select></label></div><div className="config-summary"><span>运行模式<strong>{modeLabel}</strong></span><span>锁定课程<strong>{lockedCount}</strong></span><span>可用时间格<strong>{data.timeSlots.length}</strong></span></div></>}</section>
      <section className={'section-panel wizard-card wizard-final ' + (!checked ? 'wizard-locked' : '')}><div className="wizard-card-head"><span className="wizard-number">04</span><div><span className="kicker">RUN SCHEDULE</span><h2>开始排课</h2></div><span className={result?.hasFeasibleSolution ? 'status-tag' : 'status-tag muted'}>{result ? result.status : '尚未运行'}</span></div>{result && lockedCount > 0 ? <p className="panel-note">本次重新排课将保留 {lockedCount} 条锁定课程的位置。</p> : <p className="panel-note">确认前面三步后，开始生成候选课表。</p>}<button className="action-button wizard-run-button" onClick={onRun} disabled={!checked || running}>{running ? '正在计算…' : result ? '确认配置并重新排课' : '确认配置并开始排课'} <span>↗</span></button></section>
    </div>
    <section className="section-panel candidate-panel"><div className="panel-head"><SectionHeading english="CURRENT CANDIDATE" title="当前候选" /><span className={result?.hasFeasibleSolution ? 'status-tag' : 'status-tag muted'}>{result?.status ?? '尚未生成'}</span></div>{result ? <div className="result-summary"><div className="summary-grid"><div><span>已排课时</span><b>{result.entries.length}</b></div><div><span>计划课时</span><b>{expected}</b></div><div><span>未排课时</span><b>{Math.max(0, expected - result.entries.length)}</b></div><div><span>耗时</span><b>{result.elapsedMs} ms</b></div></div><p className="panel-note">{result.explanation || '求解器没有返回说明。'}</p>{result.hardConstraintViolations.length ? <ul className="issue-list">{result.hardConstraintViolations.map((item) => <li key={item}>{item}</li>)}</ul> : null}{missing.length ? <ul className="issue-list">{missing.map((item) => <li key={item.plan.id}>{findClass(data, item.plan.classId)?.name ?? item.plan.classId} · {planSubjectName(data, item.plan)} 还缺 {item.missing} 课时</li>)}</ul> : null}<div className="hero-actions"><button className="action-button" onClick={onTimetable}>查看并调整课表 <span>→</span></button><button className="ghost-button" onClick={onClear}>清空候选</button></div></div> : <EmptyState title="尚未生成候选课表" message="完成向导后，候选课表会显示在这里。" />}</section>
  </div>;
}

function TimetablePage({
  data,
  result,
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
  onExportCsv,
  onExportExcel,
}: {
  data: SchoolData;
  result: SolverOutput | null;
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
  onExportCsv: () => void;
  onExportExcel: () => void;
}) {
  const [dragId, setDragId] = useState('');
  const [dragOver, setDragOver] = useState('');
  const days = Array.from(new Set(data.timeSlots.map((slot) => slot.day))).sort((a, b) => a - b);
  const periods = Array.from(new Set(data.timeSlots.map((slot) => slot.period))).sort((a, b) => a - b);
  const entities = view === 'class' ? data.classes : view === 'teacher' ? data.teachers : data.rooms;
  const conflicts = result ? conflictIds(result.entries) : new Set<string>();
  const selected = result?.entries.find((entry) => entry.id === selectedEntryId);
  const missing = result ? missingPlans(data, result) : [];
  const slotAt = (day: number, period: number) => data.timeSlots.find((slot) => slot.day === day && slot.period === period);
  const entriesAt = (slotId: string) => {
    if (!result) return [];
    return result.entries.filter((entry) => {
      if (entry.slotId !== slotId) return false;
      if (view === 'class') return entry.classId === entityId;
      if (view === 'teacher') return entry.teacherId === entityId;
      return entry.roomId === entityId;
    });
  };
  const viewLabel = view === 'class' ? '班级' : view === 'teacher' ? '教师' : '教室';

  if (!result) {
    return (
      <EmptyState
        title="还没有候选课表"
        message="先到排课任务运行一次自动排课，然后在这里检查、交换和锁定课程。"
        action={
          <button className="action-button" onClick={onRun} disabled={running}>
            {running ? '计算中…' : '去排课'} <span>↗</span>
          </button>
        }
      />
    );
  }

  return (
    <div className="timetable-layout">
      <section className="section-panel">
        <div className="timetable-page-head"><div><span className="kicker">// TIMETABLE WORKSPACE</span><h2>课表预览与手动调整</h2><p>选择班级、教师或教室查看课表；在班级视图中拖动课程即可调整时间。</p></div><Chip color={result.hasFeasibleSolution ? 'success' : 'warning'} variant="flat">{result.status}</Chip></div>
        <div className="toolbar">
          <Tabs selectedKey={view} onSelectionChange={(key) => setView(String(key) as View)} aria-label="课表视图">
            <Tab key="class" title="班级视图" />
            <Tab key="teacher" title="教师视图" />
            <Tab key="room" title="教室视图" />
          </Tabs>
          <Select className="business-select" label={viewLabel} selectedKeys={entityId ? [entityId] : []} onSelectionChange={(keys) => setEntityId(Array.from(keys)[0] as string)}>
            {entities.map((item) => <SelectItem key={item.id}>{item.name}</SelectItem>)}
          </Select>
          <div className="toolbar-spacer" />
          {selected ? <Button size="sm" color={selected.locked ? 'default' : 'primary'} onPress={() => onToggleLock(selected.id)}>{selected.locked ? '解锁选中' : '锁定选中'}</Button> : null}
          <Button size="sm" variant="flat" onPress={onUndo} isDisabled={!canUndo}>撤销</Button>
          <Button size="sm" variant="flat" onPress={onRun} isDisabled={running}>前往排课向导</Button>
          <Button size="sm" variant="flat" onPress={onExportCsv}>导出 CSV</Button>
          <Button size="sm" variant="flat" onPress={onExportExcel}>导出 Excel</Button>
        </div>
        {view === 'class' ? (
          <p className="panel-note">拖动课程卡片可以移动或交换时间；锁定后重新排课会保留该课程位置。</p>
        ) : (
          <p className="panel-note">教师/教室视图用于检查冲突；请切换到班级视图进行拖动调整。</p>
        )}
        {missing.length ? (
          <div className="inline-warning">
            <b>还有 {missing.reduce((sum, item) => sum + item.missing, 0)} 课时未排：</b>{' '}
            {missing.map((item) => (findClass(data, item.plan.classId)?.name ?? '') + ' ' + planSubjectName(data, item.plan)).join('、')}
          </div>
        ) : null}
        <div className="timetable-wrap">
          <table className="timetable">
            <thead>
              <tr>
                <th className="period-head">节次</th>
                {days.map((day) => (
                  <th key={day}>{DAYS[day] ?? '第' + day + '天'}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr key={period}>
                  <th className="period-head">第{period}节</th>
                  {days.map((day) => {
                    const slot = slotAt(day, period);
                    const entries = slot ? entriesAt(slot.id) : [];
                    const isDragOver = dragOver === slot?.id;
                    return (
                      <td
                        key={day + '-' + period}
                        className={
                          'slot-cell' +
                          (entries.length ? ' filled' : ' empty') +
                          (isDragOver ? ' drop-target' : '')
                        }
                        onDragOver={(event) => {
                          if (view !== 'class' || !slot) return;
                          event.preventDefault();
                          setDragOver(slot.id);
                        }}
                        onDragLeave={() => setDragOver('')}
                        onDrop={(event) => {
                          if (view !== 'class' || !slot) return;
                          event.preventDefault();
                          const entryId = event.dataTransfer.getData('text/plain') || dragId;
                          setDragOver('');
                          setDragId('');
                          if (entryId) onSwap(entryId, slot.id);
                        }}
                        onClick={() => {
                          if (!entries.length) setSelectedEntryId('');
                        }}
                      >
                        {entries.length ? (
                          entries.map((entry) => {
                            const plan = planOf(data, entry);
                            const isConflict = conflicts.has(entry.id);
                            return (
                              <div
                                key={entry.id}
                                className={
                                  'slot-card' +
                                  (entry.locked ? ' locked' : '') +
                                  (isConflict ? ' conflict' : '') +
                                  (entry.id === selectedEntryId ? ' selected' : '')
                                }
                                draggable={view === 'class' && !entry.locked}
                                onDragStart={(event) => {
                                  if (view !== 'class' || entry.locked) return;
                                  event.dataTransfer.setData('text/plain', entry.id);
                                  setDragId(entry.id);
                                }}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedEntryId(entry.id);
                                }}
                                title={entry.locked ? '已锁定' : '拖动调整时间'}
                              >
                                <span className="slot-course">{planSubjectName(data, plan)}</span>
                                <span className="slot-meta">
                                  {view === 'class'
                                    ? (findTeacher(data, entry.teacherId)?.name ?? '') + ' · ' + (findRoom(data, entry.roomId)?.name ?? '')
                                    : (findClass(data, entry.classId)?.name ?? '') + ' · ' + (findRoom(data, entry.roomId)?.name ?? '')}
                                </span>
                                <span className="slot-badges">
                                  {entry.locked ? <em>锁定</em> : null}
                                  {entry.source === 'MANUAL' ? <em>手工</em> : null}
                                  {isConflict ? <em className="danger">冲突</em> : null}
                                </span>
                              </div>
                            );
                          })
                        ) : (
                          <span className="slot-empty">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="timetable-legend">
          <span><i className="legend-dot" />普通课程</span>
          <span><i className="legend-dot locked" />已锁定</span>
          <span><i className="legend-dot conflict" />冲突</span>
          <span><i className="legend-dot manual" />手工调整</span>
          {selected ? (
            <span className="selected-detail">
              已选：{planSubjectName(data, planOf(data, selected))} · {findClass(data, selected.classId)?.name ?? ''} ·{' '}
              {findTeacher(data, selected.teacherId)?.name ?? ''} · {findRoom(data, selected.roomId)?.name ?? ''}
            </span>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function ReleasePage({
  data,
  result,
  onPublish,
  onClear,
  onExportCsv,
  onExportExcel,
  onPrint,
}: {
  data: SchoolData;
  result: SolverOutput | null;
  onPublish: () => void;
  onClear: () => void;
  onExportCsv: () => void;
  onExportExcel: () => void;
  onPrint: () => void;
}) {
  const exportable = result ?? data.published ?? null;
  return (
    <div className="release-layout">
      <section className="section-panel">
        <SectionHeading english="RELEASE" title="发布与导出" />
        <p className="panel-note">候选课表通过检查后，可保存为正式版并导出 Excel、CSV 或打印。</p>
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
            <span>正式版</span>
            <b>{data.published ? '已保存' : '未发布'}</b>
          </div>
          <div>
            <span>更新时间</span>
            <b>{fmtTime(data.updatedAt)}</b>
          </div>
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
          <button className="action-button" onClick={onPublish} disabled={!result}>
            保存为正式版 <span>↗</span>
          </button>
          <button className="ghost-button" onClick={onClear} disabled={!result}>
            清空候选
          </button>
        </div>
        <div className="version-history"><h3>正式版版本与审计</h3>{(data.publishedVersions ?? []).length === 0 ? <p className="panel-note">尚无正式版发布记录。</p> : <ol>{(data.publishedVersions ?? []).slice().reverse().map((version) => <li key={version.id}><strong>{version.id}</strong><span>{fmtTime(version.createdAt)} · {version.result.entries.length} 课时</span></li>)}</ol>}</div>
      </section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<HeroUIProvider><App /></HeroUIProvider>);
