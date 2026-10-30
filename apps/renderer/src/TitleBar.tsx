import React, { useEffect, useRef, useState } from 'react';
import brandIcon from '../../../assets/icon.svg?url';
import { useI18n } from './i18n';

export type TitleBarSaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

export interface TitleBarProps {
  projectName: string;
  /** 当前工作区是否已绑定到某个工程（决定「保存」的语义与文案）。 */
  projectBound: boolean;
  projectsEnabled: boolean;
  saveState: TitleBarSaveState;
  online: boolean | null;
  modeLabel: string;
  theme: 'light' | 'dark';
  authUser: { username: string } | null;
  onSwitchProject: () => void;
  onSaveProject: () => void;
  onSaveProjectAs: () => void;
  onExportProject: () => void;
  onImportProject: (file: File) => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onOpenMode: () => void;
  onLogout: () => void;
}

/**
 * 自绘标题栏。桌面端替换原生边框，并把工程工具栏放在窗口最上方；
 * 浏览器访问时保留工具栏但隐藏窗口按钮，保证 Web 版仍然可用。
 */
export function TitleBar(props: TitleBarProps) {
  const { t, lang, toggleLang } = useI18n();
  const bridge = window.warpweft;
  const isElectron = Boolean(bridge && bridge.minimize);
  const [maximized, setMaximized] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isElectron || !bridge || !bridge.onWindowState) return undefined;
    return bridge.onWindowState((state) => setMaximized(state.maximized));
  }, [isElectron, bridge]);

  const dirtyLabel =
    props.saveState === 'saving'
      ? t('common.saving')
      : props.saveState === 'error'
        ? t('common.saveFailed')
        : props.saveState === 'offline'
          ? t('common.demoOnly')
          : '';

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <img src={brandIcon} alt="" />
        <span>WARPWEFT</span>
      </div>

      <div className="titlebar-project">
        <button
          type="button"
          className="titlebar-project-name"
          onClick={props.onSwitchProject}
          title={t('project.action.switch')}
        >
          <span>{props.projectName || t('project.unbound')}</span>
          {dirtyLabel ? <em>{dirtyLabel}</em> : null}
        </button>
        {props.projectsEnabled ? (
          <div className="titlebar-project-actions">
            <button type="button" onClick={props.onSaveProject}>
              {props.projectBound ? t('project.action.save') : t('project.action.saveAsUnbound')}
            </button>
            {props.projectBound ? (
              <button type="button" onClick={props.onSaveProjectAs} title={t('project.action.saveAsHint')}>
                {t('project.action.saveAs')}
              </button>
            ) : null}
            <button type="button" onClick={() => fileRef.current?.click()}>{t('project.action.import')}</button>
            <button type="button" onClick={props.onExportProject} title={t('project.action.exportHint')}>
              {t('project.action.export')}
            </button>
          </div>
        ) : null}
        <input
          ref={fileRef}
          type="file"
          accept=".zip,.json,.workspace.json,application/zip,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files && event.target.files[0];
            if (file) props.onImportProject(file);
            event.currentTarget.value = '';
          }}
        />
      </div>

      <div className="titlebar-spacer" />

      <div className="titlebar-status">
        <button
          type="button"
          className="titlebar-status-btn"
          onClick={props.onOpenMode}
          title={t('shell.changeRunMode')}
        >
          <span className={props.online === false ? 'node-status offline' : 'node-status'}>
            <i />
            {props.modeLabel}
          </span>
        </button>
      </div>

      <div className="titlebar-tools">
        <button type="button" onClick={toggleLang} title={t('common.switchLanguage')} aria-label={t('common.switchLanguage')}>
          {lang === 'zh-CN' ? 'EN' : '中文'}
        </button>
        <button
          type="button"
          onClick={props.onToggleTheme}
          title={props.theme === 'light' ? t('common.switchToDark') : t('common.switchToLight')}
          aria-label={props.theme === 'light' ? t('common.switchToDark') : t('common.switchToLight')}
        >
          {props.theme === 'light' ? '☾' : '☀'}
        </button>
        <button type="button" onClick={props.onOpenSettings} title={t('nav.settings')} aria-label={t('nav.settings')}>
          ⚙
        </button>
        {props.authUser ? (
          <button type="button" onClick={props.onLogout} title={t('settings.server.signOut')}>
            {props.authUser.username}
          </button>
        ) : null}
      </div>

      {isElectron ? (
        <div className="titlebar-window">
          <button type="button" onClick={() => void bridge?.minimize?.()} aria-label={t('common.minimize')}>–</button>
          <button
            type="button"
            onClick={() => void bridge?.toggleMaximize?.()}
            aria-label={maximized ? t('common.restore') : t('common.maximize')}
          >
            {maximized ? '❐' : '□'}
          </button>
          <button type="button" className="is-close" onClick={() => void bridge?.closeWindow?.()} aria-label={t('common.close')}>×</button>
        </div>
      ) : null}
    </header>
  );
}
