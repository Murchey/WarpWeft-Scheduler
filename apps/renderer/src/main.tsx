import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HeroUIProvider, Button, Card, CardBody, Chip, Progress, Select, SelectItem, Tabs, Tab } from '@heroui/react';
import { validateInput } from '../../../packages/validation/src';
import { consecutiveOf, fixedSlotIdsOf } from '../../../packages/contracts/src';
import { exportCsv, exportWorkbook, readWorkbook } from '../../../packages/import-export/src';
import { ApiError, cancelServerJob, clearAuthToken, createUser, DEFAULT_API_BASE, deleteServerClient, deleteUser, fetchHealth, fetchHealthAt, fetchMe, fetchServerOverview, fetchUsers, getApiBase, getAuthToken, loadData, login, logout, registerUnauthorizedHandler, saveData, setAuthToken, solveSchedule, updateServerConfig, updateUser } from './api';
import { DAYS, SectionHeading } from './components';
import { I18nProvider, useI18n, useFormatters } from './i18n';
import type { MessageKey } from './i18n';
import { currentLang, fmtDateTime } from './i18n/format';
import { PreparePage } from './PreparePage';
import type { PrepareSection } from './PreparePage';
import { download, downloadFiles, exportMessage } from './download';
import type { ExportResult } from './download';
import { TimetableExportDialog } from './TimetableExportDialog';
import { batchTimetableEntryFileName, batchTimetableFileName, batchTimetableFolderName, timetableFileName, uniqueFileName, VIEW_LABELS } from './timetableExport';
import { loadTimetableTemplate } from './timetableTemplateLoader';
import { fillBatchTimetableFiles, fillBatchTimetableTemplate, fillSemesterTemplate, fillTimetableTemplate } from './timetableTemplate';
import type { BatchTimetableItem } from './timetableTemplate';
import type { BatchTimetableSelection, TimetableExportSettings } from './timetableExport';
import { checkMove, checkSwap } from './dnd';
import { semesterWeeks, weekOfDate } from '../../../packages/semester/src';
import { adjustedWeekEntries, semesterPatterns } from './semesterTimetable';
import brandIcon from '../../../assets/icon.svg?url';
import { readPreviewPrefs, savePreviewPrefs, weekDatesForHeader } from './timetablePreview';
import { appendToastLog, readToastLogs, saveToastLogs } from './toastLog';
import type { ToastLogEntry, ToastTone } from './toastLog';
import { DATA_SCHEMA_VERSION, MIN_SERVER_SCHEMA } from './schema';
import { withFixedClassRoomsResult } from './fixedClassrooms';
import type { PreviewWeekFilter, PreviewView } from './timetablePreview';
import { assignMissingTeachers, classIdsForTeacher, splitClassNames, subjectIdsForTeacher } from './teacherAssignment';
import { ensureSimplifiedRooms, isSimplifiedRooms } from './fixedClassrooms';
import { messageOf, todayLocal, uid } from './utils';
import { clearSavedLogins, forgetSavedLogin, readSavedLogins, rememberSavedLogin } from './savedLogins';
import type { SavedLogin } from './savedLogins';
import { activeRules, describeRule, matchedPlans, unscheduledHints } from './rules';
import { RUN_MODE_LABEL_KEYS, RUN_MODE_OPTIONS } from './runConfig';
import { CLOUD_ENDPOINT_PLACEHOLDER, cleanEndpoint, endpointForMode, initialEndpointForMode, RUNTIME_MODE_KEY, readActiveEndpoint, readEndpointMemory, rememberEndpoint, writeActiveEndpoint, writeEndpointMemory } from './runtimeEndpoint';
import type { EndpointMemory } from './runtimeEndpoint';
import type { RunProgress, ShortRunRecord } from './runConfig';
import { serializeWorkspace, workspaceFileName } from './workspaceProject';
import { EmptyState, RunProgressView } from './runViews';
import { findClass, findRoom, findSubject, findTeacher, missingPlans, planOf, planSubjectName } from './selectors';
import { RunsPage } from './RunsPage';
import { InspectionPage } from './InspectionPage';
import { KIND_LABELS, inspectTimetable, reportRows, slotKindAcceptsPlan, weekMask, weeksOverlap } from '../../../packages/inspection/src';
import type { InspectionRefs, InspectionReport } from '../../../packages/inspection/src';
import { StatsPage } from './StatsPage';
import { BASE_SOFT_CONSTRAINTS } from './softConstraints';
import { AdjustmentsPage } from './AdjustmentsPage';
import { TodayPanel } from './TodayPanel';
import { buildStats, classRowsForExport, subjectRowsForExport, teacherRowsForExport } from '../../../packages/statistics/src';
import type { StatsReport } from '../../../packages/statistics/src';
import { ADJUSTMENT_LABELS, LESSON_STATUS_LABELS, effectiveAdjustments, buildActualStats, effectiveEntries, isNoopMove, weekdayOf } from '../../../packages/adjustments/src';
import type { ActualStats } from '../../../packages/adjustments/src';
import type { AuthUser, ServerClient, ServerConfig, ServerConfigResult, ServerEffective, ServerJob, ServerLog, ServerStats } from './api';
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

const TABS = ['工作台', '排课准备', '排课任务', '课表预览', '调代课', '最终课表', '统计报表', '服务端', '设置'] as const;
type Tab = (typeof TABS)[number];

/**
 * 导航文案 key。TABS 继续用中文作为稳定的内部 id —— URL 参数、条件渲染
 * (`tab === '设置'`) 和既有深链都依赖它，因此只把**显示文案**交给 i18n。
 */
const TAB_LABEL_KEY: Record<Tab, MessageKey> = {
  工作台: 'nav.dashboard',
  排课准备: 'nav.prepare',
  排课任务: 'nav.runs',
  课表预览: 'nav.preview',
  调代课: 'nav.adjust',
  最终课表: 'nav.final',
  统计报表: 'nav.stats',
  服务端: 'nav.server',
  设置: 'nav.settings',
};
type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error';
type View = PreviewView;




function RuntimeModeDialog({ current, onSave, onClose }: { current: RunMode | null; onSave: (mode: RunMode, endpoint: string) => void; onClose?: () => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<RunMode>(current ?? 'single');
  const [memory] = useState<EndpointMemory>(() => readEndpointMemory(window.localStorage));
  const [endpoint, setEndpoint] = useState(() => initialEndpointForMode(mode, current ? readActiveEndpoint(window.localStorage) : '', memory, DEFAULT_API_BASE));
  const [testing, setTesting] = useState(false);
  // 结果用结构化状态保存，避免靠中文前缀判断成功/失败（切语言后判断会失效）
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const endpointValid = (() => {
    try {
      const url = new URL(endpoint);
      return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.host);
    } catch {
      return false;
    }
  })();
  // Switching modes must also switch the service address: local modes go back
  // to the local API, while remote modes keep their own remembered addresses.
  const chooseMode = (nextMode: RunMode) => {
    if (nextMode === mode) return;
    rememberEndpoint(memory, mode, endpoint, DEFAULT_API_BASE);
    setMode(nextMode);
    setEndpoint(endpointForMode(nextMode, { current: endpoint, remembered: memory, localBase: DEFAULT_API_BASE }));
  };
  const save = () => {
    const normalized = endpoint.trim().replace(/\/+$/, '');
    rememberEndpoint(memory, mode, normalized, DEFAULT_API_BASE);
    writeEndpointMemory(memory, window.localStorage);
    onSave(mode, normalized);
  };
  const testConnection = async () => {
    if (!endpointValid) return;
    setTesting(true);
    setTestResult({ ok: true, text: t('common.connecting') });
    try {
      const health = await fetchHealthAt(endpoint);
      setTestResult({
        ok: true,
        text: `schema v${health.schemaVersion ?? '?'} · Solver ${health.solverProtocol ?? '?'}`,
      });
    } catch (cause) {
      setTestResult({ ok: false, text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setTesting(false);
    }
  };
  return (
    <div className="mode-overlay" role="dialog" aria-modal="true">
      <div className="mode-dialog">
        <div className="mode-dialog-head">
          {onClose ? <button className="banner-close" onClick={onClose} aria-label={t('common.close')}>×</button> : null}
        </div>
        <h2>{current ? t('dialog.runtime.title') : t('dialog.runtime.choose')}</h2>
        <p className="mode-lead">{t('dialog.runtime.lead')}</p>
        <div className="mode-options">
          {RUN_MODE_OPTIONS.map((item) => (
            <button key={item.value} className={'mode-option' + (mode === item.value ? ' selected' : '')} onClick={() => chooseMode(item.value)}>
              <span className="mode-option-index">0{RUN_MODE_OPTIONS.indexOf(item) + 1}</span>
              <span><b>{t(RUN_MODE_LABEL_KEYS[item.value].title)}</b><small>{t(RUN_MODE_LABEL_KEYS[item.value].description)}</small></span>
            </button>
          ))}
        </div>
        <label className="mode-endpoint">
          {t('dialog.runtime.endpoint')}
          <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="http://192.168.1.20:4317" />
          <small>
            {mode === 'single' || mode === 'lan-server' ? t('dialog.runtime.localHint') : t('dialog.runtime.remoteHint')}
            {endpoint && !endpointValid ? ' ' + t('dialog.runtime.invalid') : ''}
          </small>
          {testResult ? <small className={testResult.ok ? 'mode-test-success' : 'mode-test-error'}>{testResult.text}</small> : null}
        </label>
        <div className="mode-actions">
          <button className="ghost-button" onClick={onClose} disabled={!current}>{t('common.cancel')}</button>
          <button className="ghost-button" disabled={!endpointValid || testing} onClick={() => void testConnection()}>{testing ? t('dialog.runtime.testing') : t('dialog.runtime.test')}</button>
          <button className="action-button" disabled={!endpointValid} onClick={save}>{current ? t('dialog.runtime.save') : t('dialog.runtime.enter')} <span>↗</span></button>
        </div>
      </div>
    </div>
  );
}



function LoginScreen({
  needsSetup,
  busy,
  error,
  onLogin,
  onSettings,
}: {
  needsSetup: boolean;
  busy: boolean;
  error: string;
  onLogin: (username: string, password: string, remember: boolean) => void;
  onSettings: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [saved, setSaved] = useState<SavedLogin[]>(() => readSavedLogins(getApiBase()));
  const { t } = useI18n();
  return (
    <div className="mode-overlay">
      <form
        className="mode-dialog auth-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && !needsSetup && username.trim() && password) onLogin(username.trim(), password, remember);
        }}
      >
        <div className="mode-dialog-head" />
        <h2>{t('dialog.login.title')}</h2>
        <p className="mode-lead">{t('dialog.login.lead')}</p>
        {needsSetup ? (
          <div className="server-warning">
            {t('login.needsSetup')}
            <code>sudo warpweft user add admin --admin</code>
          </div>
        ) : null}
        {saved.length > 0 ? (
          <div className="saved-logins">
            <div className="saved-logins-head">
              <span>{t('login.savedAccounts')}</span>
              <button
                type="button"
                className="server-inline-btn"
                onClick={() => {
                  if (!window.confirm(t('login.confirmClearAll'))) return;
                  setSaved(clearSavedLogins(getApiBase()));
                  setPassword('');
                }}
              >
                {t('login.clear')}
              </button>
            </div>
            {saved.map((item) => (
              <div className="saved-login-row" key={item.username}>
                <button
                  type="button"
                  className="saved-login-pick"
                  onClick={() => {
                    setUsername(item.username);
                    setPassword(item.password);
                    setRemember(true);
                  }}
                  title={t('login.fillAccount')}
                >
                  {item.username}
                </button>
                <button
                  type="button"
                  className="saved-login-delete"
                  onClick={() => {
                    if (!window.confirm(t('login.confirmDeleteOne', { name: item.username }))) return;
                    setSaved(forgetSavedLogin(item.username, getApiBase()));
                    if (username === item.username) setPassword('');
                  }}
                  title={t('login.confirmDeleteOne', { name: item.username })}
                >
                  {t('common.delete')}
                </button>
              </div>
            ))}
            <p className="saved-logins-hint">{t('login.savedHint')}</p>
          </div>
        ) : null}
        <label className="mode-endpoint">{t('login.username')}<input autoFocus value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" disabled={busy || needsSetup} /></label>
        <label className="mode-endpoint">{t('login.password')}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" disabled={busy || needsSetup} /></label>
        {error ? <p className="server-save-error">{error}</p> : null}
        <label className="auth-remember">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} disabled={busy || needsSetup} />
          <span>{t('login.remember')}</span>
          <small>{t('login.rememberHint')}</small>
        </label>
        <div className="mode-actions">
          <button type="button" className="ghost-button" onClick={onSettings}>{t('login.connection')}</button>
          <button type="button" className="ghost-button" onClick={() => window.location.reload()}>{t('login.recheck')}</button>
          <button className="action-button" disabled={busy || needsSetup || !username.trim() || !password}>{busy ? t('login.submitting') : t('login.submit')} <span>↗</span></button>
        </div>
      </form>
    </div>
  );
}

function fmtTime(value?: string): string {
  if (!value) return '—';
  const formatted = fmtDateTime(value, currentLang(), {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return formatted || value;
}


const UNASSIGNED_TEACHER_PREFIX = '__unassigned__:';

function solverTeacherId(plan: CoursePlan): string {
  return plan.teacherId?.trim() ? plan.teacherId : UNASSIGNED_TEACHER_PREFIX + plan.id;
}

function restoreUnassignedTeachers(output: SolverOutput): SolverOutput {
  return {
    ...output,
    entries: output.entries.map((entry) =>
      entry.teacherId?.startsWith(UNASSIGNED_TEACHER_PREFIX) ? { ...entry, teacherId: '' } : entry,
    ),
  };
}

function toSolverInput(
  data: SchoolData,
  timeLimit: number,
  locked: ScheduleEntry[],
  randomSeed = 1,
): SolverInput {
  const resolvedPlans = assignMissingTeachers(data).plans;
  const planById = new Map(resolvedPlans.map((plan) => [plan.id, plan]));
  const lockedEntries = locked.map((entry) => {
    const plan = planById.get(entry.coursePlanId);
    return plan && !plan.teacherId?.trim() ? { ...entry, teacherId: solverTeacherId(plan) } : entry;
  });
  const syntheticTeachers = resolvedPlans
    .filter((plan) => !plan.teacherId?.trim())
    .map((plan) => ({ id: solverTeacherId(plan), name: '未指定教师' }));
  const effectiveData = ensureSimplifiedRooms(data);
  return {
    protocolVersion: '1.0',
    dataSchemaVersion: DATA_SCHEMA_VERSION,
    // Must be stable for the same workspace. A timestamp here made every
    // long-job snapshot look stale, even when nothing had changed.
    dataSnapshotVersion: 'local-' + (data.updatedAt || 'workspace'),
    timeSlots: effectiveData.timeSlots,
    classes: effectiveData.classes.map((item) => ({
      id: item.id,
      name: item.name,
      size: item.size,
      ...(item.homeroomTeacherId ? { homeroomTeacherId: item.homeroomTeacherId } : {}),
    })),
    teachers: [
      ...effectiveData.teachers.map((teacher) => {
        const classIds = classIdsForTeacher(teacher, effectiveData.classes);
        const subjectIds = subjectIdsForTeacher(teacher, effectiveData.subjects);
        return {
          id: teacher.id,
          name: teacher.name,
          ...(classIds.length ? { classIds } : {}),
          ...(subjectIds.length ? { subjectIds } : {}),
        };
      }),
      ...syntheticTeachers,
    ],
    subjects: effectiveData.subjects,
    rooms: effectiveData.rooms,
    coursePlans: resolvedPlans.map((plan) => ({ ...plan, teacherId: solverTeacherId(plan) })),
    unavailableSlots: data.unavailableSlots ?? [],
    lockedEntries,
    electiveGroups: data.electiveGroups ?? [],
    hardConstraints: ['NO_CLASS_CONFLICT', 'NO_TEACHER_CONFLICT', 'ROOM_CAPACITY'],
    rules: data.rules ?? [],
    softConstraints: data.softConstraints ?? BASE_SOFT_CONSTRAINTS,
    timeLimitSeconds: timeLimit,
    randomSeed: Number.isFinite(randomSeed) ? Math.max(0, Math.floor(randomSeed)) : 1,
  };
}

function planShortageText(data: SchoolData, output: SolverOutput): string {
  const lines: string[] = [];
  for (const plan of data.coursePlans) {
    const placed = output.entries.filter((entry) => entry.coursePlanId === plan.id).length;
    const missing = Number(plan.weeklyPeriods || 0) - placed;
    if (missing <= 0) continue;
    const klass = data.classes.find((item) => item.id === plan.classId)?.name ?? plan.classId;
    const subject = data.subjects.find((item) => item.id === plan.subjectId)?.name ?? plan.subjectId;
    const teacher = plan.teacherId ? data.teachers.find((item) => item.id === plan.teacherId)?.name : '未指定教师';
    lines.push(klass + ' ' + subject + '（' + (teacher || '未指定教师') + '）计划 ' + plan.weeklyPeriods + '，已排 ' + placed + '，缺 ' + missing);
  }
  if (lines.length === 0) return '';
  return '未排计划：\n' + lines.slice(0, 8).join('\n') + (lines.length > 8 ? '\n…还有 ' + (lines.length - 8) + ' 条' : '');
}
function preflight(inputData: SchoolData): string[] {
  const data = ensureSimplifiedRooms(inputData);
  const issues = validateInput(toSolverInput(data, 30, [])).map((issue) => issue.message);
  if (data.classes.length === 0) issues.push('至少需要一个班级');
  if (data.teachers.length === 0) issues.push('至少需要一位教师');
  if (!isSimplifiedRooms(data) && data.rooms.length === 0) issues.push('至少需要一间教室');
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
  for (const teacher of data.teachers) {
    const names = splitClassNames(teacher.classes);
    if (names.length === 0) continue;
    for (const name of names) {
      if (!data.classes.some((klass) => klass.name.trim().toLowerCase() === name.toLowerCase())) {
        issues.push('教师 ' + teacher.name + ' 的负责班级不存在：' + name);
      }
    }
    for (const plan of data.coursePlans.filter((item) => item.teacherId === teacher.id)) {
      const klass = findClass(data, plan.classId);
      if (klass && !names.some((name) => name.toLowerCase() === klass.name.trim().toLowerCase())) {
        issues.push('教师 ' + teacher.name + ' 不负责班级 ' + klass.name);
      }
    }
  }
  for (const plan of data.coursePlans) {
    if (!findSubject(data, plan.subjectId)) {
      issues.push((findClass(data, plan.classId)?.name ?? '未知班级') + ' 的教学计划引用了不存在的学科');
    }
    const planKind = plan.kind ?? 'regular';
    if (!data.timeSlots.some((slot) => slotKindAcceptsPlan(slot.kind, planKind))) {
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
    if (!teacherIds.has(item.teacherId) || !slotIds.has(item.slotId)) {
      issues.push('教师不可用时间引用了不存在的教师或时间段；请检查教师不可用时间表');
    }
  }
  const planText = (plan: CoursePlan) =>
    (findClass(data, plan.classId)?.name ?? '未知班级') + ' / ' + planSubjectName(data, plan);
  const fixed = new Map<string, { id: string; label: string; weeks: string }[]>();
  for (const plan of data.coursePlans) {
    const consecutive = consecutiveOf(plan);
    if (consecutive >= 2 && consecutive > Number(plan.weeklyPeriods || 0)) {
      issues.push(planText(plan) + ' 的连堂节数 ' + consecutive + ' 超过周课时 ' + plan.weeklyPeriods + ' 节');
    }
    const fixedSlotIds = fixedSlotIdsOf(plan);
    if (fixedSlotIds.length === 0) continue;
    if (fixedSlotIds.length > Number(plan.weeklyPeriods || 0)) {
      issues.push(planText(plan) + ' 的固定时间有 ' + fixedSlotIds.length + ' 节，超过周课时 ' + plan.weeklyPeriods + ' 节');
    }
    const weeks = plan.weeks ?? 'all';
    for (const slotId of fixedSlotIds) {
      for (const key of ['c:' + plan.classId + ':' + slotId, 't:' + plan.teacherId + ':' + slotId]) {
        const prior = fixed.get(key) ?? [];
        const clash = prior.find((item) => weeksOverlap(item.weeks, weeks));
        if (clash) issues.push('固定时间冲突：「' + clash.label + '」与「' + planText(plan) + '」不能同时占用同一时间');
        else prior.push({ id: plan.id, label: planText(plan), weeks });
        fixed.set(key, prior);
      }
    }
  }
  const pairGroups = new Map<string, CoursePlan[]>();
  for (const plan of data.coursePlans) {
    if (!plan.pairId) continue;
    pairGroups.set(plan.pairId, [...(pairGroups.get(plan.pairId) ?? []), plan]);
  }
  for (const [pairId, group] of pairGroups) {
    if (group.length < 2) {
      issues.push('配对组「' + pairId + '」只有 1 条计划，至少需要两条才能同格');
      continue;
    }
    for (const plan of group) {
      const overlap = group.some((other) => other.id !== plan.id
        && other.classId === plan.classId
        && weeksOverlap(other.weeks ?? 'all', plan.weeks ?? 'all'));
      if (overlap) {
        issues.push('配对组「' + pairId + '」在 ' + (findClass(data, plan.classId)?.name ?? plan.classId) + ' 的周次重叠，无法共用同一时段');
        break;
      }
    }
    const fixedKey = (plan: CoursePlan) => fixedSlotIdsOf(plan).join('|');
    if (new Set(group.map(fixedKey)).size > 1) {
      issues.push('配对组「' + pairId + '」的固定时间必须完全一致');
    }
  }
  return Array.from(new Set(issues));
}

function conflictIds(entries: ScheduleEntry[], plans: CoursePlan[] = []): Set<string> {
  const weeksOfPlan = new Map(plans.map((plan) => [plan.id, plan.weeks ?? 'all']));
  const weeksOf = (entry: ScheduleEntry) => entry.weeks ?? weeksOfPlan.get(entry.coursePlanId) ?? 'all';
  const groups = new Map<string, ScheduleEntry[]>();
  for (const entry of entries) {
    const keys = [
      'class:' + entry.classId + ':' + entry.slotId,
      'room:' + entry.roomId + ':' + entry.slotId,
    ];
    if (entry.teacherId) keys.push('teacher:' + entry.teacherId + ':' + entry.slotId);
    for (const key of keys) {
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

function hardConflictText(report: InspectionReport, limit = 4): string {
  const hard = report.issues.filter((issue) => issue.severity === 'hard');
  const lines = hard.slice(0, limit).map((issue) => '· ' + issue.title + '：' + issue.detail);
  if (hard.length > limit) lines.push('…还有 ' + (hard.length - limit) + ' 项硬冲突');
  return lines.join('\n');
}

function conflictSignature(report: InspectionReport | null): string {
  if (!report) return '';
  return report.summary.hard + ':' + report.issues.filter((issue) => issue.severity === 'hard').map((issue) => issue.id).sort().join('|');
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

type ToastState = {
  id: number;
  tone: ToastTone;
  title: string;
  message: string;
  createdAt: number;
  expiresAt: number;
  duration: number;
};

function ToastView({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  return (
    <div className={'app-toast is-' + toast.tone} role={toast.tone === 'error' ? 'alert' : 'status'}>
      <div className="app-toast-mark">{toast.tone === 'success' ? '✓' : toast.tone === 'error' ? '!' : 'i'}</div>
      <div className="app-toast-copy">
        <strong>{toast.title}</strong>
        <p>{toast.message}</p>
      </div>
      <button type="button" className="app-toast-close" onClick={onClose} aria-label="关闭提示">
        ×
      </button>
      <div className="app-toast-progress">
        <i style={{ animationDuration: toast.duration + 'ms' }} />
      </div>
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



function EmptyDataScreen({ message, onRetry, onSettings }: { message: string; onRetry: () => void; onSettings: () => void }) {
  const { t } = useI18n();
  return <div className="empty-data-screen"><div className="empty-data-mark">W</div><h1>{t('empty.title')}</h1><p>{message || t('empty.lead')}</p><div className="hero-actions"><button className="action-button" onClick={onRetry}>{t('empty.retry')} <span>↗</span></button><button className="ghost-button" onClick={onSettings}>{t('empty.settings')}</button></div></div>;
}

function App() {
  const { t, lang, toggleLang } = useI18n();
  const params = new URLSearchParams(window.location.search);
  const electronShell = Boolean((window as unknown as { warpweft?: unknown }).warpweft);
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
      const mode = forcedMode as RunMode;
      window.localStorage.setItem(RUNTIME_MODE_KEY, mode);
      const memory = readEndpointMemory(window.localStorage);
      const forced = cleanEndpoint(forcedEndpoint);
      if (forced) {
        writeActiveEndpoint(forced, window.localStorage);
        rememberEndpoint(memory, mode, forced, DEFAULT_API_BASE);
      } else {
        // A mode-only link should not reuse the previous mode's endpoint.
        const resolved = endpointForMode(mode, { current: readActiveEndpoint(window.localStorage), remembered: memory, localBase: DEFAULT_API_BASE });
        if (resolved !== CLOUD_ENDPOINT_PLACEHOLDER) {
          writeActiveEndpoint(resolved, window.localStorage);
          rememberEndpoint(memory, mode, resolved, DEFAULT_API_BASE);
        }
      }
      writeEndpointMemory(memory, window.localStorage);
      return mode;
    }
    const saved = window.localStorage.getItem(RUNTIME_MODE_KEY);
    return saved === 'single' || saved === 'lan-server' || saved === 'lan-client' || saved === 'cloud' ? saved : null;
  });
  const [modeSettingsOpen, setModeSettingsOpen] = useState(false);
  // Saving the same run mode with a different endpoint must still re-run
  // bootstrap; otherwise "链接云端" silently keeps using the old URL.
  const [modeRevision, setModeRevision] = useState(0);
  const [data, setData] = useState<SchoolData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [result, setResult] = useState<SolverOutput | null>(null);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [connectionRetry, setConnectionRetry] = useState(0);
  const [serverSchema, setServerSchema] = useState<number | null>(null);
  const [serverBlocked, setServerBlocked] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authNeedsSetup, setAuthNeedsSetup] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RunProgress>({ phase: 'idle', message: '等待开始排课' });
  const [shortRuns, setShortRuns] = useState<ShortRunRecord[]>([]);
  const deleteShortRun = useCallback((id: string) => {
    setShortRuns((current) => current.filter((run) => run.id !== id));
  }, []);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [toastLogs, setToastLogs] = useState<ToastLogEntry[]>(() => readToastLogs());
  const toastRef = useRef<ToastState | null>(null);
  const toastSeq = useRef(0);
  const recordToast = useCallback((current: ToastState, reason: 'timeout' | 'closed' | 'replaced') => {
    setToastLogs((entries) => appendToastLog(entries, { ...current, at: current.createdAt, reason }));
  }, []);
  useEffect(() => {
    saveToastLogs(toastLogs);
  }, [toastLogs]);
  const showToast = useCallback(
    (tone: ToastTone, title: string, message: string, duration = 30000) => {
      const previous = toastRef.current;
      if (previous && previous.tone === tone && previous.title === title && previous.message === message) {
        return;
      }
      if (previous) recordToast(previous, 'replaced');
      const now = Date.now();
      const next: ToastState = {
        id: ++toastSeq.current,
        tone,
        title,
        message,
        createdAt: now,
        expiresAt: now + duration,
        duration,
      };
      toastRef.current = next;
      setToast(next);
    },
    [recordToast],
  );
  const dismissToast = useCallback(
    (id: number, reason: 'timeout' | 'closed' = 'closed') => {
      const current = toastRef.current;
      if (!current || current.id !== id) return;
      toastRef.current = null;
      setToast(null);
      recordToast(current, reason);
    },
    [recordToast],
  );
  const setError = useCallback(
    (message: string) => {
      if (!message) {
        if (toastRef.current?.tone === 'error') dismissToast(toastRef.current.id, 'closed');
        return;
      }
      showToast('error', '操作未完成', message);
    },
    [dismissToast, showToast],
  );
  const setNotice = useCallback(
    (message: string) => {
      if (!message) {
        if (toastRef.current?.tone === 'success') dismissToast(toastRef.current.id, 'closed');
        return;
      }
      showToast('success', '已完成', message);
    },
    [dismissToast, showToast],
  );
  const setWarning = useCallback(
    (message: string) => showToast('warning', '需要注意', message),
    [showToast],
  );
  const clearToastLogs = useCallback(() => {
    setToastLogs([]);
    saveToastLogs([]);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const remaining = Math.max(0, toast.expiresAt - Date.now());
    const timer = window.setTimeout(() => dismissToast(toast.id, 'timeout'), remaining);
    return () => window.clearTimeout(timer);
  }, [toast, dismissToast]);
  const [previewPrefs] = useState(() => readPreviewPrefs(window.localStorage));
  const [selectedClassId, setSelectedClassId] = useState('');
  const [view, setView] = useState<View>(previewPrefs.view);
  const [entityId, setEntityId] = useState(previewPrefs.entityId);
  const [weekFilter, setWeekFilter] = useState<PreviewWeekFilter>(previewPrefs.weekFilter);
  const [weekNo, setWeekNo] = useState<number | null>(previewPrefs.weekNo);
  const [overlayDate, setOverlayDate] = useState(() => params.get('adjustDate') || previewPrefs.overlayDate);
  const [selectedEntryId, setSelectedEntryId] = useState('');
  const [exportOpen, setExportOpen] = useState<null | 'export' | 'publish'>(null);
  const [exportWeek, setExportWeek] = useState<number | null>(null);
  const [exportBatch, setExportBatch] = useState(false);
  const [history, setHistory] = useState<SolverOutput[]>([]);
  const [timeLimit, setTimeLimit] = useState(30);
  const [randomSeed, setRandomSeed] = useState(1);
  const saveTimer = useRef<number | null>(null);
  const pending = useRef<SchoolData | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('warpweft-theme', theme);
  }, [theme]);

  // The preview toolbar is a working context, so remember it across tabs and
  // restarts. Transient modes (fullscreen, swapping, drag) stay local.
  useEffect(() => {
    savePreviewPrefs(window.localStorage, { view, entityId, weekFilter, weekNo, overlayDate });
  }, [view, entityId, weekFilter, weekNo, overlayDate]);

  const loadWorkspace = useCallback(async () => {
    const loaded = await loadData();
    setData(loaded);
    setLoadError('');
    setApiOnline(true);
    setSelectedClassId(loaded.classes[0]?.id ?? '');
    setResult(loaded.candidate ?? loaded.published ?? null);
  }, []);

  useEffect(() => {
    registerUnauthorizedHandler(() => {
      setAuthUser(null);
      setData(null);
      setResult(null);
      setAuthRequired(true);
      setAuthError('登录已过期，请重新登录。');
    });
    return () => registerUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    if (!runMode) {
      setAuthChecking(false);
      return;
    }
    let cancelled = false;
    const bootstrap = async () => {
      setAuthChecking(true);
      setAuthError('');
      setApiOnline(null);
      try {
        const health = await fetchHealth();
        if (cancelled) return;
        setApiOnline(true);
        const schema = Number(health.schemaVersion) || 1;
        setServerSchema(schema);
        setServerBlocked(schema < MIN_SERVER_SCHEMA);
        const required = Boolean(health.auth?.required);
        setAuthRequired(required);
        setAuthNeedsSetup(Boolean(health.auth?.needsSetup));
        if (required) {
          const token = getAuthToken();
          if (!token) {
            setAuthUser(null);
            return;
          }
          try {
            const me = await fetchMe();
            if (cancelled) return;
            setAuthUser(me.user);
          } catch {
            clearAuthToken();
            if (!cancelled) setAuthUser(null);
            return;
          }
        } else {
          setAuthUser(null);
        }
        try {
          await loadWorkspace();
        } catch (cause) {
          if (cancelled) return;
          if (cause instanceof ApiError && cause.status === 401) {
            setAuthUser(null);
            return;
          }
          throw cause;
        }
      } catch {
        if (cancelled) return;
        setApiOnline(false);
        setAuthUser(null);
        setLoadError('服务端未连接，当前没有加载任何测试数据。');
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [runMode, modeRevision, loadWorkspace, connectionRetry]);

  const handleLogin = async (username: string, password: string, remember: boolean) => {
    setAuthBusy(true);
    setAuthError('');
    try {
      const session = await login(username, password);
      setAuthToken(session.token);
      if (remember) rememberSavedLogin({ username, password }, getApiBase());
      else forgetSavedLogin(username, getApiBase());
      setAuthUser(session.user);
      setAuthRequired(true);
      setAuthNeedsSetup(false);
      setAuthChecking(true);
      await loadWorkspace();
    } catch (cause) {
      setAuthUser(null);
      setAuthError(messageOf(cause));
    } finally {
      setAuthBusy(false);
      setAuthChecking(false);
    }
  };

  const handleLogout = async () => {
    if (!window.confirm('确认退出当前服务端账号？退出后需要重新登录。')) return;
    try {
      await logout();
    } catch {
      // The local token is cleared even if the old session is already gone.
    } finally {
      clearAuthToken();
      setAuthUser(null);
      setData(null);
      setResult(null);
      setAuthError('');
      setApiOnline(true);
      setAuthChecking(false);
    }
  };

  const saveRunMode = (nextMode: RunMode, endpoint: string) => {
    const normalized = endpoint.trim().replace(/\/+$/, '');
    const memory = readEndpointMemory(window.localStorage);
    rememberEndpoint(memory, nextMode, normalized, DEFAULT_API_BASE);
    writeEndpointMemory(memory, window.localStorage);
    window.localStorage.setItem(RUNTIME_MODE_KEY, nextMode);
    writeActiveEndpoint(normalized || (nextMode === 'cloud' ? CLOUD_ENDPOINT_PLACEHOLDER : DEFAULT_API_BASE), window.localStorage);
    setRunMode(nextMode);
    setModeSettingsOpen(false);
    setApiOnline(null);
    setAuthUser(null);
    setData(null);
    setResult(null);
    setAuthError('');
    setModeRevision((value) => value + 1);
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
    if (!data || weekNo === null) return;
    if (semesterWeeks(data.semester).some((week) => week.index === weekNo)) return;
    setWeekNo(null);
    setWeekFilter('all');
  }, [data, weekNo]);

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
    if (serverBlocked) {
      setError('服务端版本过旧（数据版本 v' + (serverSchema ?? '未知') + '），请升级服务端后再保存；当前只能查看和导出。');
      return;
    }
    let value = next;
    if (options.invalidate) {
      value = { ...next, candidate: null, candidateVersion: null };
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

  const loadWorkspaceSnapshot = (next: SchoolData) => {
    setData(next);
    setResult(next.candidate ?? next.published ?? null);
    setSelectedClassId(next.classes[0]?.id ?? '');
    setSelectedEntryId('');
    setHistory([]);
    pending.current = next;
    if (apiOnline) {
      setSaveState('saving');
      void flush(next);
    } else {
      setSaveState('offline');
    }
  };

  const makeCandidateVersion = (fixed: SolverOutput, source: 'solver' | 'manual') => ({
    id: uid('version'),
    kind: 'candidate' as const,
    createdAt: new Date().toISOString(),
    source,
    parentId: data?.candidateVersion?.id ?? data?.publishedVersion?.id,
    summary: `${fixed.entries.length} 条课时 · ${fixed.outcome ?? fixed.status}`,
    adjustmentCount: (data?.adjustments ?? []).filter((item) => item.status === 'active').length,
  });

  const applyResult = (next: SolverOutput, audit?: { action: string; detail: string }) => {
    const fixed = data ? withFixedClassRoomsResult(data, next) : next;
    setResult(fixed);
    if (!data) return;
    const candidateVersion = makeCandidateVersion(fixed, audit ? 'manual' : 'solver');
    const updated = {
      ...data,
      candidate: fixed,
      candidateVersion,
      auditLog: audit
        ? [...(data.auditLog ?? []), { id: uid('audit'), at: new Date().toISOString(), action: audit.action, detail: audit.detail }]
        : data.auditLog,
    };
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
      if (item.status !== 'active' || isNoopMove(item)) continue;
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

  const conflictToastSignature = useRef('');
  useEffect(() => {
    if (tab !== '课表预览') {
      conflictToastSignature.current = '';
      return;
    }
    if (!report || report.summary.hard === 0) return;
    const signature = conflictSignature(report);
    if (conflictToastSignature.current === signature) return;
    conflictToastSignature.current = signature;
    setError('当前课表有 ' + report.summary.hard + ' 项硬冲突：\n' + hardConflictText(report));
  }, [tab, report, setError]);

  const locateInspection = (refs: InspectionRefs) => {
    const teacherId = refs.teacherIds?.[0];
    const roomId = refs.roomIds?.[0];
    const classId = refs.classIds?.[0];
    // The located lesson must be visible; a remembered week filter would hide it.
    setWeekNo(null);
    setWeekFilter('all');
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
          { 项目: '生成时间', 值: fmtDateTime(report.generatedAt) },
          { 项目: '结论', 值: report.ok ? '可以保存正式版' : '不可保存正式版' },
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
          { 项目: '生成时间', 值: fmtDateTime(stats.generatedAt) },
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
      status: job.unplaced === 0 && dropped === 0 ? 'COMPLETED' : 'FAILED',
      outcome: job.unplaced === 0 && dropped === 0 ? 'feasible' : 'partial',
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
    if (serverBlocked) {
      setError('服务端版本过旧，请升级服务端后再排课。');
      return;
    }
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
      const output = withFixedClassRoomsResult(
        data,
        restoreUnassignedTeachers(await solveSchedule(toSolverInput(data, timeLimit, locked, randomSeed))),
      );
      setProgress({ phase: 'finalizing', message: '正在保存候选课表并整理结果', startedAt: Date.now() });
      setResult(output);
      setShortRuns((current) => [{
        id: 'short-' + Date.now(),
        createdAt: new Date().toISOString(),
        status: output.status,
        entries: output.entries.length,
        elapsedMs: output.elapsedMs,
        feasible: output.hasFeasibleSolution,
        mode: 'solve' as const,
        timeLimitSeconds: timeLimit,
        lockedCount: locked.length,
        totalPeriods: data.coursePlans.reduce((sum, plan) => sum + Number(plan.weeklyPeriods || 0), 0),
        runMode,
        randomSeed,
        result: output,
      }, ...current].slice(0, 12));
      const updated = { ...data, candidate: output, candidateVersion: makeCandidateVersion(output, 'solver') };
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
        const shortage = planShortageText(data, output);
        const failure = [output.explanation || '未找到可行课表', shortage].filter(Boolean).join('\n');
        setProgress({ phase: 'failed', message: failure, startedAt: Date.now() });
        setError(failure);
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
      const output = restoreUnassignedTeachers(await solveSchedule(toSolverInput(temp, 30, locked, randomSeed)));
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
      const output = restoreUnassignedTeachers(await solveSchedule(toSolverInput(data, timeLimit, locked, randomSeed)));
      const repaired = withFixedClassRoomsResult(data, {
        ...output,
        entries: output.entries.map((entry) => ({
          ...entry,
          locked: originalLocked.has(entry.id),
          source: originalSources.get(entry.id) ?? entry.source,
        })),
      });
      setResult(repaired);
      setShortRuns((current) => [{
        id: 'short-' + Date.now(),
        createdAt: new Date().toISOString(),
        status: repaired.status,
        entries: repaired.entries.length,
        elapsedMs: repaired.elapsedMs,
        feasible: repaired.hasFeasibleSolution,
        mode: 'repair' as const,
        timeLimitSeconds: timeLimit,
        lockedCount: originalLocked.size,
        totalPeriods: data.coursePlans.reduce((sum, plan) => sum + Number(plan.weeklyPeriods || 0), 0),
        runMode,
        randomSeed,
        result: repaired,
      }, ...current].slice(0, 12));
      const updated = { ...data, candidate: repaired, candidateVersion: makeCandidateVersion(repaired, 'solver') };
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
    const movingFixed = fixedSlotIdsOf(movingPlan ?? {});
    if (movingFixed.includes(moving.slotId)) {
      setError('这一节固定在指定时间，不能移动');
      return;
    }
    if (movingFixed.includes(targetSlotId)) {
      setError('目标时段被同一门课的固定节次占用，不能移入');
      return;
    }
    if (movingPlan?.pairId) {
      setError('配对课程（单双周同格）不能单独移动');
      return;
    }
    if (target) {
      const targetPlan = planOf(data, target);
      if (fixedSlotIdsOf(targetPlan ?? {}).includes(target.slotId)) {
        setError('目标课程固定在指定时间，不能交换');
        return;
      }
      if (targetPlan?.pairId) {
        setError('目标课程是配对课程（单双周同格），不能单独交换');
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
    const afterReport = inspectTimetable({ ...data, entries });
    const movedIds = new Set([source.id, target?.id].filter((id): id is string => Boolean(id)));
    const relevantIssues = afterReport.issues.filter(
      (issue) => issue.severity === 'hard' && issue.refs.entryIds?.some((id) => movedIds.has(id)),
    );
    if (conflicts.has(source.id) || (target && conflicts.has(target.id))) {
      const reasons = relevantIssues.length
        ? relevantIssues.slice(0, 4).map((issue) => '· ' + issue.title + '：' + issue.detail).join('\n')
        : hardConflictText(afterReport);
      setError('调整未应用：仍然会产生冲突\n' + reasons);
      return;
    }
    const beforeHard = report?.summary.hard ?? 0;
    const afterHard = afterReport.summary.hard;
    conflictToastSignature.current = conflictSignature(afterReport);
    setHistory((current) => [...current.slice(-19), result]);
    applyResult(
      { ...result, entries },
      {
        action: 'TIMETABLE_MOVE',
        detail: `手动${target ? '交换' : '移动'} · ${planSubjectName(data, movingPlan)} · ${moving.slotId} → ${targetSlotId}`,
      },
    );
    if (afterHard === 0 && beforeHard > 0) {
      setNotice('硬冲突已解决：' + beforeHard + ' → 0');
    } else if (afterHard > 0 && afterHard < beforeHard) {
      setWarning('硬冲突减少：' + beforeHard + ' → ' + afterHard + '\n仍有：\n' + hardConflictText(afterReport));
    } else if (afterHard > 0) {
      setWarning('位置已更新，但仍有 ' + afterHard + ' 项硬冲突：\n' + hardConflictText(afterReport));
    }
  };

  const toggleLock = (entryId: string) => {
    if (!result || !data) return;
    setHistory((current) => [...current.slice(-19), result]);
    const entries = result.entries.map((entry) =>
      entry.id === entryId ? { ...entry, locked: !entry.locked } : entry,
    );
    const changed = result.entries.find((entry) => entry.id === entryId);
    applyResult(
      { ...result, entries },
      changed ? { action: 'TIMETABLE_LOCK', detail: `${changed.locked ? '解锁' : '锁定'} · ${planSubjectName(data, planOf(data, changed))}` } : undefined,
    );
  };

  const undo = () => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setHistory((current) => current.slice(0, -1));
    applyResult(previous, { action: 'TIMETABLE_UNDO', detail: '撤销上一项课表手动调整' });
  };

  const saveOfficialFile = (settings: TimetableExportSettings, outcome: ExportResult, exportedName?: string) => {
    if (!data || !result) return;
    const createdAt = new Date().toISOString();
    const fileName = exportedName ?? timetableFileName(data, settings);
    const publishedVersion = {
      id: uid('version'),
      kind: 'published' as const,
      createdAt,
      source: 'publish' as const,
      parentId: data.candidateVersion?.id ?? data.publishedVersion?.id,
      summary: `${result.entries.length} 条课时 · ${fileName}`,
      adjustmentCount: (data.adjustments ?? []).filter((item) => item.status === 'active').length,
    };
    const audit = {
      id: uid('audit'),
      at: createdAt,
      action: 'SAVE_OFFICIAL',
      detail: `保存正式版课表 · ${fileName}${outcome.path ? ' · ' + outcome.path : ''}`,
    };
    const workspaceData = {
      ...data,
      published: result,
      publishedVersion,
      auditLog: [...(data.auditLog ?? []), audit],
    };
    void download(
      new Blob([serializeWorkspace(workspaceData, fileName.replace(/\.xlsx?$/i, '') + ' 工作区')], { type: 'application/json;charset=utf-8' }),
      'application/json',
      workspaceFileName(fileName.replace(/\.xlsx?$/i, '') + ' 工作区'),
    ).catch((cause) => setError('同步保存工作区数据失败：' + messageOf(cause)));
    commit(
      {
        ...data,
        published: result,
        publishedVersion,
        auditLog: [...(data.auditLog ?? []), audit],
      },
      { immediate: true },
    );
    setNotice('已保存正式版：' + fileName + (outcome.path ? '（' + outcome.path + '）' : ''));
  };

  const saveOfficial = () => {
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
    // 正式版导出复用批量课表流程，确保班级/教师课表使用同一套模板和命名规则。
    setExportBatch(true);
    setExportOpen('publish');
  };

  const clearCandidate = () => {
    if (!data) return;
    if (!window.confirm('清空候选课表？已保存的正式版不受影响。')) return;
    setResult(null);
    setSelectedEntryId('');
    setHistory([]);
    commit({ ...data, candidate: null, candidateVersion: null }, { immediate: true });
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

  const quickExportTimetable = (view: 'class' | 'teacher', entityId: string, weekNo: number | null) => {
    if (!data || !(result ?? data.published)) {
      setError('还没有可导出的课表，请先排课或保存正式版。');
      return;
    }
    const settings: TimetableExportSettings = {
      layout: 'vertical',
      view,
      entityId,
      schoolName: data.school.name,
      title: VIEW_LABELS[view],
      weeks: weekNo ? 'all' : weekFilter,
      weekNo: weekNo ?? null,
      scope: 'single',
      showTeacher: true,
      showRoom: !isSimplifiedRooms(data),
      showWeeks: true,
    };
    void exportTimetable(settings, () => undefined);
  };

  const openTimetableExport = () => {
    if (!data) return;
    if (!(result ?? data.published)) return;
    setExportWeek(null);
    setExportBatch(false);
    setExportOpen('export');
  };

  const openBatchExport = () => {
    if (!data) return;
    if (!(result ?? data.published)) return;
    setExportWeek(null);
    setExportBatch(true);
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
    setExportBatch(false);
    setExportOpen('export');
  };

  const viewAdjustedDate = (date: string) => {
    setOverlayDate(date);
    const week = data ? weekOfDate(data.semester, date) : null;
    if (week !== null) {
      setWeekNo(week);
      setWeekFilter(week % 2 === 1 ? 'odd' : 'even');
    } else {
      // A date outside the term has no school week; do not keep a stale filter.
      setWeekNo(null);
      setWeekFilter('all');
    }
    setSelectedEntryId('');
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
      if (exportOpen === 'publish') saveOfficialFile(settings, outcome);
      return true;
    } catch (cause) {
      setError('导出课表失败：' + messageOf(cause));
      return false;
    }
  };

  const exportBatchTimetables = async (
    settings: TimetableExportSettings,
    selection: BatchTimetableSelection,
    onStage: (stage: 'generating' | 'writing') => void,
    onProgress: (done: number, total: number) => void,
  ): Promise<boolean> => {
    if (!data) return false;
    const target = result ?? data.published;
    if (!target) return false;
    if (!selection.classes && !selection.teachers) {
      setError('请至少选择班级课表或教师课表。');
      return false;
    }
    const batchSettings: TimetableExportSettings = { ...settings, scope: 'single' };
    const items: BatchTimetableItem[] = [];
    if (selection.classes) {
      for (const klass of data.classes) {
        items.push({
          sheetName: '班-' + klass.name,
          tabColor: 'FF1F4E78',
          settings: { ...batchSettings, view: 'class', entityId: klass.id, title: '班级课表' },
        });
      }
    }
    if (selection.teachers) {
      for (const teacher of data.teachers) {
        items.push({
          sheetName: '师-' + teacher.name,
          tabColor: 'FF2E7D32',
          settings: { ...batchSettings, view: 'teacher', entityId: teacher.id, title: '教师课表' },
        });
      }
    }
    const output = selection.output ?? 'workbook';
    try {
      const weekStart = batchSettings.weekNo
        ? semesterWeeks(data.semester).find((week) => week.index === batchSettings.weekNo)?.startDate
        : null;
      const batchTarget = weekStart
        ? { ...target, entries: adjustedWeekEntries(data, target, data.adjustments ?? [], weekStart) }
        : target;
      onStage('generating');
      const template = await loadTimetableTemplate(batchSettings.layout);
      if (output === 'files') {
        const generated = await fillBatchTimetableFiles(template, data, batchTarget, items, onProgress);
        const used = new Set<string>();
        const files = generated.map((file, index) => ({
          filename: uniqueFileName(batchTimetableEntryFileName(data, items[index].settings), used),
          data: file.buffer,
        }));
        onStage('writing');
        const outcome = await downloadFiles(
          files,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          batchTimetableFolderName(data, batchSettings, selection),
        );
        const message = exportMessage(outcome, '课表文件（' + files.length + ' 个）');
        if (!message) return false;
        if (message.tone === 'error') {
          setError(message.text);
          return false;
        }
        setNotice(message.text);
        if (exportOpen === 'publish') {
          saveOfficialFile(
            batchSettings,
            outcome,
            output === 'files'
              ? batchTimetableFolderName(data, batchSettings, selection)
              : batchTimetableFileName(data, batchSettings, selection),
          );
        }
        return true;
      }
      const filled = await fillBatchTimetableTemplate(template, data, batchTarget, items, onProgress);
      onStage('writing');
      const outcome = await download(
        filled.buffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        batchTimetableFileName(data, batchSettings, selection),
      );
      const message = exportMessage(outcome, '批量课表');
      if (!message) return false;
      if (message.tone === 'error') {
        setError(message.text);
        return false;
      }
      setNotice(message.text + '（共 ' + items.length + ' 张工作表）');
      if (exportOpen === 'publish') {
        saveOfficialFile(batchSettings, outcome, batchTimetableFileName(data, batchSettings, selection));
      }
      return true;
    } catch (cause) {
      setError('批量导出课表失败：' + messageOf(cause));
      return false;
    }
  };

  const modeDialog = modeSettingsOpen ? <RuntimeModeDialog current={runMode} onSave={saveRunMode} onClose={() => setModeSettingsOpen(false)} /> : null;

  if (!runMode) {
    return <RuntimeModeDialog current={null} onSave={saveRunMode} />;
  }

  if (authChecking) {
    return (
      <div className="boot-screen">
        <div className="boot-mark">W</div>
        <strong>WARPWEFT</strong>
        <span>{t('dialog.login.busy')}</span>
      </div>
    );
  }

  if (authRequired && !authUser) {
    return (
      <>
        <LoginScreen
          needsSetup={authNeedsSetup}
          busy={authBusy}
          error={authError}
          onLogin={handleLogin}
          onSettings={() => setModeSettingsOpen(true)}
        />
        {modeDialog}
      </>
    );
  }

  if (!data) {
    if (apiOnline === false) {
      return (
        <>
          <EmptyDataScreen message={loadError} onRetry={() => window.location.reload()} onSettings={() => setModeSettingsOpen(true)} />
          {modeDialog}
        </>
      );
    }
    return (
      <div className="boot-screen">
        <div className="boot-mark">W</div>
        <strong>WARPWEFT</strong>
        <span>{t('dialog.boot.loading')}</span>
      </div>
    );
  }

  const issues = preflight(data);
  const visibleTabs = runMode === 'lan-server' ? TABS : TABS.filter((item) => item !== '服务端');
  const saveLabel =
    saveState === 'saving'
      ? t('common.saving')
      : saveState === 'saved'
        ? t('common.saved')
        : saveState === 'error'
          ? t('common.saveFailed')
          : saveState === 'offline'
            ? t('common.demoOnly')
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
          <span className="brand-mark">
            <img src={brandIcon} alt="" />
          </span>
          <div>
            <span className="brand-name">WARPWEFT</span>
          </div>
        </div>
        <nav className="nav-list" aria-label={t('nav.aria')}>
          {visibleTabs.map((item, index) => (
            <button
              key={item}
              className={tab === item ? 'nav-item active' : 'nav-item'}
              onClick={() => setTab(item)}
              aria-current={tab === item ? 'page' : undefined}
            >
              <span className="nav-no">0{index + 1}</span>
              <span>{t(TAB_LABEL_KEY[item])}</span>
            </button>
          ))}
        </nav>
        <div className="rail-footer">
          <span>{t('shell.dataSource')}</span>
          <strong>{data.school.name}</strong>
          <small>{apiOnline === false ? t('shell.localOnly') : t('shell.localFile')}</small>
          <small>{data.updatedAt ? t('shell.updatedAt', { time: fmtTime(data.updatedAt) }) : t('shell.notSaved')}</small>
        </div>
      </aside>
      <main className={'workspace' + (tab === '课表预览' ? ' workspace-timetable' : '')}>
        <header className="topbar">
          <div>
            <h1>{t(TAB_LABEL_KEY[tab])}</h1>
          </div>
          <div className="top-actions">
            <span className={apiOnline === false ? 'node-status offline' : 'node-status'}>
              <i />
              {apiOnline === null ? t('common.connecting') : apiOnline ? t('common.online') : t('common.offline')}
            </span>
            {running ? <span className="run-phase-pill">{progress.message}</span> : null}
            {saveLabel ? <span className={'save-state ' + saveState}>{saveLabel}</span> : null}
            <button className="mode-pill" onClick={() => setModeSettingsOpen(true)} title={t('shell.changeRunMode')}>
              {t('shell.runMode', { mode: runMode ? t(RUN_MODE_LABEL_KEYS[runMode].title) : '' })}
            </button>
            {authUser ? (
              <button className="ghost-button auth-user" onClick={() => void handleLogout()} title={t('settings.server.signOut')}>
                {t('common.logout', { name: authUser.username })}
              </button>
            ) : null}
            <button
              className="theme-toggle"
              onClick={toggleLang}
              aria-label={t('common.switchLanguage')}
              title={t('common.switchLanguage')}
            >
              <span>{lang === 'zh-CN' ? 'EN' : '中'}</span>
              {lang === 'zh-CN' ? 'EN' : '中文'}
            </button>
            <button
              className="theme-toggle"
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              aria-label={theme === 'light' ? t('common.switchToDark') : t('common.switchToLight')}
            >
              <span>{theme === 'light' ? '☾' : '☀'}</span>
              {theme === 'light' ? t('common.dark') : t('common.light')}
            </button>
          </div>
        </header>
        {apiOnline === false ? (
          <Banner tone="warning" title="服务端未连接">
            当前服务未连接，修改不会保存。请通过桌面端启动，或先运行 <code>npm run dev:api</code> 再打开界面。
            <button type="button" className="ghost-button" onClick={() => setConnectionRetry((value) => value + 1)}>重新连接</button>
          </Banner>
        ) : null}
        {serverBlocked ? (
          <Banner tone="warning" title="服务端版本过旧">
            当前服务端数据版本 v{serverSchema ?? '未知'}，本客户端至少需要 v{MIN_SERVER_SCHEMA}。请升级局域网服务端；升级前可以查看和导出，但不能保存或排课。
          </Banner>
        ) : null}
        {toast ? (
          <ToastView key={toast.id} toast={toast} onClose={() => dismissToast(toast.id, 'closed')} />
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
            onLoadWorkspace={loadWorkspaceSnapshot}
          />
        ) : null}
        <div hidden={tab !== '排课任务'}>
          <RunsPage
            data={data}
            result={result}
            issues={issues}
            running={running}
            progress={progress}
            runMode={runMode}
            shortRuns={shortRuns}
            onDeleteShortRun={deleteShortRun}
            timeLimit={timeLimit}
            setTimeLimit={setTimeLimit}
            randomSeed={randomSeed}
            setRandomSeed={setRandomSeed}
            onRun={run}
            onRepair={repairSchedule}
            onTimetable={() => setTab('课表预览')}
            onClear={clearCandidate}
            inputFactory={(seconds) => toSolverInput(data, seconds, data.candidate?.entries.filter((entry) => entry.locked) ?? [], randomSeed)}
            onApplyLongResult={applyLongResult}
            onNotice={setNotice}
            onError={setError}
          />
        </div>
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
            weekFilter={weekFilter}
            setWeekFilter={setWeekFilter}
            weekNo={weekNo}
            setWeekNo={setWeekNo}
            overlayDate={overlayDate}
            setOverlayDate={setOverlayDate}
            onSwap={swapEntry}
            onToggleLock={toggleLock}
            onUndo={undo}
            canUndo={history.length > 0}
            onRun={run}
            running={running}
            onInspect={() => setTab('最终课表')}
            onExportCsv={exportCsvFile}
            onExportExcel={openTimetableExport}
            onBatchExport={openBatchExport}
            onQuickExport={quickExportTimetable}
            onPrint={() => window.print()}
          />
        ) : null}
        {tab === '调代课' ? (
          <AdjustmentsPage
            data={data}
            commit={commit}
            setError={setError}
            setNotice={setNotice}
            onQuickExport={quickExportTimetable}
          />
        ) : null}
        {tab === '最终课表' ? (
          <InspectionPage
            data={data}
            candidate={result}
            publishedResult={data.published}
            report={report}
            hasCandidate={Boolean(result)}
            published={Boolean(data.published)}
            onLocate={locateInspection}
            onExportExcel={exportInspectionExcel}
            onExportCsv={exportInspectionCsv}
            onPrint={() => window.print()}
            onTimetable={() => setTab('课表预览')}
            onRules={() => { setPrepareSection('rules'); setTab('排课准备'); }}
            onAdjust={() => setTab('调代课')}
            onRun={() => setTab('排课任务')}
            onClear={clearCandidate}
            onSaveOfficial={saveOfficial}
            adjustmentDays={adjustmentDays}
            onViewAdjustment={viewAdjustedDate}
            onExportAdjustment={(date) => openAdjustedExport(date)}
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
        {tab === '服务端' && runMode === 'lan-server' ? (
            <ServerPage
              apiOnline={apiOnline}
              authUser={authUser}
              showUserManagement={authRequired && !electronShell}
            />
          ) : null}
        {tab === '设置' ? (
          <SettingsPage
            runMode={runMode}
            theme={theme}
            onThemeChange={setTheme}
            onEditMode={() => setModeSettingsOpen(true)}
            apiOnline={apiOnline}
            data={data}
            commit={commit}
            toastLogs={toastLogs}
            onClearToastLogs={clearToastLogs}
          />
        ) : null}
      </main>
      {running ? (
        <div className="run-foreground" role="status" aria-live="polite" aria-label="短时排课计算中">
          <div className="run-foreground-panel">
            <RunProgressView progress={progress} />
            <p className="panel-note">短时排课正在计算，请勿关闭页面或重复提交；计算完成后会自动显示候选课表。</p>
          </div>
        </div>
      ) : null}
      {exportOpen && data && (result ?? data.published) ? (
        <TimetableExportDialog
          data={data}
          result={result ?? data.published!}
          initialView={view}
          initialEntityId={entityId || selectedClassId || data.classes[0]?.id || ''}
          initialWeekNo={exportWeek}
          initialBatch={exportBatch}
          mode={exportOpen}
          onClose={() => { setExportOpen(null); setExportBatch(false); }}
          onConfirm={exportTimetable}
          onBatchConfirm={exportBatchTimetables}
        />
      ) : null}
      {modeDialog}
    </div>
  );
}

function WorkspaceLocationCard() {
  const bridge = useMemo(() => (window as unknown as {
    warpweft?: {
      getWorkspace?: () => Promise<{ path?: string; customizable?: boolean }>;
      chooseWorkspace?: () => Promise<{ status?: string; path?: string; error?: string; canceled?: boolean; restartRequired?: boolean }>;
    };
  }).warpweft, []);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!bridge?.getWorkspace) {
      setMessage('浏览器模式：工作区由服务端数据目录管理，桌面版可在此选择存放位置。');
      return;
    }
    void bridge.getWorkspace().then((info) => {
      if (info?.path) setPath(info.path);
    }).catch((cause) => setMessage(cause instanceof Error ? cause.message : String(cause)));
  }, [bridge]);

  const choose = async () => {
    if (!bridge?.chooseWorkspace || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await bridge.chooseWorkspace();
      if (result.canceled) return;
      if (result.status === 'failed') {
        setMessage(result.error || '切换工作区失败');
        return;
      }
      if (result.path) setPath(result.path);
      setMessage(result.restartRequired ? '工作区位置已保存，重启应用后生效。' : '工作区位置已更新。');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section-panel workspace-location-card">
      <div className="panel-head">
        <SectionHeading english="WORKSPACE STORAGE" title="工作区位置" />
        <button type="button" className="ghost-button" onClick={() => void choose()} disabled={busy || !bridge?.chooseWorkspace}>
          {busy ? '正在选择…' : '选择文件夹'}
        </button>
      </div>
      <p className="panel-note">数据库、长时任务检查点和缓存文件会保存在这个文件夹；切换后重启应用生效。</p>
      <div className="workspace-location-path">
        <span>当前路径</span>
        <code>{path || '读取中…'}</code>
      </div>
      {message ? <p className="panel-note">{message}</p> : null}
    </section>
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
    { code: '班级', label: '班级', value: data.classes.length, note: '行政班' },
    { code: '教师', label: '教师', value: data.teachers.length, note: '任课关系' },
    { code: '教室', label: '教室', value: data.rooms.length, note: '可用教室' },
    { code: '课时', label: '待排课时', value: periods, note: '每周总量' },
  ];
  const ready = issues.length === 0;
  const stateLabel = result
    ? ['COMPLETED', 'FEASIBLE', 'IMPROVED', 'OPTIMAL'].includes(result.status)
      ? '就绪'
      : result.outcome === 'partial'
        ? '未排满'
      : result.outcome === 'timeout'
        ? '超时'
        : '失败'
    : '待排课';
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
          <span>任务状态</span>
          <strong>{stateLabel}</strong>
          <div className="readout-track">
            <i style={{ width: result ? '100%' : ready ? '62%' : '28%' }} />
          </div>
          <small>{result?.outcome === 'partial' ? '已生成部分候选，仍需处理未排课时' : result?.outcome === 'timeout' ? '当前时限内未找到完整课表' : result ? '候选方案已生成' : ready ? '数据已就绪，可以排课' : '还有 ' + issues.length + ' 项需要处理'}</small>
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
      <WorkspaceLocationCard />
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
            <span>数据快照</span>
            <b>{data.updatedAt ? fmtTime(data.updatedAt) : '本机'}</b>
            <span>教学计划</span>
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
  const [copiedCurrent, setCopiedCurrent] = useState(false);

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

  const copyCurrentAddress = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopiedCurrent(true);
      window.setTimeout(() => setCopiedCurrent(false), 2000);
    } catch {
      window.prompt('请手动复制当前访问地址：', window.location.origin);
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
      <div className="server-warning">Linux 服务端启用账号登录后，未登录用户不能读写工作区；Electron 本机桌面模式不启用登录。多人同时编辑会整库覆盖，建议同一时间只保留一位编辑者。</div>
      <p className="server-config-hint">
        当前访问地址：<code>{window.location.origin}</code>
        <button type="button" className="server-inline-btn" onClick={() => void copyCurrentAddress()}>
          {copiedCurrent ? '已复制' : '复制'}
        </button>
      </p>
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

function UsersCard({ currentUser }: { currentUser: AuthUser }) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ username: '', displayName: '', password: '', role: 'user' as 'admin' | 'user' });
  const [passwords, setPasswords] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const result = await fetchUsers();
      setUsers(result.users);
      setError('');
    } catch (cause) {
      setError('读取用户失败：' + messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addUser = async () => {
    if (busy) return;
    setBusy('add');
    setError('');
    setNotice('');
    try {
      await createUser({
        username: form.username.trim(),
        displayName: form.displayName.trim() || undefined,
        password: form.password,
        role: form.role,
      });
      setForm({ username: '', displayName: '', password: '', role: 'user' });
      setNotice('用户已创建');
      await refresh();
    } catch (cause) {
      setError('创建用户失败：' + messageOf(cause));
    } finally {
      setBusy('');
    }
  };

  const patchUser = async (user: AuthUser, patch: { displayName?: string; password?: string; role?: 'admin' | 'user'; disabled?: boolean }, label: string) => {
    if (busy) return false;
    setBusy(user.id + ':' + label);
    setError('');
    setNotice('');
    try {
      await updateUser(user.id, patch);
      setNotice('用户已更新：' + user.username);
      await refresh();
      return true;
    } catch (cause) {
      setError('更新用户失败：' + messageOf(cause));
      return false;
    } finally {
      setBusy('');
    }
  };

  const removeUser = async (user: AuthUser) => {
    if (busy) return;
    if (!window.confirm('删除用户「' + user.username + '」？该用户将立即失去登录权限。')) return;
    setBusy(user.id + ':delete');
    setError('');
    setNotice('');
    try {
      await deleteUser(user.id);
      setNotice('用户已删除：' + user.username);
      await refresh();
    } catch (cause) {
      setError('删除用户失败：' + messageOf(cause));
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="section-panel">
      <div className="panel-head">
        <SectionHeading english="LINUX USERS" title="用户与密码" />
        <span className="status-tag muted">{users.length} 个账号</span>
      </div>
      <div className="server-warning">用户管理只在 Linux 服务端的管理页面出现；Electron 客户端不提供添加用户或修改密码的入口。</div>
      {notice ? <p className="server-config-hint success-note">{notice}</p> : null}
      {error ? <p className="server-save-error">{error}</p> : null}
      {loading ? <p className="server-config-hint">正在读取用户…</p> : (
        <div className="table-scroll">
          <table className="data-table server-user-table">
            <thead>
              <tr><th>用户</th><th>角色</th><th>状态</th><th>重置密码</th><th>操作</th></tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td><b>{user.username}</b><small>{user.displayName}{user.id === currentUser.id ? ' · 当前账号' : ''}</small></td>
                  <td>
                    <select
                      value={user.role === 'admin' ? 'admin' : 'user'}
                      disabled={Boolean(busy) || user.id === currentUser.id}
                      onChange={(event) => void patchUser(user, { role: event.target.value === 'admin' ? 'admin' : 'user' }, 'role')}
                    >
                      <option value="user">普通用户</option>
                      <option value="admin">管理员</option>
                    </select>
                  </td>
                  <td>
                    <label className="server-user-check">
                      <input
                        type="checkbox"
                        checked={!user.disabled}
                        disabled={Boolean(busy) || user.id === currentUser.id}
                        onChange={(event) => void patchUser(user, { disabled: !event.target.checked }, 'disabled')}
                      />
                      启用
                    </label>
                  </td>
                  <td>
                    <div className="server-user-password">
                      <input
                        type="password"
                        value={passwords[user.id] ?? ''}
                        onChange={(event) => setPasswords((current) => ({ ...current, [user.id]: event.target.value }))}
                        placeholder="至少 8 位"
                        autoComplete="new-password"
                        disabled={Boolean(busy)}
                      />
                      <button
                        type="button"
                        className="tt-btn tt-btn-quiet"
                        disabled={Boolean(busy) || (passwords[user.id] ?? '').length < 8}
                        onClick={() => void patchUser(user, { password: passwords[user.id] }, 'password').then((ok) => {
                          if (ok) setPasswords((current) => ({ ...current, [user.id]: '' }));
                        })}
                      >
                        重置
                      </button>
                    </div>
                  </td>
                  <td>
                    <button type="button" className="danger-link" disabled={Boolean(busy) || user.id === currentUser.id} onClick={() => void removeUser(user)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="server-user-add">
        <div className="panel-head"><SectionHeading english="ADD USER" title="添加用户" /><span className="status-tag muted">仅 Linux</span></div>
        <div className="server-config-grid">
          <label className="server-field"><span>用户名</span><input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} placeholder="字母、数字、_ . -，3–32 位" autoComplete="off" /></label>
          <label className="server-field"><span>显示名称</span><input value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="可选" autoComplete="off" /></label>
          <label className="server-field"><span>初始密码</span><input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder="至少 8 位" autoComplete="new-password" /></label>
          <label className="server-field"><span>角色</span><select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value === 'admin' ? 'admin' : 'user' }))}><option value="user">普通用户</option><option value="admin">管理员</option></select></label>
        </div>
        <button type="button" className="mini-button" disabled={Boolean(busy) || !form.username.trim() || form.password.length < 8} onClick={() => void addUser()}>{busy === 'add' ? '创建中…' : '添加用户'}</button>
      </div>
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

function ServerPage({
  apiOnline,
  authUser,
  showUserManagement,
}: {
  apiOnline: boolean | null;
  authUser: AuthUser | null;
  showUserManagement: boolean;
}) {
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
      {apiOnline === false ? <Banner tone="warning" title="服务端未连接">当前无法读取服务端状态，请先启动服务端 API。</Banner> : null}
      {!stats ? (
        <div className="server-loading"><strong>正在读取本机服务端状态…</strong></div>
      ) : (
        <>
          <section className="section-panel server-panel">
            <div className="server-head">
              <div><h2>服务端</h2><p>监控服务端资源、Java 求解器和排队中的排课任务；单机与 Linux 服务端使用同一套 Java 求解线路。</p></div>
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
          {showUserManagement && authUser?.role === 'admin' ? <UsersCard currentUser={authUser} /> : null}
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

function SettingsPage({
  runMode,
  theme,
  onThemeChange,
  onEditMode,
  apiOnline,
  data,
  commit,
  toastLogs,
  onClearToastLogs,
}: {
  runMode: RunMode | null;
  theme: 'light' | 'dark';
  onThemeChange: (theme: 'light' | 'dark') => void;
  onEditMode: () => void;
  apiOnline: boolean | null;
  data: SchoolData;
  commit: Commit;
  toastLogs: ToastLogEntry[];
  onClearToastLogs: () => void;
}) {
  const mode = RUN_MODE_OPTIONS.find((item) => item.value === runMode);
  const endpoint = readActiveEndpoint(window.localStorage) || getApiBase();
  const toneLabels: Record<ToastTone, string> = {
    error: '错误',
    success: '完成',
    warning: '提醒',
    info: '提示',
  };
  const reasonLabels = {
    timeout: '30 秒后自动消失',
    closed: '手动关闭',
    replaced: '被新提示替换',
  };
  return (
    <div className="settings-layout">
      <Card className="business-card settings-card"><CardBody>
        <SectionHeading english="RUNTIME" title="运行模式" />
        <p className="panel-note">决定数据和排课服务连接到哪里。修改后会重新连接工作区。</p>
        <div className="settings-value"><span>当前模式</span><strong>{mode?.title ?? '未选择'}</strong></div>
        <div className="settings-value"><span>服务地址</span><strong className="settings-endpoint">{endpoint}</strong></div>
        <Button color="primary" onPress={onEditMode}>修改运行模式</Button>
      </CardBody></Card>

      <Card className="business-card settings-card"><CardBody>
        <SectionHeading english="APPEARANCE" title="外观" />
        <p className="panel-note">调整工作台的显示主题。</p>
        <Tabs selectedKey={theme} onSelectionChange={(key) => onThemeChange(String(key) as 'light' | 'dark')} aria-label="主题">
          <Tab key="light" title="浅色" />
          <Tab key="dark" title="深色" />
        </Tabs>
        <div className="settings-value"><span>深色背景</span><strong>#1C1C1C</strong></div>
      </CardBody></Card>

      <Card className="business-card settings-card settings-card-wide"><CardBody>
        <SectionHeading english="WORKSPACE" title="当前工作区" />
        <label className="settings-value"><span>学校名称</span><input className="settings-input" value={data.school.name} onChange={(event) => commit({ ...data, school: { ...data.school, name: event.target.value } })} /></label>
        <label className="settings-value"><span>教室模式</span><select className="settings-input" value={data.roomMode ?? 'simplified'} onChange={(event) => commit({ ...data, roomMode: event.target.value as 'simplified' | 'full' }, { invalidate: true })}><option value="simplified">简化模式（每班一间固定教室，不需要教室表）</option><option value="full">完整模式（按教室容量/类型/冲突排课）</option></select></label>
        <div className="settings-stats">
          <span>班级 <b>{data.classes.length}</b></span>
          <span>教师 <b>{data.teachers.length}</b></span>
          <span>教学计划 <b>{data.coursePlans.length}</b></span>
          <span>服务状态 <Chip size="sm" color={apiOnline ? 'success' : 'warning'}>{apiOnline ? '在线' : apiOnline === false ? '离线' : '检测中'}</Chip></span>
        </div>
        <p className="panel-note">工作区数据由当前服务端管理。设置页不会自动填充演示数据。</p>
      </CardBody></Card>

      <Card className="business-card settings-card settings-card-wide settings-log-card"><CardBody>
        <div className="settings-card-head">
          <SectionHeading english="ACTIVITY LOG" title="日志" />
          <button type="button" className="tt-btn tt-btn-quiet" onClick={onClearToastLogs} disabled={toastLogs.length === 0}>清空日志</button>
        </div>
        <p className="panel-note">顶部 toast 会在 30 秒后自动消失；消失、手动关闭或被替换的记录保留在这里，最多 100 条。</p>
        {toastLogs.length === 0 ? (
          <div className="settings-log-empty">暂无日志。操作提示、排课结果和冲突原因会出现在这里。</div>
        ) : (
          <div className="settings-log-list">
            {toastLogs.map((entry) => (
              <article className={'settings-log-item is-' + entry.tone} key={entry.id}>
                <div className="settings-log-meta">
                  <span className={'settings-log-tone is-' + entry.tone}>{toneLabels[entry.tone]}</span>
                  <time>{fmtDateTime(entry.at, undefined, { hour12: false })}</time>
                  <em>{reasonLabels[entry.reason]}</em>
                </div>
                <strong>{entry.title}</strong>
                <p>{entry.message}</p>
              </article>
            ))}
          </div>
        )}
      </CardBody></Card>
    </div>
  );
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
  weekFilter,
  setWeekFilter,
  weekNo,
  setWeekNo,
  overlayDate,
  setOverlayDate,
  onSwap,
  onToggleLock,
  onUndo,
  canUndo,
  onRun,
  running,
  onInspect,
  onExportCsv,
  onExportExcel,
  onBatchExport,
  onQuickExport,
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
  weekFilter: PreviewWeekFilter;
  setWeekFilter: (value: PreviewWeekFilter) => void;
  weekNo: number | null;
  setWeekNo: (value: number | null) => void;
  overlayDate: string;
  setOverlayDate: (value: string) => void;
  onSwap: (entryId: string, slotId: string) => void;
  onToggleLock: (entryId: string) => void;
  onUndo: () => void;
  canUndo: boolean;
  onRun: () => void;
  running: boolean;
  onInspect: () => void;
  onExportCsv: () => void;
  onExportExcel: () => void;
  onBatchExport: () => void;
  onQuickExport: (view: 'class' | 'teacher', entityId: string, weekNo: number | null) => void;
  onPrint: () => void;
}) {
  const [dragId, setDragId] = useState('');
  const [dragOver, setDragOver] = useState('');
  const [dropTooltip, setDropTooltip] = useState<{ slotId: string; reason: string } | null>(null);
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
  const headerDates = weekDatesForHeader(data.semester, { weekNo, overlayDate, today: todayLocal() });
  const periods = Array.from(new Set(data.timeSlots.map((slot) => slot.period))).sort((a, b) => a - b);
  const kindOfSlot = (slotId: string) => data.timeSlots.find((slot) => slot.id === slotId)?.kind ?? 'regular';
  const kindOfPeriod = (period: number) => data.timeSlots.find((slot) => slot.period === period)?.kind ?? 'regular';
  const kindOfEntry = (entry: ScheduleEntry) => planOf(data, entry)?.kind ?? kindOfSlot(entry.slotId);
  const hasCustomSlotKinds = data.timeSlots.some((slot) => (slot.kind ?? 'regular') !== 'regular');
  const hasCustomKinds = hasCustomSlotKinds || data.coursePlans.some((plan) => (plan.kind ?? 'regular') !== 'regular');
  const entities = view === 'class' ? data.classes : view === 'teacher' ? data.teachers : data.rooms;
  // Date overlay: show what actually happens on one date (base + adjustments).
  const baseEntries: ScheduleEntry[] = result
    ? overlayDate
      ? (effectiveEntries({ ...data, entries: result.entries }, overlayDate, data.adjustments ?? []) as unknown as ScheduleEntry[])
      : result.entries
    : [];
  const overlayCount = overlayDate ? effectiveAdjustments(data.adjustments, overlayDate).length : 0;
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
      ? effectiveAdjustments(data.adjustments, overlayDate).filter((item) => {
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
  const selectedFixed = selected ? fixedSlotIdsOf(selectedPlan ?? {}).includes(selected.slotId) : false;
  const canMove = Boolean(selected) && view === 'class' && !selected?.locked && !selectedFixed && !selectedPlan?.pairId && !selected?.groupId && !overlayDate;
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
            title="打开最终课表报告（保存正式版门禁）"
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
        <label className="tt-week-overlay" title="选择日期后，查看该日期叠加调课/代课/停课后的实际课表；只读，不修改数据">
          <input
            type="checkbox"
            checked={Boolean(overlayDate)}
            onChange={(event) => {
              const next = event.target.checked ? overlayDate || todayLocal() : '';
              setOverlayDate(next);
              setSelectedEntryId('');
              setSwapMode(false);
            }}
          />
          查看某天实际课表
          <span className="tt-overlay-hint">叠加调课/代课/停课</span>
        </label>
        {overlayDate ? (
          <input
            className="tt-date"
            type="date"
            value={overlayDate}
            onChange={(event) => {
              setOverlayDate(event.target.value);
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
            导出设置…
          </button>
          <button type="button" className="tt-btn tt-btn-quiet" onClick={onBatchExport} title="批量导出全部班级和教师课表">
            批量导出…
          </button>
          {view !== 'room' ? (
            <button type="button" className="tt-btn tt-btn-quiet" onClick={() => onQuickExport(view, entityId, weekNo)} title="按当前视图、当前周直接导出，不需要再选设置">
              导出当前视图
            </button>
          ) : null}
          <button type="button" className="tt-btn tt-btn-quiet" onClick={onPrint}>
            打印
          </button>
        </div>
      </div>

      <div className={'tt-selection' + (selected ? ' has-selection' : '')} aria-live="polite">
        {selected ? (
          <>
            <div className="tt-selection-copy">
              <span className="tt-selection-kicker">已选课程</span>
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
              {!swapMode && selectedFixed && !selected.locked ? <span className="tt-move-hint is-muted">固定时间，不可移动</span> : null}
              {!swapMode && selectedPlan?.pairId && !selected.locked ? <span className="tt-move-hint is-muted">配对课程（单双周同格），不能单独移动</span> : null}
              {!swapMode && selected.groupId ? <span className="tt-move-hint is-muted">走班课程由走班组统一安排，不能单独移动</span> : null}
              {view === 'class' && !overlayDate && !selected.groupId && !selected.locked && !selectedFixed && !selectedPlan?.pairId ? <button className={'tt-btn' + (swapMode ? ' tt-btn-primary' : '')} onClick={() => setSwapMode((value) => !value)}>{swapMode ? '退出交换' : '交换课程'}</button> : null}
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
          <span>没有剩余时间格可用于移动。可在基础资料增加时间段或教师，或使用交换课程。</span>
        </div>
      ) : null}
      {missing.length ? (
        <div className="tt-warning">
          <b>还有 {totalMissing} 课时未排</b>
          <span>{missing.map((item) => (findClass(data, item.plan.classId)?.name ?? '') + ' ' + planSubjectName(data, item.plan)).join('；')}</span>
        </div>
      ) : null}

      {report && report.summary.hard > 0 && !overlayDate ? (
        <div className="tt-warning is-danger">
          <b>硬冲突 {report.summary.hard} 项</b>
          <span>{hardConflictText(report, 3)}</span>
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
                {days.map((day) => {
                  const date = headerDates[day];
                  return (
                    <th key={day} className="tt-day-head" title={date ? date + ' ' + (DAYS[day] ?? '') : undefined}>
                      <span>
                        {DAYS[day] ?? '第' + day + '天'}
                        {date ? <em className="tt-day-date">{date.slice(5)}</em> : null}
                      </span>
                      <small>DAY {String(day).padStart(2, '0')}</small>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {periods.map((period, periodIndex) => {
                const periodKind = kindOfPeriod(period);
                const previousKind = periodIndex > 0 ? kindOfPeriod(periods[periodIndex - 1]) : null;
                return (
                  <React.Fragment key={period}>
                    {hasCustomSlotKinds && periodKind !== previousKind ? (
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
                    const selectedDecision = selected && slot && canMove
                      ? (cellEntries.length === 0
                        ? checkMove(selected, slot, dropContext)
                        : cellEntries.length === 1
                          ? checkSwap(selected, cellEntries[0], dropContext)
                          : { ok: false, reason: '时间格内有多门课程，无法放置' })
                      : null;
                    const hoverDecision = dragDecision ?? selectedDecision;
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
                        title={hoverDecision ? (hoverDecision.ok ? '可用：放置到这里' : '不可用：' + hoverDecision.reason) : moveHere && selected ? '把「' + moveLabel + '」移动到这里' : undefined}
                        onMouseEnter={() => {
                          if (slot && hoverDecision && !hoverDecision.ok) setDropTooltip({ slotId: slot.id, reason: hoverDecision.reason });
                        }}
                        onMouseLeave={() => setDropTooltip(null)}
                        onDragOver={(event) => {
                          if (view !== 'class' || !slot) return;
                          event.preventDefault();
                          if (dragDecision) event.dataTransfer.dropEffect = dragDecision.ok ? 'move' : 'none';
                          setDragOver(slot.id);
                          if (dragDecision && !dragDecision.ok) setDropTooltip({ slotId: slot.id, reason: dragDecision.reason });
                        }}
                        onDragLeave={() => setDragOver('')}
                        onDrop={(event) => {
                          if (view !== 'class' || !slot) return;
                          event.preventDefault();
                          if (dragDecision && !dragDecision.ok) {
                            setDragOver('');
                            setDragId('');
                            setDropTooltip(null);
                            return;
                          }
                          const entryId = event.dataTransfer.getData('text/plain') || dragId;
                          setDragOver('');
                          setDragId('');
                          setDropTooltip(null);
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
                        {dropTooltip?.slotId === slot?.id && hoverDecision && !hoverDecision.ok ? (
                          <span className="tt-conflict-tooltip" role="tooltip">× {hoverDecision.reason}</span>
                        ) : null}
                        {cellEntries.length ? (
                          <>
                          {(view === 'class' ? cellEntries.filter((entry) => !entry.groupId) : cellEntries).map((entry) => {
                            const plan = planOf(data, entry);
                            const entryPlanKind = plan?.kind ?? kindOfSlot(entry.slotId);
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
                                onDragEnd={() => {
                                  setDragId('');
                                  setDragOver('');
                                  setDropTooltip(null);
                                }}
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
                                {entry.source === 'MANUAL' || isConflict || weeksOf(entry) !== 'all' || entry.groupId || entryPlanKind !== kindOfSlot(entry.slotId) ? (
                                  <span className="tt-card-badges">
                                    {entryPlanKind !== kindOfSlot(entry.slotId) ? <em>{KIND_LABELS[entryPlanKind] ?? entryPlanKind}</em> : null}
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
              {['morning', 'regular', 'study', 'aftercare', 'evening', 'makeup'].map((kind) => {
                const count = viewEntries.filter((entry) => kindOfEntry(entry) === kind).length;
                if (count === 0 && kind !== 'regular') return null;
                return (KIND_LABELS[kind] ?? kind) + ' ' + count + ' · ';
              })}
            </>
          ) : null}
          本视图剩余容量 {viewFreeSlots} 格 · 拖动课程可交换位置 · 锁定后重新排课保留原时间
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

createRoot(document.getElementById('root')!).render(
  <HeroUIProvider>
    <I18nProvider>
      <App />
    </I18nProvider>
  </HeroUIProvider>,
);








































