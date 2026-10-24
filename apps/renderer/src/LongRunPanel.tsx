import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelLongJob,
  deleteLongJob,
  fetchLongJob,
  fetchLongJobByUuid,
  fetchLongJobs,
  getApiBase,
  pauseLongJob,
  resumeLongJob,
  startLongJob,
} from './api';
import type { LongJob, LongJobDetail } from './api';
import type { SolverInput } from './types';
import { SectionHeading } from './components';
import { forgetTask, latestTaskForEndpoint, newTaskUuid, rememberTask, snapshotIdOf } from './taskIndex';

const STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '未完成',
  cancelled: '已取消',
  interrupted: '已中断（可继续）',
};

const DURATIONS = [
  { value: 1800, label: '30 分钟' },
  { value: 3600, label: '1 小时' },
  { value: 7200, label: '2 小时' },
  { value: 21600, label: '6 小时（上限）' },
];

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function formatElapsed(ms: number): string {
  const safe = Math.max(0, Number(ms) || 0);
  if (safe < 1000) return Math.round(safe) + ' 毫秒';
  const seconds = Math.round(safe / 1000);
  if (seconds < 60) return seconds + ' 秒';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + ' 分 ' + (seconds % 60) + ' 秒';
  return Math.floor(minutes / 60) + ' 小时 ' + (minutes % 60) + ' 分';
}

function canResumeStatus(status: string): boolean {
  return ['paused', 'interrupted', 'failed', 'cancelled', 'completed'].includes(status);
}

export function LongRunPanel({
  inputFactory,
  onApplyResult,
  onNotice,
  onError,
  disabled,
  seconds,
  onSecondsChange,
  showStartControls = true,
  onRegisterStart,
  onActiveChange,
  onJobsChange,
}: {
  inputFactory: (seconds: number) => SolverInput;
  onApplyResult: (job: LongJobDetail) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  disabled: boolean;
  seconds: number;
  onSecondsChange: (value: number) => void;
  showStartControls?: boolean;
  onRegisterStart?: (start: () => Promise<void>) => void;
  onActiveChange?: (active: boolean) => void;
  onJobsChange?: (jobs: LongJob[]) => void;
}) {
  const [job, setJob] = useState<LongJobDetail | null>(null);
  const [jobs, setJobs] = useState<LongJob[]>([]);
  const [busy, setBusy] = useState('');
  const startRef = useRef<() => Promise<void>>(async () => {});
  const [panelError, setPanelError] = useState('');

  const refreshList = useCallback(async (): Promise<LongJob[]> => {
    try {
      const result = await fetchLongJobs();
      setJobs(result.jobs);
      setPanelError('');
      return result.jobs;
    } catch (cause) {
      setPanelError(cause instanceof Error ? cause.message : String(cause));
      return [];
    }
  }, []);

  const loadJob = useCallback(async (id: string) => {
    try {
      const detail = await fetchLongJob(id);
      setJob(detail);
      // Adopt a task created elsewhere (or before the local index existed) so
      // the next reload can find it by UUID instead of "latest job on server".
      if (detail.taskUuid) {
        const endpoint = getApiBase();
        const stored = latestTaskForEndpoint(window.localStorage, endpoint);
        if (stored?.jobId !== detail.id) {
          rememberTask(window.localStorage, {
            taskUuid: detail.taskUuid,
            jobId: detail.id,
            snapshotId: detail.snapshotId ?? '',
            endpoint,
            submittedAt: detail.createdAt,
          });
        }
      }
      return detail;
    } catch (cause) {
      setPanelError(cause instanceof Error ? cause.message : String(cause));
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Prefer the task this browser remembered for the current server. This is
      // what makes "close the page, come back later" find the same task even if
      // other computers created newer jobs in the meantime.
      const stored = latestTaskForEndpoint(window.localStorage, getApiBase());
      if (stored) {
        try {
          const detail = await fetchLongJobByUuid(stored.taskUuid);
          if (!cancelled) {
            setJob(detail);
            await refreshList();
          }
          return;
        } catch {
          // Task was cleaned up or belongs to another client: fall back to the list.
        }
      }
      const list = await refreshList();
      if (cancelled || list.length === 0) return;
      const latest = list[0];
      if (latest) await loadJob(latest.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadJob, refreshList]);

  // Poll only while a job is running; paused/completed jobs do not move.
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const timer = window.setInterval(() => {
      void loadJob(job.id);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [job, loadJob]);

  const progress = useMemo(() => {
    if (!job) return 0;
    const total = job.total || job.lessons || 0;
    if (total <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((job.placed / total) * 100)));
  }, [job]);

  const withBusy = async (label: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    try {
      await action();
    } finally {
      setBusy('');
    }
  };

  const start = () =>
    withBusy('start', async () => {
      try {
        const input = inputFactory(seconds);
        const taskUuid = newTaskUuid();
        const snapshotId = snapshotIdOf(input);
        const created = await startLongJob(input, taskUuid, snapshotId);
        rememberTask(window.localStorage, {
          taskUuid,
          jobId: created.job.id,
          snapshotId,
          endpoint: getApiBase(),
          submittedAt: new Date().toISOString(),
        });
        onNotice(
          (created.reused ? '已恢复同一任务：' : '长时任务已启动：') +
            created.job.id +
            '（时限 ' +
            formatElapsed(seconds * 1000) +
            '）',
        );
        await refreshList();
        await loadJob(created.job.id);
      } catch (cause) {
        onError('启动长时任务失败：' + (cause instanceof Error ? cause.message : String(cause)));
      }
    });

  startRef.current = start;
  useEffect(() => {
    onRegisterStart?.(() => startRef.current());
  }, [onRegisterStart]);
  useEffect(() => {
    onActiveChange?.(Boolean(job && (job.status === 'queued' || job.status === 'running')));
  }, [job?.status, onActiveChange]);
  useEffect(() => {
    onJobsChange?.(jobs);
  }, [jobs, onJobsChange]);

  const restartWithCurrentData = () =>
    withBusy('restart', async () => {
      if (!window.confirm('将按当前工作区数据重新开始长时排课。当前任务（如果还在运行）会被取消，旧检查点不会作为新任务的输入。继续吗？')) return;
      try {
        if (job && ['queued', 'running', 'paused'].includes(job.status)) {
          await cancelLongJob(job.id);
        }
        const inp = inputFactory(seconds);
        const taskUuid = newTaskUuid();
        const snapshotId = snapshotIdOf(inp);
        const created = await startLongJob(inp, taskUuid, snapshotId);
        rememberTask(window.localStorage, {
          taskUuid,
          jobId: created.job.id,
          snapshotId,
          endpoint: getApiBase(),
          submittedAt: new Date().toISOString(),
        });
        await refreshList();
        await loadJob(created.job.id);
        onNotice('已按当前数据启动新的长时任务：' + created.job.id);
      } catch (cause) {
        onError('按当前数据重排失败：' + (cause instanceof Error ? cause.message : String(cause)));
      }
    });
  const pause = (id: string) =>
    withBusy('pause', async () => {
      try {
        await pauseLongJob(id);
        await loadJob(id);
        await refreshList();
        onNotice('长时任务已暂停，最佳解已保存');
      } catch (cause) {
        onError('暂停失败：' + (cause instanceof Error ? cause.message : String(cause)));
      }
    });

  const resume = (id: string) =>
    withBusy('resume', async () => {
      const target = job?.id === id ? job : jobs.find((item) => item.id === id);
      try {
        const current = inputFactory(target?.timeLimitSeconds || 3600);
        if (target?.snapshotId && target.snapshotId !== snapshotIdOf(current)) {
          onNotice('已继续旧长时任务，使用启动时的数据快照；如需反映最新调整，请用当前数据重新开始。');
        }
        await resumeLongJob(id);
        await loadJob(id);
        await refreshList();
        onNotice('长时任务已继续，从当前最佳解接着算');
      } catch (cause) {
        onError('继续失败：' + (cause instanceof Error ? cause.message : String(cause)));
      }
    });

  const cancel = (id: string) =>
    withBusy('cancel', async () => {
      if (!window.confirm('取消长时任务？已保存的最佳解会保留，之后仍可继续。')) return;
      try {
        await cancelLongJob(id);
        await loadJob(id);
        await refreshList();
        onNotice('长时任务已取消');
      } catch (cause) {
        onError('取消失败：' + (cause instanceof Error ? cause.message : String(cause)));
      }
    });

  const removeCompleted = (target: LongJob) =>
    withBusy('delete', async () => {
      if (target.status !== 'completed' && target.status !== 'cancelled') {
        onError('只有已完成任务可以删除');
        return;
      }
      if (!window.confirm('删除' + statusLabel(target.status) + '任务 ' + target.id + '？任务文件和检查点会被删除，此操作不可撤销。')) return;
      try {
        await deleteLongJob(target.id);
        if (target.taskUuid) forgetTask(window.localStorage, target.taskUuid);
        if (job?.id === target.id) setJob(null);
        await refreshList();
        onNotice('已删除长时任务 ' + target.id);
      } catch (cause) {
        onError('删除失败：' + (cause instanceof Error ? cause.message : String(cause)));
      }
    });

  const activeStatus = job?.status ?? '';
  const isRunning = activeStatus === 'running';
  const removableJobs = jobs.filter((item) => item.status === 'completed' || item.status === 'cancelled');

  const applyBest = () => {
    if (!job) return;
    let changed = false;
    try {
      const current = inputFactory(job.timeLimitSeconds || 3600);
      const summary = {
        timeSlots: current.timeSlots.length,
        classes: current.classes.length,
        teachers: current.teachers.length,
        rooms: current.rooms.length,
        plans: current.coursePlans?.length ?? 0,
        locked: current.lockedEntries?.length ?? 0,
      };
      const summaryChanged = Object.entries(summary).some(
        ([key, value]) => (job.inputSummary as unknown as Record<string, number>)[key] !== value,
      );
      // Snapshot ids from older jobs were generated with a timestamp. Only
      // warn when the workspace summary actually changed, never on that false
      // positive; the user can still immediately load the old best result.
      changed = job.snapshotId
        ? summaryChanged && job.snapshotId !== snapshotIdOf(current)
        : summaryChanged;
    } catch {
      changed = false;
    }
    if (changed) {
      onNotice('已载入旧最佳课表；检测到班级、教师或计划数量有变化。如需反映最新调整，请用当前数据重新开始长时任务。');
    }
    onApplyResult(job);
  };

  return (
    <section className="section-panel long-run">
      <div className="panel-head">
        <div>
          <SectionHeading english="LONG RUN" title="长时排课任务" />
          <p className="panel-note">
            长时任务会把最佳解持续写入检查点（data/solve-jobs/），关闭页面、刷新浏览器或重启服务后都能继续；同一时间只允许一个长时任务。
          </p>
        </div>
        <span className={'status-tag ' + (isRunning ? '' : 'muted')}>{job ? statusLabel(job.status) : '未启动'}</span>
      </div>

      {showStartControls ? (
      <div className="long-start">
        <label className="long-duration">
          <span>时限</span>
          <select value={seconds} onChange={(event) => onSecondsChange(Number(event.target.value))} disabled={isRunning || Boolean(busy)}>
            {DURATIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button className="action-button" onClick={start} disabled={disabled || isRunning || Boolean(busy)}>
          {busy === 'start' ? '正在启动…' : '开始长时排课'} <span>↗</span>
        </button>
        <button className="ghost-button" onClick={() => void refreshList().then((list) => list[0] && loadJob(list[0].id))} disabled={Boolean(busy)}>
          刷新状态
        </button>
        <button className="ghost-button" onClick={() => void restartWithCurrentData()} disabled={disabled || !job || Boolean(busy)} title="用当前工作区的班级、教师、教学计划重新开始一个长时任务，不沿用旧检查点">
          {busy === 'restart' ? '正在按新数据启动…' : '加载新数据重排'}
        </button>
        {jobs.length > 0 ? <span className="long-count">服务端已保存 {jobs.length} 个长时任务</span> : null}
      </div>
      ) : null}

      {panelError ? <div className="inline-warning">{panelError}</div> : null}

      {job ? (
        <div className={'long-progress is-' + job.status}>
          <div className="long-progress-head">
            <div>
              <b>
                {statusLabel(job.status)} · {job.placed}/{job.total} 课时
              </b>
              <small>
                {job.id} · 第 {job.rounds} 轮 · 已用 {formatElapsed(job.elapsedMs)}
                {job.score !== null ? ' · 软评分 ' + job.score : ''}
                {job.unplaced > 0 ? ' · 还差 ' + job.unplaced + ' 课时' : ' · 已排满'}
              </small>
            </div>
            <span className={'status-tag ' + (job.status === 'completed' ? '' : job.status === 'running' ? 'muted' : 'danger')}>
              {statusLabel(job.status)}
            </span>
          </div>
          <div className="long-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="长时任务进度">
            <span style={{ width: progress + '%' }} />
          </div>
          <div className="long-meta">
            <span>
              进度 <b>{progress}%</b>
            </span>
            <span>
              总课时 <b>{job.total}</b>
            </span>
            <span>
              未排 <b className={job.unplaced ? 'is-danger' : ''}>{job.unplaced}</b>
            </span>
            <span>
              检查点 <b>{job.bestUpdatedAt ? new Date(job.bestUpdatedAt).toLocaleTimeString('zh-CN') : '—'}</b>
            </span>
            <span>
              输入 <b>{job.inputSummary.plans}</b> 计划 / <b>{job.inputSummary.timeSlots}</b> 时段
            </span>
          </div>
          {job.error ? <p className="panel-note">{job.error}</p> : null}
          <div className="long-actions">
            {isRunning ? (
              <button className="ghost-button" onClick={() => void pause(job.id)} disabled={Boolean(busy)}>
                {busy === 'pause' ? '暂停中…' : '暂停'}
              </button>
            ) : null}
            {canResumeStatus(job.status) ? (
              <button className="ghost-button" onClick={() => void resume(job.id)} disabled={Boolean(busy)}>
                {busy === 'resume' ? '启动中…' : '继续计算'}
              </button>
            ) : null}
            <button className="action-button" onClick={applyBest} disabled={job.bestEntries.length === 0}>
              载入最佳课表 <span>→</span>
            </button>
            <button className="ghost-button" onClick={() => void restartWithCurrentData()} disabled={Boolean(busy)} title="用当前工作区数据重新开始长时任务，不沿用旧检查点">
              {busy === 'restart' ? '正在按新数据启动…' : '加载新数据重排'}
            </button>
            {isRunning || job.status === 'paused' ? (
              <button className="ghost-button long-cancel" onClick={() => void cancel(job.id)} disabled={Boolean(busy)}>
                {busy === 'cancel' ? '取消中…' : '取消任务'}
              </button>
            ) : null}
            {job.status === 'completed' || job.status === 'cancelled' ? (
              <button className="ghost-button long-delete" onClick={() => void removeCompleted(job)} disabled={Boolean(busy)}>
                {busy === 'delete' ? '删除中…' : '删除任务'}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="panel-note">还没有长时任务。长时任务适合 120+ 班级或资源很紧、需要跑很久的数据。</p>
      )}
      {removableJobs.filter((item) => item.id !== job?.id).length > 0 ? (
        <div className="long-completed-list">
          <h4>已完成 / 已取消任务</h4>
          {removableJobs.filter((item) => item.id !== job?.id).map((item) => (
            <div className="long-completed-row" key={item.id}>
              <div>
                <b>{item.id}</b>
                <small>{statusLabel(item.status)} · {new Date(item.createdAt).toLocaleString('zh-CN')} · {item.placed}/{item.total} 课时</small>
              </div>
              <button type="button" className="ghost-button" onClick={() => void removeCompleted(item)} disabled={Boolean(busy)}>
                {busy === 'delete' ? '删除中…' : '删除'}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}










