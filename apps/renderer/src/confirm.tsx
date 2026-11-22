import React, { useEffect, useRef, useState } from 'react';

/**
 * 自绘确认对话框，替代 `window.confirm`。
 *
 * 为什么不用原生 confirm：它无法显示"会影响什么"（例如被清空的候选课表、
 * 会被删除的计划条数），观感也与自绘界面割裂；Electron 下还会阻塞渲染进程。
 *
 * 用法：
 *   if (!(await confirmDialog({ message: '清空候选课表？', tone: 'danger' }))) return;
 *
 * 实现为模块级队列而不是 Context：调用点分布在 10 个组件里，逐一透传 provider
 * 会把 props 链拉长；这里只需要在 App 根部渲染一次 <ConfirmHost />。
 * 同时打开的多个确认会排队，不会互相覆盖。
 */
export interface ConfirmOptions {
  /** 标题；省略时按 tone 给默认值。 */
  title?: string;
  /** 主问句，必须写清楚"要做什么"。 */
  message: string;
  /** 补充说明，通常是"将影响 N 个班级 / M 条计划"这类后果摘要。 */
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger 会把确认按钮标红，用于删除、清空、丢弃这类不可逆操作。 */
  tone?: 'normal' | 'danger';
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

let queue: PendingConfirm[] = [];
let current: PendingConfirm | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function pump() {
  if (current || queue.length === 0) return;
  current = queue.shift() ?? null;
  emit();
}

/** 打开确认框并等待用户选择。关闭原因（Esc / 点遮罩）一律视为取消。 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    queue = [...queue, { ...options, resolve }];
    pump();
  });
}

function settle(value: boolean) {
  const active = current;
  if (!active) return;
  current = null;
  active.resolve(value);
  emit();
  pump();
}

/** 仅测试用：清空队列，避免用例之间互相影响。 */
export function resetConfirmQueueForTests() {
  for (const item of queue) item.resolve(false);
  if (current) current.resolve(false);
  queue = [];
  current = null;
  emit();
}

export function ConfirmHost() {
  const [active, setActive] = useState<PendingConfirm | null>(current);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const listener = () => setActive(current);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // 危险操作不抢默认焦点在"确认"上，避免回车误删。
    const timer = window.setTimeout(() => {
      if (active.tone === 'danger') return;
      confirmRef.current?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        settle(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      const restore = restoreFocusRef.current;
      restoreFocusRef.current = null;
      // 触发元素可能在对话框打开期间被删除（例如删掉列表项），回落到 body。
      if (restore && document.contains(restore)) restore.focus();
    };
  }, [active]);

  if (!active) return null;
  const tone = active.tone ?? 'normal';
  return (
    <div
      className="confirm-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) settle(false);
      }}
    >
      <div
        className={'confirm-dialog is-' + tone}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
      >
        <div className="confirm-head">
          <span className="confirm-mark" aria-hidden="true">{tone === 'danger' ? '!' : '?'}</span>
          <h2 id="confirm-title">{active.title ?? (tone === 'danger' ? '确认此操作' : '请确认')}</h2>
        </div>
        <p id="confirm-message" className="confirm-message">{active.message}</p>
        {active.detail ? <p className="confirm-detail">{active.detail}</p> : null}
        <div className="confirm-actions">
          <button type="button" className="ghost-button" onClick={() => settle(false)}>
            {active.cancelLabel ?? '取消'}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={tone === 'danger' ? 'confirm-ok is-danger' : 'confirm-ok'}
            onClick={() => settle(true)}
          >
            {active.confirmLabel ?? (tone === 'danger' ? '确认执行' : '确定')}
          </button>
        </div>
      </div>
    </div>
  );
}
