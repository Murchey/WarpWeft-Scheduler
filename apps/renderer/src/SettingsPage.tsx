import React, { useEffect, useMemo, useState } from 'react';
import type { Commit, RunMode, SchoolData, ThemeMode } from './types';
import type { ProjectMeta } from './api';
import type { ToastLogEntry, ToastTone } from './toastLog';
import type { MessageKey } from './i18n';
import { useFormatters, useI18n } from './i18n';
import { APP_VERSION, DATA_SCHEMA_VERSION } from './schema';
import { RUN_MODE_LABEL_KEYS } from './runConfig';
import { getApiBase } from './api';
import { readActiveEndpoint } from './runtimeEndpoint';
import { WorkspaceLocationCard } from './WorkspaceLocationCard';

type SettingsTabId = 'general' | 'appearance' | 'project' | 'server' | 'logs' | 'about';

const SETTINGS_TABS: { id: SettingsTabId; labelKey: MessageKey; index: string }[] = [
  { id: 'general', labelKey: 'settings.nav.general', index: '01' },
  { id: 'appearance', labelKey: 'settings.nav.appearance', index: '02' },
  { id: 'project', labelKey: 'settings.nav.project', index: '03' },
  { id: 'server', labelKey: 'settings.nav.server', index: '04' },
  { id: 'logs', labelKey: 'settings.nav.logs', index: '05' },
  { id: 'about', labelKey: 'settings.nav.about', index: '06' },
];

const SETTINGS_TAB_KEY = 'warpweft-settings-tab';

function readInitialTab(): SettingsTabId {
  try {
    const saved = window.localStorage.getItem(SETTINGS_TAB_KEY);
    if (SETTINGS_TABS.some((item) => item.id === saved)) return saved as SettingsTabId;
  } catch {
    // storage unavailable
  }
  return 'general';
}

export interface SettingsPageProps {
  runMode: RunMode | null;
  theme: 'light' | 'dark';
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  onEditMode: () => void;
  apiOnline: boolean | null;
  serverSchema: number | null;
  authUser: { username: string } | null;
  onLogout: () => void;
  data: SchoolData;
  commit: Commit;
  toastLogs: ToastLogEntry[];
  onClearToastLogs: () => void;
  projects: ProjectMeta[];
  activeProject: ProjectMeta | null;
  projectsSupported: boolean;
  onOpenLauncher: () => void;
  onSaveProject: () => void;
  onSaveProjectAs: () => void;
  onExportProject: () => void;
  onImportProject: (file: File) => void;
  onRenameActiveProject: (name: string) => void;
  launcherAlways: boolean;
  onToggleLauncherAlways: (value: boolean) => void;
  onOpenServerPage: () => void;
  isLanServer: boolean;
}

/** 一行设置项：左侧标题 + 说明，右侧控件。 */
function SettingsRow({ label, hint, children }: { label: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        <b>{label}</b>
        {hint ? <small>{hint}</small> : null}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

/**
 * 分段选择器。刻意不用 HeroUI 的 Tabs：项目只设置 data-theme 而未设置 HeroUI
 * 依赖的 .dark 类，暗色下 Tabs/Chip 会取到浅色 token，与自绘方角风格冲突。
 */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="settings-segment" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? 'is-active' : undefined}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsPage(props: SettingsPageProps) {
  const { t, lang, setLang } = useI18n();
  const { dateTime } = useFormatters();
  const [active, setActive] = useState<SettingsTabId>(readInitialTab);
  const [projectName, setProjectName] = useState(props.activeProject?.name ?? '');

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_TAB_KEY, active);
    } catch {
      // storage unavailable
    }
  }, [active]);

  useEffect(() => {
    setProjectName(props.activeProject?.name ?? '');
  }, [props.activeProject?.id, props.activeProject?.name]);

  // 色板直接从当前主题变量读取，避免把颜色写死在文案里（旧版写死 #1C1C1C 已与真实配色脱节）
  const palette = useMemo(() => {
    const styles = typeof window === 'undefined' ? null : window.getComputedStyle(document.documentElement);
    const read = (name: string) => (styles ? styles.getPropertyValue(name).trim() : '');
    return { paper: read('--paper'), panel: read('--panel'), signal: read('--signal') };
  }, [props.theme]);

  const endpoint = readActiveEndpoint(window.localStorage) || getApiBase();
  const mode = props.runMode;
  const toneLabels: Record<ToastTone, string> = {
    error: t('settings.logs.toneError'),
    success: t('settings.logs.toneSuccess'),
    warning: t('settings.logs.toneWarning'),
    info: t('settings.logs.toneInfo'),
  };
  const reasonLabels: Record<ToastLogEntry['reason'], string> = {
    timeout: t('settings.logs.reasonTimeout'),
    closed: t('settings.logs.reasonClosed'),
    replaced: t('settings.logs.reasonReplaced'),
  };

  const copyDiagnostics = () => {
    const lines = [
      'WarpWeft Scheduler ' + APP_VERSION,
      'schema: v' + DATA_SCHEMA_VERSION,
      'run mode: ' + (mode ?? 'unset'),
      'endpoint: ' + endpoint,
      'api online: ' + String(props.apiOnline),
      'project: ' + (props.activeProject?.name ?? 'none'),
      'interface language: ' + lang,
      'time: ' + new Date().toISOString(),
    ];
    void navigator.clipboard?.writeText(lines.join('\n')).catch(() => undefined);
  };

  return (
    <div className="settings-shell">
      <nav className="settings-nav" aria-label={t('settings.title')}>
        <div className="settings-nav-head">
          <h2>{t('settings.title')}</h2>
          <p className="panel-note">{t('settings.lead')}</p>
        </div>
        {SETTINGS_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={'settings-nav-item' + (active === item.id ? ' active' : '')}
            onClick={() => setActive(item.id)}
            aria-current={active === item.id ? 'page' : undefined}
          >
            <span className="settings-nav-no">{item.index}</span>
            <span>{t(item.labelKey)}</span>
          </button>
        ))}
      </nav>

      <section className="settings-pane">
        {active === 'general' ? (
          <>
            <section className="settings-block">
              <h3>{t('settings.general.title')}</h3>
              <SettingsRow label={t('settings.general.language')} hint={t('settings.general.languageHint')}>
                <Segmented
                  value={lang}
                  ariaLabel={t('settings.general.language')}
                  onChange={(next) => setLang(next)}
                  options={[
                    { value: 'zh-CN', label: '简体中文' },
                    { value: 'en-US', label: 'English' },
                  ]}
                />
              </SettingsRow>
              <SettingsRow label={t('settings.general.launcher')} hint={t('settings.general.launcherHint')}>
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={props.launcherAlways}
                    onChange={(event) => props.onToggleLauncherAlways(event.target.checked)}
                  />
                  <span>{props.launcherAlways ? t('settings.general.launcherOn') : t('settings.general.launcherOff')}</span>
                </label>
              </SettingsRow>
            </section>
            <WorkspaceLocationCard />
          </>
        ) : null}

        {active === 'appearance' ? (
          <section className="settings-block">
            <h3>{t('settings.appearance.title')}</h3>
            <SettingsRow label={t('settings.appearance.theme')} hint={t('settings.appearance.themeHint')}>
              <Segmented
                value={props.themeMode}
                ariaLabel={t('settings.appearance.theme')}
                onChange={(next) => props.onThemeModeChange(next)}
                options={[
                  { value: 'system', label: t('settings.appearance.themeSystem') },
                  { value: 'light', label: t('common.light') },
                  { value: 'dark', label: t('common.dark') },
                ]}
              />
            </SettingsRow>
            <SettingsRow label={t('settings.appearance.themeCurrent')}>
              <span className="settings-chip">{props.theme === 'dark' ? t('common.dark') : t('common.light')}</span>
            </SettingsRow>
            <SettingsRow label={t('settings.appearance.palette')} hint={t('settings.appearance.paletteHint')}>
              <span className="settings-swatch">
                <i style={{ background: palette.paper }} title={t('settings.appearance.swatchPaper')} />
                <i style={{ background: palette.panel }} title={t('settings.appearance.swatchPanel')} />
                <i style={{ background: palette.signal }} title={t('settings.appearance.swatchSignal')} />
              </span>
            </SettingsRow>
          </section>
        ) : null}

        {active === 'project' ? (
          <>
            <section className="settings-block">
              <h3>{t('settings.project.current')}</h3>
              <SettingsRow label={t('settings.project.name')} hint={t('settings.project.nameHint')}>
                <input
                  className="settings-input"
                  value={projectName}
                  placeholder={t('settings.project.namePlaceholder')}
                  disabled={!props.projectsSupported || !props.activeProject}
                  onChange={(event) => setProjectName(event.target.value)}
                  onBlur={() => {
                    const next = projectName.trim();
                    if (next && props.activeProject && next !== props.activeProject.name) {
                      props.onRenameActiveProject(next);
                    }
                  }}
                />
              </SettingsRow>
              <SettingsRow label={t('settings.project.openLauncher')} hint={t('settings.project.openLauncherHint')}>
                <div className="settings-inline-actions">
                  <button type="button" className="ghost-button" onClick={props.onOpenLauncher}>{t('project.action.switch')}</button>
                  {props.activeProject ? (
                    <>
                      <button type="button" className="ghost-button" disabled={!props.projectsSupported} onClick={props.onSaveProject}>
                        {t('project.action.save')}
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={!props.projectsSupported}
                        onClick={props.onSaveProjectAs}
                        title={t('project.action.saveAsHint')}
                      >
                        {t('project.action.saveAs')}
                      </button>
                    </>
                  ) : (
                    // 未绑定工程时「保存」与「另存为」是同一个动作，只保留一个入口
                    <button type="button" className="ghost-button" disabled={!props.projectsSupported} onClick={props.onSaveProjectAs}>
                      {t('project.action.saveAsUnbound')}
                    </button>
                  )}
                  <button type="button" className="ghost-button" onClick={props.onExportProject} title={t('project.action.exportHint')}>
                    {t('project.action.export')}
                  </button>
                  <label className="file-button file-button-compact">
                    <span>{t('project.action.import')}</span>
                    <input
                      type="file"
                      accept=".zip,application/zip"
                      onChange={(event) => {
                        const file = event.target.files && event.target.files[0];
                        if (file) props.onImportProject(file);
                        event.currentTarget.value = '';
                      }}
                    />
                  </label>
                </div>
              </SettingsRow>
              <SettingsRow label={t('settings.project.stats')}>
                <div className="settings-stats">
                  <span>{t('settings.project.countProjects')} <b>{props.projects.length}</b></span>
                  <span>{t('common.classCount.other', { count: props.data.classes.length })}</span>
                  <span>{t('common.teacherCount.other', { count: props.data.teachers.length })}</span>
                  <span>{t('common.planCount.other', { count: props.data.coursePlans.length })}</span>
                </div>
              </SettingsRow>
              {props.activeProject ? (
                <p className="panel-note">{t('project.savedAt', { time: dateTime(props.activeProject.updatedAt) })}</p>
              ) : (
                <p className="panel-note">{t('settings.project.notBound')}</p>
              )}
            </section>

            <section className="settings-block">
              <h3>{t('settings.project.school')}</h3>
              <SettingsRow label={t('settings.project.school')} hint={t('settings.project.schoolHint')}>
                <input
                  className="settings-input"
                  value={props.data.school.name}
                  onChange={(event) =>
                    props.commit({ ...props.data, school: { ...props.data.school, name: event.target.value } })
                  }
                />
              </SettingsRow>
              <SettingsRow label={t('settings.project.roomMode')} hint={t('settings.project.roomModeHint')}>
                <select
                  className="settings-input"
                  value={props.data.roomMode ?? 'simplified'}
                  onChange={(event) =>
                    props.commit({ ...props.data, roomMode: event.target.value as 'simplified' | 'full' }, { invalidate: true })
                  }
                >
                  <option value="simplified">{t('settings.project.roomSimplified')}</option>
                  <option value="full">{t('settings.project.roomFull')}</option>
                </select>
              </SettingsRow>
            </section>
          </>
        ) : null}

        {active === 'server' ? (
          <section className="settings-block">
            <h3>{t('settings.server.title')}</h3>
            <SettingsRow label={t('settings.server.mode')} hint={t('settings.server.editMode')}>
              <div className="settings-inline-actions">
                <strong>{mode ? t(RUN_MODE_LABEL_KEYS[mode].title) : t('settings.server.modeUnset')}</strong>
                <button type="button" className="ghost-button" onClick={props.onEditMode}>{t('settings.server.editMode')}</button>
              </div>
            </SettingsRow>
            <SettingsRow label={t('settings.server.endpoint')}>
              <code className="settings-endpoint">{endpoint}</code>
            </SettingsRow>
            <SettingsRow label={t('settings.server.status')}>
              <span className={'settings-chip' + (props.apiOnline === false ? ' is-warn' : props.apiOnline ? ' is-ok' : '')}>
                {props.apiOnline === null ? t('common.connecting') : props.apiOnline ? t('common.online') : t('common.offline')}
              </span>
            </SettingsRow>
            <SettingsRow label={t('settings.server.schema')}>
              <strong>v{props.serverSchema ?? DATA_SCHEMA_VERSION}</strong>
            </SettingsRow>
            {props.authUser ? (
              <SettingsRow label={t('settings.server.account')}>
                <div className="settings-inline-actions">
                  <strong>{props.authUser.username}</strong>
                  <button type="button" className="ghost-button" onClick={props.onLogout}>{t('settings.server.signOut')}</button>
                </div>
              </SettingsRow>
            ) : null}
            {props.isLanServer ? (
              <SettingsRow label={t('nav.server')}>
                <button type="button" className="ghost-button" onClick={props.onOpenServerPage}>{t('settings.server.openServerPage')}</button>
              </SettingsRow>
            ) : null}
          </section>
        ) : null}

        {active === 'logs' ? (
          <section className="settings-block settings-log-card">
            <div className="settings-card-head">
              <h3>{t('settings.logs.title')}</h3>
              <div className="settings-inline-actions">
                <button type="button" className="tt-btn tt-btn-quiet" onClick={copyDiagnostics}>{t('settings.logs.copyDiagnostics')}</button>
                <button type="button" className="tt-btn tt-btn-quiet" onClick={props.onClearToastLogs} disabled={props.toastLogs.length === 0}>
                  {t('settings.logs.clear')}
                </button>
              </div>
            </div>
            <p className="panel-note">{t('settings.logs.hint')}</p>
            {props.toastLogs.length === 0 ? (
              <div className="settings-log-empty">{t('settings.logs.empty')}</div>
            ) : (
              <div className="settings-log-list">
                {props.toastLogs.map((entry) => (
                  <article className={'settings-log-item is-' + entry.tone} key={entry.id}>
                    <div className="settings-log-meta">
                      <span className={'settings-log-tone is-' + entry.tone}>{toneLabels[entry.tone]}</span>
                      <time>{dateTime(entry.at)}</time>
                      <em>{reasonLabels[entry.reason]}</em>
                    </div>
                    <strong>{entry.title}</strong>
                    <p>{entry.message}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {active === 'about' ? (
          <section className="settings-block">
            <h3>{t('settings.about.title')}</h3>
            <SettingsRow label={t('settings.about.version')}><strong>{APP_VERSION}</strong></SettingsRow>
            <SettingsRow label={t('settings.about.schema')}><strong>v{DATA_SCHEMA_VERSION}</strong></SettingsRow>
            <SettingsRow label={t('settings.about.runtime')}>
              <strong>{window.warpweft ? 'Electron ' + (window.warpweft.platform || '') : 'Web'}</strong>
            </SettingsRow>
            <SettingsRow label={t('settings.about.license')}><strong>MIT</strong></SettingsRow>
          </section>
        ) : null}
      </section>
    </div>
  );
}
