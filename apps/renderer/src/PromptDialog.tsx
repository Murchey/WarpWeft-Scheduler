import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from './i18n';

export interface PromptDialogProps {
  title: string;
  lead?: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  /** 与服务端工程名上限（60）对齐。 */
  maxLength?: number;
  /** 非阻断提示，例如同名工程。 */
  hint?: string;
  /** 提交失败时就地展示，对话框保持打开以便重试。 */
  error?: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
}

/**
 * 通用「输入一段文本并确认」对话框。
 *
 * 存在的理由：Electron 不支持 window.prompt（调用即抛异常），而桌面端多处需要
 * 让用户输入名称。样式复用 RulesPage 的 rule-* 弹窗范式（z-index 85，可叠在
 * 启动页之上），但把圆角覆盖为 0 以契合项目的方角语言。
 */
export function PromptDialog(props: PromptDialogProps) {
  const { t } = useI18n();
  const [value, setValue] = useState(props.defaultValue ?? '');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 每次打开重置输入并聚焦全选：直接输入即可覆盖默认名
  useEffect(() => {
    setValue(props.defaultValue ?? '');
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, [props.defaultValue]);

  // Escape 关闭（沿用 FixedSlotsDialog 的 window 监听）；请求中不响应，避免状态丢失
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !props.busy) props.onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [props.busy, props.onClose]);

  const trimmed = value.trim();
  const submit = () => {
    if (props.busy || !trimmed) return;
    props.onConfirm(trimmed);
  };

  return (
    <div
      className="rule-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        if (event.target === event.currentTarget && !props.busy) props.onClose();
      }}
    >
      <form
        className="rule-dialog prompt-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="rule-dialog-head">
          <div>
            <h2>{props.title}</h2>
            {props.lead ? <p>{props.lead}</p> : null}
          </div>
          <button
            type="button"
            className="banner-close"
            onClick={props.onClose}
            disabled={props.busy}
            aria-label={t('common.close')}
          >
            ×
          </button>
        </div>

        <div className="rule-dialog-body">
          <label className="prompt-field">
            <span>{props.label}</span>
            <input
              ref={inputRef}
              className="settings-input"
              value={value}
              maxLength={props.maxLength ?? 60}
              placeholder={props.placeholder}
              disabled={props.busy}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          {props.hint ? <p className="panel-note">{props.hint}</p> : null}
          {props.error ? (
            <div className="rule-warnings" role="alert">
              <p>{props.error}</p>
            </div>
          ) : null}
        </div>

        <div className="rule-dialog-actions">
          <button type="button" className="ghost-button" onClick={props.onClose} disabled={props.busy}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="action-button" disabled={props.busy || !trimmed}>
            {props.busy ? (props.busyLabel ?? props.confirmLabel) : props.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
