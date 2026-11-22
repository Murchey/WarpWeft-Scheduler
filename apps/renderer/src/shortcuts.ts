import { useEffect, useRef } from 'react';

/**
 * 全局快捷键。
 *
 * 设计取舍：
 * - 只注册三个高频、无歧义的动作，不做可配置快捷键表（配置面越大越难被记住）。
 * - 输入框/文本域/下拉获得焦点时不触发，避免抢走输入法或表单行为。
 * - 回调存在 ref 里：调用方每次渲染都会传新闭包，若直接进依赖数组会导致
 *   每一帧都重新绑定 window 监听。
 *
 * 重要：调用方必须把本 hook 放在组件任何提前 return 之前，
 * 否则条件分支会让 hook 顺序变化（曾因此导致整页白屏）。
 */
export interface ShortcutHandlers {
  onSaveProject: () => void;
  onRunSchedule: () => void;
  /** 计算中或数据未就绪时传 false，避免按下无反馈。 */
  runEnabled: boolean;
  /** 内存里已经有快捷键面板在监听 Esc 时，由调用方置 false 自行处理。 */
  escapeEnabled?: boolean;
  onEscape: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

export function useGlobalShortcuts(handlers: ShortcutHandlers) {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { onSaveProject, onRunSchedule, runEnabled, onEscape, escapeEnabled = true } = latest.current;
      const withModifier = event.ctrlKey || event.metaKey;
      if (withModifier && event.key.toLowerCase() === 's') {
        // 浏览器里 Ctrl+S 是"保存网页"，必须拦下来才有意义。
        event.preventDefault();
        onSaveProject();
        return;
      }
      if (withModifier && event.key === 'Enter') {
        if (!runEnabled || isTypingTarget(event.target)) return;
        event.preventDefault();
        onRunSchedule();
        return;
      }
      if (event.key === 'Escape' && escapeEnabled) {
        // 只做兜底关闭；具体浮层自己监听前台按键时先处理，不会走到这里。
        onEscape();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

export const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: 'Ctrl + S', label: '保存当前工程' },
  { keys: 'Ctrl + Enter', label: '在排课任务页开始计算；其他页面跳到排课任务' },
  { keys: 'Esc', label: '关闭当前弹窗或浮层' },
];
