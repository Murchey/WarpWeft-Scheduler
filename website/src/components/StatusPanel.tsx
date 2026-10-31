import React, { useMemo, useState } from 'react';
import { useSiteI18n } from '../i18n';
import { maskText, type JobSummary } from '../serverApi';
import { useServerStatus } from '../useServerStatus';

/** 任务状态取值来自 server/api/api.cjs 的 job.status 赋值点。 */
const JOB_STATUS: Record<string, { zh: string; en: string }> = {
  queued: { zh: '排队中', en: 'queued' },
  running: { zh: '运行中', en: 'running' },
  completed: { zh: '已完成', en: 'completed' },
  paused: { zh: '已暂停', en: 'paused' },
  cancelled: { zh: '已取消', en: 'cancelled' },
  failed: { zh: '失败', en: 'failed' },
  timeout: { zh: '超时', en: 'timeout' },
  interrupted: { zh: '中断', en: 'interrupted' },
};

function formatBytes(value?: number): string {
  if (!value || value <= 0) return '—';
  const mb = value / 1024 / 1024;
  return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB';
}

function formatUptime(seconds?: number): string {
  if (!seconds && seconds !== 0) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return hours + 'h ' + minutes + 'm';
  if (minutes > 0) return minutes + 'm';
  return seconds + 's';
}

function formatElapsed(ms?: number): string {
  if (!ms && ms !== 0) return '—';
  return ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms';
}

function formatTime(value?: string | number | null, lang = 'zh-CN'): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(lang, { hour12: false });
}

export function StatusPanel() {
  const { t, pick, lang } = useSiteI18n();
  const status = useServerStatus();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const stats = status.overview?.stats;
  const jobs = useMemo(() => (status.overview?.jobs ?? []).slice(0, 10), [status.overview]);
  const logs = useMemo(() => (status.overview?.logs?.items ?? []).slice(-20), [status.overview]);

  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const job of status.overview?.jobs ?? []) {
      const key = job.status || 'unknown';
      result[key] = (result[key] || 0) + 1;
    }
    return result;
  }, [status.overview]);

  const dot =
    status.phase === 'ready'
      ? 'ok'
      : status.phase === 'offline'
        ? 'down'
        : status.phase === 'loading'
          ? ''
          : 'warn';

  const headline =
    status.phase === 'ready'
      ? t('status.title') + ' · ' + t('status.jobs')
      : status.phase === 'offline'
        ? t('status.offline')
        : status.phase === 'anonymous'
          ? t('status.anonymous')
          : status.phase === 'signedOut'
            ? t('status.signinTitle')
            : t('status.title');

  const showForget = status.phase === 'ready' || status.phase === 'signedOut';

  return (
    <section className="site-section" id="status">
      <h2>{t('status.title')}</h2>
      <p className="site-section-lead">{t('status.lead')}</p>

      <div className="site-status">
        <div className="site-status-head">
          <span className={'site-status-dot ' + dot} />
          <strong>{headline}</strong>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="site-icon-button" onClick={status.manualRefresh}>
              {t('status.refresh')}
            </button>
            {status.phase === 'ready' ? (
              <button
                type="button"
                className="site-icon-button"
                onClick={() => status.setPaused(!status.paused)}
              >
                {status.paused ? t('status.resume') : t('status.pause')}
              </button>
            ) : null}
            {showForget ? (
              <button type="button" className="site-icon-button" onClick={status.forget}>
                {t('status.forget')}
              </button>
            ) : null}
          </div>
        </div>

        {status.phase === 'loading' ? <p className="site-status-note">…</p> : null}

        {status.phase === 'offline' ? (
          <p className="site-status-note">{t('status.offlineHint')}</p>
        ) : null}

        {status.phase === 'anonymous' ? (
          <div className="site-status-grid">
            <div className="site-status-cell">
              <span>{t('status.publicInfo')}</span>
              <b>{status.health?.appVersion ?? '—'}</b>
            </div>
            <div className="site-status-cell">
              <span>SCHEMA</span>
              <b>{status.health?.schemaVersion ?? '—'}</b>
            </div>
            <div className="site-status-cell">
              <span>{t('status.solver')}</span>
              <b>{status.health?.solver?.ready ? t('status.solverReady') : t('status.solverDown')}</b>
            </div>
          </div>
        ) : null}

        {status.phase === 'signedOut' ? (
          <div>
            <p className="site-status-note">{t('status.signinHint')}</p>
            {status.expired ? <p className="site-error">{t('status.sessionExpired')}</p> : null}
            <form
              className="site-auth-form"
              onSubmit={(event) => {
                event.preventDefault();
                void status.signIn(username.trim(), password);
              }}
            >
              <label className="site-field">
                <span>{t('status.username')}</span>
                <input
                  value={username}
                  autoComplete="username"
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
              <label className="site-field">
                <span>{t('status.password')}</span>
                <input
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <button type="submit" className="site-cta" disabled={status.signingIn}>
                {status.signingIn ? t('status.loggingIn') : t('status.login')}
              </button>
            </form>
            {status.loginError ? <p className="site-error">{status.loginError}</p> : null}
            <p className="site-status-note">{t('status.forgetHint')}</p>
          </div>
        ) : null}

        {status.phase === 'ready' && stats ? (
          <div>
            <div className="site-status-grid">
              <div className="site-status-cell">
                <span>{t('status.cpu')}</span>
                <b>{stats.cpu?.usage ?? 0}%</b>
                <div className="site-meter">
                  <i style={{ width: Math.min(100, stats.cpu?.usage ?? 0) + '%' }} />
                </div>
              </div>
              <div className="site-status-cell">
                <span>{t('status.memory')}</span>
                <b>{stats.memory?.usage ?? 0}%</b>
                <div className="site-meter">
                  <i style={{ width: Math.min(100, stats.memory?.usage ?? 0) + '%' }} />
                </div>
              </div>
              <div className="site-status-cell">
                <span>{t('status.uptime')}</span>
                <b>{formatUptime(stats.uptimeSeconds)}</b>
              </div>
              <div className="site-status-cell">
                <span>{t('status.solver')}</span>
                <b>{stats.solver?.ready ? t('status.solverReady') : t('status.solverDown')}</b>
              </div>
              <div className="site-status-cell">
                <span>{t('status.queue')}</span>
                <b>
                  {(counts.running ?? 0) + ' / ' + (counts.queued ?? 0)}
                </b>
              </div>
              <div className="site-status-cell">
                <span>{t('status.clients')}</span>
                <b>
                  {(stats.clients?.active ?? 0) + ' / ' + (stats.clients?.max ?? 0)}
                </b>
              </div>
            </div>

            <table className="site-table">
              <thead>
                <tr>
                  <th>{t('status.job.id')}</th>
                  <th>{t('status.job.status')}</th>
                  <th>{t('status.job.lessons')}</th>
                  <th>{t('status.job.entries')}</th>
                  <th>{t('status.job.elapsed')}</th>
                  <th>{t('status.job.finished')}</th>
                </tr>
              </thead>
              <tbody>
                {jobs.length === 0 ? (
                  <tr>
                    <td colSpan={6}>{t('status.job.empty')}</td>
                  </tr>
                ) : (
                  jobs.map((job: JobSummary, index) => (
                    <tr key={job.id || index}>
                      <td>{job.id ? job.id.slice(0, 8) : '—'}</td>
                      <td>{JOB_STATUS[job.status ?? ''] ? pick(JOB_STATUS[job.status ?? '']) : job.status}</td>
                      <td>{job.lessons ?? '—'}</td>
                      <td>{job.entries ?? '—'}</td>
                      <td>{formatElapsed(job.elapsedMs)}</td>
                      <td>{formatTime(job.finishedAt, lang)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <p className="site-status-note" style={{ marginTop: 14 }}>
              {t('status.logs')}
            </p>
            <pre className="site-log">
              {logs.length === 0
                ? t('status.logsEmpty')
                : logs
                    .map((item) => maskText(String(item.message ?? '')).slice(0, 120))
                    .join('\n')}
            </pre>
            <p className="site-status-note">
              {t('status.maskNote')}
              {status.paused ? ' · ' + t('status.paused') : ''}
              {status.updatedAt
                ? ' · ' + t('status.updated') + ' ' + formatTime(status.updatedAt, lang)
                : ''}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
