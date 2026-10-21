import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HeroUIProvider, Button, Card, CardBody, Chip, Progress, Select, SelectItem, Tabs, Tab } from '@heroui/react';
import { validateInput } from '../../../packages/validation/src';
import { buildImportTemplate, exportCsv, exportWorkbook, readWorkbook } from '../../../packages/import-export/src';
import { fetchServerJobs, fetchServerLogs, fetchServerStats, loadData, saveData, solveSchedule } from './api';
import type { ServerJob, ServerLog, ServerStats } from './api';
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

const TABS = ['工作台', '基础资料', '教学计划', '排课任务', '课表预览', '报表发布', '服务端', '设置'] as const;
type Tab = (typeof TABS)[number];
const EN: Record<Tab, string> = {
  工作台: 'OVERVIEW',
  基础资料: 'RESOURCES',
  教学计划: 'COURSE PLANS',
  排课任务: 'SCHEDULE RUNS',
  课表预览: 'TIMETABLE PREVIEW',
  报表发布: 'RELEASE',
  服务端: 'SERVER',
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

type ExportBridge = { saveExport?: (filename: string, data: ArrayBuffer) => Promise<string> };

async function download(content: BlobPart, type: string, filename: string): Promise<string | null> {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const bridge = (window as unknown as { warpweft?: ExportBridge }).warpweft;
  if (bridge?.saveExport) {
    return bridge.saveExport(filename, await blob.arrayBuffer());
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return null;
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

  const exportCsvFile = async () => {
    if (!data) return;
    const target = result ?? data.published;
    if (!target) return;
    try {
      const csv = exportCsv(exportRows(data, target));
      const savedPath = await download(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), 'text/csv', 'warpweft-timetable.csv');
      setNotice(savedPath ? 'CSV 已导出到 ' + savedPath : 'CSV 已开始下载，请查看系统下载目录');
    } catch (cause) {
      setError('导出 CSV 失败：' + messageOf(cause));
    }
  };

  const exportExcelFile = async () => {
    if (!data) return;
    const target = result ?? data.published;
    if (!target) return;
    try {
      const bytes = exportWorkbook({
      课表: exportRows(data, target),
      元数据: [
        { 项目: '学校', 值: data.school.name },
        { 项目: '导出时间', 值: new Date().toLocaleString('zh-CN') },
        { 项目: '课表状态', 值: target.status },
      ],
    });
      const savedPath = await download(
        new Blob([bytes.buffer as ArrayBuffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'warpweft-timetable.xlsx',
      );
      setNotice(savedPath ? 'Excel 已导出到 ' + savedPath : 'Excel 已开始下载，请查看系统下载目录');
    } catch (cause) {
      setError('导出 Excel 失败：' + messageOf(cause));
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
            onPrepare={() => setTab('排课任务')}
            onTimetable={() => setTab('课表预览')}
          />
        ) : null}
        {tab === '基础资料' ? <ResourcesPage data={data} commit={commit} setError={setError} setNotice={setNotice} /> : null}
        {tab === '教学计划' ? <PlansPage data={data} commit={commit} setError={setError} /> : null}
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
            onRun={run}
            running={running}
            onExportCsv={exportCsvFile}
            onExportExcel={exportExcelFile}
            onPrint={() => window.print()}
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
        {tab === '服务端' && runMode === 'lan-server' ? <ServerPage apiOnline={apiOnline} /> : null}
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
  return status;
}

function ServerPage({ apiOnline }: { apiOnline: boolean | null }) {
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [jobs, setJobs] = useState<ServerJob[]>([]);
  const [logs, setLogs] = useState<ServerLog[]>([]);
  const [error, setError] = useState('');
  const sinceRef = useRef(0);
  const logRef = useRef<HTMLDivElement | null>(null);

  const refresh = async () => {
    try {
      const [nextStats, nextJobs, nextLogs] = await Promise.all([fetchServerStats(), fetchServerJobs(), fetchServerLogs(sinceRef.current)]);
      setStats(nextStats);
      setJobs(nextJobs.jobs);
      if (nextLogs.logs.length > 0) {
        setLogs((current) => {
          const merged = new Map(current.map((item) => [item.seq, item]));
          for (const item of nextLogs.logs) merged.set(item.seq, item);
          return Array.from(merged.values()).sort((a, b) => a.seq - b.seq).slice(-400);
        });
        sinceRef.current = Math.max(sinceRef.current, nextLogs.lastSeq);
      }
      setError('');
    } catch (cause) {
      setError('服务端监控连接失败：' + messageOf(cause));
    }
  };

  useEffect(() => {
    let cancelled = false;
    const tick = async () => { if (!cancelled) await refresh(); };
    void tick();
    const timer = window.setInterval(() => { void tick(); }, 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const queueCount = stats ? stats.queue.queued + stats.queue.running : 0;
  return (
    <div className="server-layout">
      {error ? <Banner tone="error" title="服务端监控异常" onClose={() => setError('')}>{error}</Banner> : null}
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
              <span><b>Java</b> {stats.java.version ?? '未检测'}</span>
              <span><b>求解器</b> {stats.solver.engine} · {stats.solver.ready ? '就绪' : '未就绪'}</span>
              <span><b>系统</b> {stats.platform}/{stats.arch}</span>
            </div>
            {stats.host === '127.0.0.1' ? <div className="server-warning">当前仅监听本机回环地址。如果其他电脑需要通过局域网连接，请以 WARPVEFT_HOST=0.0.0.0 启动服务端。</div> : null}
          </section>
          <section className="section-panel">
            <div className="panel-head">
              <SectionHeading english="TASK QUEUE" title="任务队列" />
              <span className={stats.queue.running > 0 ? 'status-tag' : 'status-tag muted'}>{stats.queue.running > 0 ? '正在求解' : '空闲'}</span>
            </div>
            {jobs.length === 0 ? <EmptyState title="还没有求解任务" message="在排课任务页发起一次排课，这里会显示队列、耗时和结果。" /> : (
              <div className="table-scroll">
                <table className="server-job-table">
                  <thead><tr><th>状态</th><th>任务</th><th>规模</th><th>耗时</th><th>结果</th></tr></thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr key={job.id}>
                        <td><span className={'server-job-state is-' + job.status}><i />{jobStateLabel(job.status)}</span></td>
                        <td><b>{job.id}</b><small>{fmtTime(job.createdAt)}</small></td>
                        <td>{job.classes} 班 / {job.lessons} 课时</td>
                        <td>{job.elapsedMs > 0 ? Math.round(job.elapsedMs) + ' ms' : '—'}</td>
                        <td><span className={job.error ? 'server-job-result is-error' : 'server-job-result'}>{job.error ? job.error : (job.resultStatus ?? '—')}</span></td>
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

function ResourcesPage({
  data,
  commit,
  setError,
  setNotice,
}: {
  data: SchoolData;
  commit: Commit;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
}) {
  const days = DAYS.slice(1).map((label, index) => ({ value: String(index + 1), label }));
  const [replaceOnImport, setReplaceOnImport] = useState(false);
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
      if (replaceOnImport && !window.confirm('导入前将清空当前工作区的基础资料、时间段和教学计划，确定继续？')) return;
      const rows = readWorkbook(await file.arrayBuffer());
      if (rows.length === 0) {
        setError('Excel 文件为空，请先下载模板并按表头填写。');
        return;
      }
      const text = (value: unknown) => String(value ?? '').trim();
      const numeric = (value: unknown, fallback = 0) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
      };
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
      const takeRows = (tokens: string[]) => {
        const result: typeof rows = [];
        for (const [sheet, sheetRows] of grouped) {
          if (tokens.some((token) => sheet.includes(token))) result.push(...sheetRows);
        }
        return result;
      };
      const schoolRows = takeRows(['学校', 'school']);
      const classRows = takeRows(['班级', 'class']);
      const teacherRows = takeRows(['教师', 'teacher']);
      const subjectRows = takeRows(['学科', 'subject']);
      const roomRows = takeRows(['教室', 'room']);
      const slotRows = takeRows(['时间段', 'slot']);
      const planRows = takeRows(['教学计划', 'plan']);
      const planSheetFound = [...grouped.keys()].some((sheet) => sheet.includes('教学计划') || sheet.includes('plan'));
      if (![...schoolRows, ...classRows, ...teacherRows, ...subjectRows, ...roomRows, ...slotRows, ...planRows].length) {
        setError('未识别到可导入的工作表。请使用模板中的“班级/教师/学科/教室/时间段/教学计划”表头。');
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
      if (replaceOnImport) {
        next.classes = [];
        next.teachers = [];
        next.subjects = [];
        next.rooms = [];
        next.timeSlots = [];
        next.coursePlans = [];
      }
      const classNames = new Set<string>();
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
        const size = numeric(v['人数'] ?? v['size'], 40);
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
      }
      const teacherNames = new Set<string>();
      for (const row of teacherRows) {
        const v = row.values;
        const name = text(v['名称'] ?? v['教师名称'] ?? v['name']);
        if (!name) {
          issues.push('教师 第' + row.row + '行缺少名称');
          continue;
        }
        const key = name.toLowerCase();
        if (teacherNames.has(key)) {
          issues.push('教师 第' + row.row + '行名称重复：' + name);
          continue;
        }
        teacherNames.add(key);
        if (!next.teachers.some((item) => item.name.trim().toLowerCase() === key)) {
          next.teachers.push({ id: uid('teacher'), name });
        }
      }
      const subjectNames = new Set<string>();
      for (const row of subjectRows) {
        const v = row.values;
        const name = text(v['名称'] ?? v['学科名称'] ?? v['name']);
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
        if (!next.subjects.some((item) => item.name.trim().toLowerCase() === key)) {
          next.subjects.push({ id: uid('subject'), name });
        }
      }
      const roomNames = new Set<string>();
      for (const row of roomRows) {
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
        const capacity = numeric(v['容量'] ?? v['capacity'], 40);
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
      const slotKeys = new Set<string>();
      for (const row of slotRows) {
        const v = row.values;
        const day = dayMap[text(v['星期'] ?? v['day'])];
        const period = numeric(v['节次'] ?? v['period']);
        if (!day || !Number.isInteger(period) || period <= 0) {
          issues.push('时间段 第' + row.row + '行缺少有效星期或节次');
          continue;
        }
        const key = day + '-' + period;
        if (slotKeys.has(key)) {
          issues.push('时间段 第' + row.row + '行重复：' + day + '-' + period);
          continue;
        }
        slotKeys.add(key);
        const label = text(v['名称'] ?? v['label']) || DAYS[day] + ' 第' + period + '节';
        const existing = next.timeSlots.find((item) => item.day === day && item.period === period);
        if (existing) existing.label = label;
        else next.timeSlots.push({ id: uid('slot'), day, period, label });
      }
      const classByName = new Map(next.classes.map((item) => [item.name.trim().toLowerCase(), item]));
      const subjectByName = new Map(next.subjects.map((item) => [item.name.trim().toLowerCase(), item]));
      const teacherByName = new Map(next.teachers.map((item) => [item.name.trim().toLowerCase(), item]));
      const slotByLabel = new Map(next.timeSlots.map((item) => [item.label.trim(), item]));
      const slotById = new Map(next.timeSlots.map((item) => [item.id, item]));
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
          const teacherItem = teacherByName.get(teacherName.toLowerCase());
          if (!classItem || !subjectItem || !teacherItem) {
            issues.push('教学计划 第' + row.row + '行引用了不存在的班级、学科或教师');
            continue;
          }
          const weeklyPeriods = numeric(v['周课时'] ?? v['课时'] ?? v['weeklyPeriods']);
          if (!Number.isInteger(weeklyPeriods) || weeklyPeriods <= 0) {
            issues.push('教学计划 第' + row.row + '行周课时必须为正整数');
            continue;
          }
          const roomType = text(v['教室类型'] ?? v['roomType']);
          if (roomType && !next.rooms.some((room) => room.type === roomType)) {
            issues.push('教学计划 第' + row.row + '行教室类型不存在：' + roomType);
            continue;
          }
          const fixedText = text(v['固定时间'] ?? v['fixedSlot'] ?? v['fixed']);
          let fixedSlotId = '';
          if (fixedText) {
            const fixed = slotByLabel.get(fixedText) ?? slotById.get(fixedText);
            if (!fixed) {
              issues.push('教学计划 第' + row.row + '行固定时间不存在：' + fixedText);
              continue;
            }
            fixedSlotId = fixed.id;
          }
          const key = classItem.id + '|' + subjectItem.id + '|' + teacherItem.id;
          if (planKeys.has(key)) {
            issues.push('教学计划 第' + row.row + '行重复：' + className + ' / ' + subjectName);
            continue;
          }
          planKeys.add(key);
          plans.push({ id: uid('plan'), classId: classItem.id, subjectId: subjectItem.id, teacherId: teacherItem.id, weeklyPeriods, roomType, fixedSlotId });
        }
        next.coursePlans = plans;
      }
      if (issues.length) {
        setError('导入校验未通过（未写入数据）：\n' + issues.join('\n'));
        return;
      }
      commit(next, { invalidate: true, immediate: true });
      setError('');
      setNotice((replaceOnImport ? '已清空并导入：' : 'Excel 导入完成：') + '班级 ' + next.classes.length + '，教师 ' + next.teachers.length + '，学科 ' + next.subjects.length + '，教室 ' + next.rooms.length + '，时间段 ' + next.timeSlots.length + '，教学计划 ' + next.coursePlans.length);
    } catch (cause) {
      setError('Excel 导入失败：' + messageOf(cause));
    }
  };

  const downloadTemplate = async () => {
    try {
      const bytes = buildImportTemplate();
      const savedPath = await download(
        new Blob([bytes.buffer as ArrayBuffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'warpweft-import-template.xlsx',
      );
      setNotice(savedPath ? '模板已保存到 ' + savedPath : '模板已开始下载，请查看系统下载目录');
    } catch (cause) {
      setError('下载模板失败：' + messageOf(cause));
    }
  };

  return (
    <div className="resource-grid">
      <section className="section-panel resource-panel import-panel">
        <div className="panel-head"><SectionHeading english="IMPORT / VALIDATE" title="Excel 导入" /></div>
        <p className="panel-note">支持学校、班级、教师、学科、教室、时间段和教学计划。建议先下载模板；基础资料按名称复用，教学计划会整体替换，导入后自动清空候选课表。</p>
        <div className="import-actions">
          <label className="file-button file-button-primary">
            <span>选择 Excel 文件</span>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importWorkbookFile(file);
                event.currentTarget.value = '';
              }}
            />
          </label>
          <button type="button" className="file-button" onClick={() => void downloadTemplate()}>
            下载模板
          </button>
        </div>
        <label className="import-replace">
          <input type="checkbox" checked={replaceOnImport} onChange={(event) => setReplaceOnImport(event.target.checked)} />
          <span>导入前清空当前工作区</span>
        </label>
        <p className="panel-note">仅支持 Excel（.xlsx/.xls）；模板包含“说明、学校、班级、教师、学科、教室、时间段、教学计划”工作表。测试完整数据集时建议勾选上方清空选项。</p>
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
  const slots = [...data.timeSlots].sort((a, b) => a.day - b.day || a.period - b.period);
  const add = (teacherId: string, slotId: string) => {
    if (!slotId || unavailable.some((item) => item.teacherId === teacherId && item.slotId === slotId)) return;
    commit({ ...data, unavailableSlots: [...unavailable, { teacherId, slotId }] }, { invalidate: true });
  };
  const remove = (teacherId: string, slotId: string) => {
    commit(
      { ...data, unavailableSlots: unavailable.filter((item) => !(item.teacherId === teacherId && item.slotId === slotId)) },
      { invalidate: true },
    );
  };
  const clear = (teacherId: string) => {
    commit(
      { ...data, unavailableSlots: unavailable.filter((item) => item.teacherId !== teacherId) },
      { invalidate: true },
    );
  };

  return (
    <section className="section-panel resource-panel availability-panel">
      <div className="panel-head">
        <SectionHeading english="TEACHER AVAILABILITY" title="教师不可用时间" />
        <span className="status-tag muted">下拉选择</span>
      </div>
      <p className="panel-note">从下拉框选择教师不可用的时间段，添加后会显示为标签；点击标签即可移除。排课时会自动避开这些时间。</p>
      {data.teachers.length === 0 ? (
        <p className="panel-note">还没有教师，请先在教师资料中添加。</p>
      ) : slots.length === 0 ? (
        <p className="panel-note">还没有时间段，请先在时间段资料中添加。</p>
      ) : (
        <div className="availability-list">
          {data.teachers.map((teacher) => {
            const own = slots.filter((slot) => unavailable.some((item) => item.teacherId === teacher.id && item.slotId === slot.id));
            const remaining = slots.filter((slot) => !own.some((item) => item.id === slot.id));
            return (
              <div className="availability-person" key={teacher.id}>
                <div className="availability-person-head">
                  <strong>{teacher.name}</strong>
                  <small>{own.length > 0 ? own.length + ' 个不可用时间' : '全部时间可用'}</small>
                </div>
                <div className="availability-chips">
                  {own.length > 0 ? own.map((slot) => (
                    <button
                      type="button"
                      key={slot.id}
                      className="availability-chip"
                      onClick={() => remove(teacher.id, slot.id)}
                      title="点击移除"
                    >
                      {slot.label}<span>×</span>
                    </button>
                  )) : <span className="availability-empty">未设置</span>}
                </div>
                <div className="availability-actions">
                  <select
                    className="availability-select"
                    value=""
                    aria-label={'为 ' + teacher.name + ' 添加不可用时间'}
                    disabled={remaining.length === 0}
                    onChange={(event) => {
                      add(teacher.id, event.target.value);
                      event.currentTarget.value = '';
                    }}
                  >
                    <option value="">{remaining.length === 0 ? '全部时间已设置' : '+ 添加不可用时间'}</option>
                    {remaining.map((slot) => <option key={slot.id} value={slot.id}>{slot.label}</option>)}
                  </select>
                  {own.length > 0 ? (
                    <button type="button" className="availability-clear" onClick={() => clear(teacher.id)}>清空</button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="panel-note">修改教师不可用时间会清空候选课表，需重新排课。</p>
    </section>
  );
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

function RunsPage({ data, result, issues, running, progress, timeLimit, setTimeLimit, onRun, onTimetable, onClear, runMode }: {
  data: SchoolData; result: SolverOutput | null; issues: string[]; running: boolean; progress: RunProgress;
  timeLimit: number; setTimeLimit: (value: number) => void; onRun: () => void; onTimetable: () => void; onClear: () => void; runMode?: RunMode | null;
}) {
  const expected = data.coursePlans.reduce((sum, plan) => sum + Number(plan.weeklyPeriods || 0), 0);
  const missing = result ? missingPlans(data, result) : [];
  const checked = issues.length === 0;
  const canConfigure = checked && !running;
  const lockedCount = data.candidate?.entries.filter((entry) => entry.locked).length ?? 0;
  const modeLabel = RUN_MODE_OPTIONS.find((item) => item.value === runMode)?.title ?? '当前模式';
  return <div className="runs-wizard">
    <section className="section-panel wizard-intro"><SectionHeading english="SCHEDULE RUN" title="排课向导" /><p className="panel-note">按 01 → 02 → 03 → 04 完成配置。数据检查未通过时，后续步骤会锁定。</p><div className="wizard-stepper">{['数据检查', '排课规则', '计算设置', '开始排课'].map((label, index) => <div key={label} className={'wizard-stepper-item ' + (index === 0 && checked || index > 0 && canConfigure ? 'done' : '')}><b>0{index + 1}</b><span>{label}</span></div>)}</div>{progress.phase !== 'idle' ? <RunProgressView progress={progress} /> : null}</section>
    <div className="wizard-grid">
      <section className="section-panel wizard-card"><div className="wizard-card-head"><span className="wizard-number">01</span><div><span className="kicker">PREFLIGHT</span><h2>数据检查</h2></div><span className={issues.length ? 'status-tag danger' : 'status-tag'}>{issues.length ? issues.length + ' 项待处理' : '通过'}</span></div>{issues.length ? <ul className="issue-list">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : <p className="panel-note success-note">检查通过：{expected} 周课时、{data.timeSlots.length} 个可用时间格。</p>}<div className="hero-actions"><button className="ghost-button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>回到顶部查看状态</button></div></section>
      <section className={'section-panel wizard-card ' + (!checked ? 'wizard-locked' : '')}>
        <div className="wizard-card-head"><span className="wizard-number">02</span><div><span className="kicker">BUILT-IN RULES</span><h2>排课规则</h2></div><span className="status-tag">{checked ? '自动保证' : '待检查'}</span></div>
        {!checked ? <p className="panel-note">请先修复第 01 步的问题。</p> : (
          <>
            <div className="rule-summary">
              {[
                ['01', '班级不撞课', '同一班级同一时间只安排一门课'],
                ['02', '教师不撞课', '同一教师同一时间只安排一门课'],
                ['03', '教室匹配', '教室类型和容量必须满足班级'],
                ['04', '固定约束', '固定时间和教师不可用时间自动生效'],
              ].map(([number, title, description]) => (
                <div className="rule-item" key={number}><span>{number}</span><div><b>{title}</b><small>{description}</small></div><em>自动</em></div>
              ))}
            </div>
            <p className="panel-note">这些是硬性规则，不需要手动配置；求解器会优先保证。本版本使用内置均衡优化，不提供权重滑块。</p>
          </>
        )}
      </section>
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
  onPrint,
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
  onPrint: () => void;
}) {
  const [dragId, setDragId] = useState('');
  const [dragOver, setDragOver] = useState('');
  const [focus, setFocus] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [swapMode, setSwapMode] = useState(false);
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
  const entities = view === 'class' ? data.classes : view === 'teacher' ? data.teachers : data.rooms;
  const conflicts = result ? conflictIds(result.entries) : new Set<string>();
  const selected = result?.entries.find((entry) => entry.id === selectedEntryId);
  const selectedPlan = selected ? planOf(data, selected) : undefined;
  const selectedSlot = selected ? data.timeSlots.find((slot) => slot.id === selected.slotId) : undefined;
  const selectedClass = selected ? findClass(data, selected.classId) : undefined;
  const selectedTeacher = selected ? findTeacher(data, selected.teacherId) : undefined;
  const selectedRoom = selected ? findRoom(data, selected.roomId) : undefined;
  const missing = result ? missingPlans(data, result) : [];
  const totalMissing = missing.reduce((sum, item) => sum + item.missing, 0);
  const viewLabel = view === 'class' ? '班级' : view === 'teacher' ? '教师' : '教室';
  const entityName = entities.find((item) => item.id === entityId)?.name ?? '';
  const belongsHere = (entry: ScheduleEntry) => {
    if (view === 'class') return entry.classId === entityId;
    if (view === 'teacher') return entry.teacherId === entityId;
    return entry.roomId === entityId;
  };
  const viewEntries = result ? result.entries.filter(belongsHere) : [];
  const expectedForView =
    view === 'class'
      ? data.coursePlans.filter((plan) => plan.classId === entityId).reduce((sum, plan) => sum + Number(plan.weeklyPeriods || 0), 0)
      : view === 'teacher'
        ? data.coursePlans.filter((plan) => plan.teacherId === entityId).reduce((sum, plan) => sum + Number(plan.weeklyPeriods || 0), 0)
        : null;
  const missingForView = expectedForView === null ? null : Math.max(0, expectedForView - viewEntries.length);
  const viewConflictCount = viewEntries.filter((entry) => conflicts.has(entry.id)).length;
  const viewFreeSlots = Math.max(0, data.timeSlots.length - viewEntries.length);
  const canMove = Boolean(selected) && view === 'class' && !selected?.locked && !selectedPlan?.fixedSlotId;
  const slotAt = (day: number, period: number) => data.timeSlots.find((slot) => slot.day === day && slot.period === period);
  const entriesAt = (slotId: string) => viewEntries.filter((entry) => entry.slotId === slotId);
  const canPlaceSelected = (slot: TimeSlot): boolean => {
    if (!selected || !result || !canMove) return false;
    if (selectedPlan?.fixedSlotId && selectedPlan.fixedSlotId !== slot.id) return false;
    if ((data.unavailableSlots ?? []).some((item) => item.teacherId === selected.teacherId && item.slotId === slot.id)) return false;
    return !result.entries.some((entry) =>
      entry.id !== selected.id &&
      entry.slotId === slot.id &&
      (entry.teacherId === selected.teacherId || entry.roomId === selected.roomId)
    );
  };
  const moveTargets = canMove ? data.timeSlots.filter((slot) => slot.id !== selected?.slotId && canPlaceSelected(slot)) : [];
  const canSwapSelectedWith = (targetEntry: ScheduleEntry): boolean => {
    if (!selected || !result || view !== 'class' || targetEntry.id === selected.id) return false;
    if (selected.locked || targetEntry.locked) return false;
    if (targetEntry.classId !== selected.classId) return false;
    if (targetEntry.coursePlanId === selected.coursePlanId) return false;
    const targetPlan = planOf(data, targetEntry);
    if (selectedPlan?.fixedSlotId || targetPlan?.fixedSlotId) return false;
    const unavailable = data.unavailableSlots ?? [];
    if (unavailable.some((item) => item.teacherId === selected.teacherId && item.slotId === targetEntry.slotId)) return false;
    if (unavailable.some((item) => item.teacherId === targetEntry.teacherId && item.slotId === selected.slotId)) return false;
    const blocksTarget = result.entries.some((entry) =>
      entry.id !== selected.id && entry.id !== targetEntry.id && entry.slotId === targetEntry.slotId &&
      (entry.teacherId === selected.teacherId || entry.roomId === selected.roomId)
    );
    const blocksSource = result.entries.some((entry) =>
      entry.id !== selected.id && entry.id !== targetEntry.id && entry.slotId === selected.slotId &&
      (entry.teacherId === targetEntry.teacherId || entry.roomId === targetEntry.roomId)
    );
    return !blocksTarget && !blocksSource;
  };
  const swapTargets = selected && view === 'class' && result ? result.entries.filter(canSwapSelectedWith) : [];
  const swapTargetIds = new Set(swapTargets.map((entry) => entry.id));
  const moveLabel = selected ? planSubjectName(data, selectedPlan) : '';

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
          <span><b>{viewEntries.length}</b><em>已排</em></span>
          <span><b>{expectedForView ?? '—'}</b><em>计划</em></span>
          <span><b className={missingForView ? 'is-warn' : ''}>{missingForView ?? '—'}</b><em>未排</em></span>
          <span><b className={viewConflictCount ? 'is-danger' : ''}>{viewConflictCount}</b><em>冲突</em></span>
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
              <strong>{planSubjectName(data, selectedPlan)}</strong>
              <span>
                {selectedClass?.name ?? ''} · {selectedTeacher?.name ?? ''} · {selectedRoom?.name ?? ''} ·{' '}
                {selectedSlot?.label ?? '未知时间'}
              </span>
            </div>
            <div className="tt-selection-actions">
              {swapMode ? <span className={'tt-move-hint' + (swapTargets.length === 0 ? ' is-muted' : '')}>{swapTargets.length > 0 ? '交换模式：点击高亮课程（' + swapTargets.length + ' 个可交换）' : '交换模式：没有可交换的课程'}</span> : null}
              {!swapMode && canMove && moveTargets.length > 0 ? <span className="tt-move-hint">点击空白时间格移动（{moveTargets.length} 个可用）</span> : null}
              {!swapMode && canMove && moveTargets.length === 0 ? <span className="tt-move-hint is-muted" title="教师或教室在该时段已被占用；增加时间段或教师可释放空间">没有无冲突的移动目标</span> : null}
              {!swapMode && selected.locked ? <span className="tt-move-hint is-muted">已锁定，不可移动</span> : null}
              {!swapMode && selectedPlan?.fixedSlotId && !selected.locked ? <span className="tt-move-hint is-muted">固定时间，不可移动</span> : null}
              {view === 'class' && !selected.locked && !selectedPlan?.fixedSlotId ? <button className={'tt-btn' + (swapMode ? ' tt-btn-primary' : '')} onClick={() => setSwapMode((value) => !value)}>{swapMode ? '退出交换' : '交换课程'}</button> : null}
              <button className="tt-btn tt-btn-primary" onClick={() => onToggleLock(selected.id)}>
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
              {periods.map((period) => (
                <tr key={period}>
                  <th className="tt-period-cell">
                    <span>第{period}节</span>
                    <small>P{period}</small>
                  </th>
                  {days.map((day) => {
                    const slot = slotAt(day, period);
                    const cellEntries = slot ? entriesAt(slot.id) : [];
                    const isDragOver = dragOver === slot?.id;
                    const moveHere = Boolean(slot) && canMove && cellEntries.length === 0 && (slot ? canPlaceSelected(slot) : false);
                    return (
                      <td
                        key={day + '-' + period}
                        data-slot-id={slot?.id ?? ''}
                        className={
                          'tt-cell' +
                          (cellEntries.length ? ' is-filled' : ' is-empty') +
                          (isDragOver ? ' is-drop' : '') +
                          (moveHere ? ' can-move' : '')
                        }
                        title={moveHere && selected ? '把「' + moveLabel + '」移动到这里' : undefined}
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
                          if (cellEntries.length > 0) return;
                          if (moveHere && selected && slot) onSwap(selected.id, slot.id);
                          else if (!canMove) setSelectedEntryId('');
                        }}
                      >
                        {cellEntries.length ? (
                          cellEntries.map((entry) => {
                            const plan = planOf(data, entry);
                            const isConflict = conflicts.has(entry.id);
                            const teacher = findTeacher(data, entry.teacherId)?.name ?? '';
                            const room = findRoom(data, entry.roomId)?.name ?? '';
                            const className = findClass(data, entry.classId)?.name ?? '';
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
                                draggable={view === 'class' && !entry.locked}
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
                                  if (view !== 'class' || entry.locked) {
                                    event.preventDefault();
                                    return;
                                  }
                                  event.dataTransfer.effectAllowed = 'move';
                                  event.dataTransfer.setData('text/plain', entry.id);
                                  setDragId(entry.id);
                                }}
                                onDragEnd={() => setDragId('')}
                                title={
                                  entry.locked
                                    ? '已锁定，重新排课时保留位置'
                                    : view === 'class'
                                      ? '拖动课程交换时间，或选中后点击空白格移动'
                                      : planSubjectName(data, plan)
                                }
                              >
                                <span className="tt-card-top">
                                  <span className="tt-card-subject">{planSubjectName(data, plan)}</span>
                                  {entry.locked ? <span className="tt-card-lock">锁定</span> : null}
                                </span>
                                <span className="tt-card-meta">
                                  {view === 'class'
                                    ? teacher + ' · ' + room
                                    : view === 'teacher'
                                      ? className + ' · ' + room
                                      : className + ' · ' + teacher}
                                </span>
                                {entry.source === 'MANUAL' || isConflict ? (
                                  <span className="tt-card-badges">
                                    {entry.source === 'MANUAL' ? <em>手工</em> : null}
                                    {isConflict ? <em className="is-danger">冲突</em> : null}
                                  </span>
                                ) : null}
                              </button>
                            );
                          })
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
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="tt-footer">
        <div className="tt-legend">
          <span><i className="tt-dot is-normal" />普通课程</span>
          <span><i className="tt-dot is-locked" />已锁定</span>
          <span><i className="tt-dot is-conflict" />冲突</span>
          <span><i className="tt-dot is-manual" />手工调整</span>
        </div>
        <span className="tt-footer-note">本视图空档 {viewFreeSlots} 个 · 拖动课程可交换位置 · 锁定后重新排课保留原时间</span>
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
