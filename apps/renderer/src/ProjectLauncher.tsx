import React, { useState } from 'react';
import type { ProjectMeta } from './api';
import { useFormatters, useI18n } from './i18n';

export interface WorkspaceSummary {
  schoolName: string;
  classes: number;
  teachers: number;
  plans: number;
}

export interface ProjectLauncherProps {
  online: boolean | null;
  projects: ProjectMeta[];
  activeId: string | null;
  lastProjectId: string | null;
  busy: boolean;
  error: string;
  showOnStartup: boolean;
  /** 当前工作区是否已绑定工程；未绑定时常驻「保存为工程」入口。 */
  hasActiveProject: boolean;
  workspace: WorkspaceSummary;
  onSaveCurrentAs: () => void;
  onOpen: (id: string) => void;
  onCreate: (name: string) => void;
  onImport: (file: File) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
  onToggleStartup: (value: boolean) => void;
  onSkip: () => void;
  onOpenSettings: () => void;
}

/**
 * 启动工程选择界面（类 Office 起始页）。
 * 仅在 data 已就绪后展示，因此所有工程请求都带着有效凭据。
 */
export function ProjectLauncher(props: ProjectLauncherProps) {
  const { t } = useI18n();
  const { dateTime } = useFormatters();
  const [draftName, setDraftName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const lastProject = props.lastProjectId
    ? props.projects.find((item) => item.id === props.lastProjectId) || null
    : null;
  const activeProject = props.activeId
    ? props.projects.find((item) => item.id === props.activeId) || null
    : null;
  const featured = lastProject || activeProject || props.projects[0] || null;
  const others = props.projects.filter((item) => item.id !== (featured && featured.id));

  const submitCreate = () => {
    const name = draftName.trim();
    if (!name) return;
    props.onCreate(name);
    setDraftName('');
  };

  const submitRename = (id: string) => {
    const name = renameDraft.trim();
    if (!name) return;
    props.onRename(id, name);
    setRenamingId(null);
    setRenameDraft('');
  };

  return (
    <div className="mode-overlay launcher-overlay" role="dialog" aria-modal="true">
      <div className="mode-dialog launcher-panel">
        <header className="launcher-head">
          <span className="launcher-mark">W</span>
          <div className="launcher-copy">
            <h2>{t('launcher.title')}</h2>
            <p>{t('launcher.lead')}</p>
          </div>
          <span className={props.online === false ? 'node-status offline' : 'node-status'}>
            <i />
            {props.online === false ? t('common.offline') : t('common.online')}
          </span>
        </header>

        {props.error ? <p className="server-save-error">{props.error}</p> : null}

        {props.busy && props.projects.length === 0 ? (
          <p className="panel-note">{t('launcher.loading')}</p>
        ) : null}

        {featured ? (
          <section className="launcher-featured">
            <span className="launcher-featured-label">{t('launcher.lastUsed')}</span>
            <b className="launcher-featured-name">{featured.name}</b>
            <div className="launcher-featured-meta">
              <span>{featured.schoolName || '—'}</span>
              <span>
                {t('project.summary', {
                  classes: featured.counts.classes,
                  teachers: featured.counts.teachers,
                  plans: featured.counts.coursePlans,
                })}
              </span>
              <span>{dateTime(featured.updatedAt)}</span>
            </div>
            <div className="launcher-featured-actions">
              <button className="action-button" disabled={props.busy} onClick={() => props.onOpen(featured.id)}>
                {props.busy ? t('launcher.opening') : t('launcher.openProject')} <span>→</span>
              </button>
              {props.online === false ? (
                <button className="ghost-button" onClick={props.onOpenSettings}>{t('launcher.fixConnection')}</button>
              ) : null}
            </div>
          </section>
        ) : null}

        {others.length > 0 ? (
          <section className="launcher-recent">
            <div className="launcher-section-head">
              <h3>{t('launcher.recent')}</h3>
              <button className="ghost-button" onClick={props.onRefresh} disabled={props.busy}>{t('common.refresh')}</button>
            </div>
            <ul className="launcher-list">
              {others.map((project) => (
                <li className="launcher-row" key={project.id}>
                  {renamingId === project.id ? (
                    <>
                      <input
                        className="launcher-rename-input"
                        autoFocus
                        value={renameDraft}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') submitRename(project.id);
                          if (event.key === 'Escape') setRenamingId(null);
                        }}
                      />
                      <div className="launcher-row-actions">
                        <button className="ghost-button" onClick={() => submitRename(project.id)}>{t('common.save')}</button>
                        <button className="ghost-button" onClick={() => setRenamingId(null)}>{t('common.cancel')}</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="launcher-row-main">
                        <b>{project.name}</b>
                        <small>
                          {project.schoolName || '—'} ·{' '}
                          {t('project.summary', {
                            classes: project.counts.classes,
                            teachers: project.counts.teachers,
                            plans: project.counts.coursePlans,
                          })}{' '}
                          · {dateTime(project.updatedAt)}
                        </small>
                      </div>
                      <div className="launcher-row-actions">
                        <button className="ghost-button" disabled={props.busy} onClick={() => props.onOpen(project.id)}>{t('common.open')}</button>
                        <button
                          className="ghost-button"
                          onClick={() => {
                            setRenamingId(project.id);
                            setRenameDraft(project.name);
                          }}
                        >
                          {t('common.rename')}
                        </button>
                        <button className="ghost-button is-danger" onClick={() => props.onDelete(project.id)}>{t('common.delete')}</button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* 当前工作区未关联工程：常驻提示 + 保存入口，避免用户在“未保存”状态下工作 */}
        {!props.hasActiveProject ? (
          <section className="launcher-current">
            <div className="launcher-row-main">
              <b>
                {t('launcher.currentWorkspace')} · {props.workspace.schoolName || '—'}
              </b>
              <small>
                {t('launcher.currentHint', {
                  classes: props.workspace.classes,
                  plans: props.workspace.plans,
                })}
              </small>
            </div>
            <button className="action-button" disabled={props.busy} onClick={props.onSaveCurrentAs}>
              {t('launcher.saveCurrent')}
            </button>
          </section>
        ) : null}

        {props.projects.length === 0 && !props.busy ? (
          <p className="panel-note">{t('launcher.emptyHint')}</p>
        ) : null}

        <footer className="launcher-actions">
          <div className="launcher-create">
            <input
              className="settings-input"
              value={draftName}
              placeholder={t('project.untitled')}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitCreate();
              }}
            />
            <button className="action-button" disabled={props.busy || !draftName.trim()} onClick={submitCreate}>
              {props.busy ? t('launcher.creating') : t('launcher.createEmpty')} <span>+</span>
            </button>
          </div>
          <label className="file-button">
            <span>{t('launcher.importFile')}</span>
            <input
              type="file"
              accept=".zip,.json,.workspace.json,application/zip,application/json"
              onChange={(event) => {
                const file = event.target.files && event.target.files[0];
                if (file) props.onImport(file);
                event.currentTarget.value = '';
              }}
            />
          </label>
        </footer>

        <footer className="launcher-footer">
          <label className="launcher-startup">
            <input
              type="checkbox"
              checked={!props.showOnStartup}
              onChange={(event) => props.onToggleStartup(!event.target.checked)}
            />
            <span>{t('launcher.neverShow')}</span>
          </label>
          <button className="ghost-button" onClick={props.onSkip}>{t('launcher.skip')}</button>
        </footer>
      </div>
    </div>
  );
}
