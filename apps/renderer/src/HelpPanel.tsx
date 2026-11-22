import React, { useEffect, useRef, useState } from 'react';
import { SHORTCUTS } from './shortcuts';

/**
 * 「快捷键与流程」帮助面板。
 *
 * 之前应用没有任何帮助入口，新用户只能靠页面里的长说明猜流程。这里把
 * 主流程（准备 → 排课 → 检测 → 发布）与快捷键放在同一个面板，从标题栏的
 * ? 按钮打开，Esc 关闭。
 */
export function HelpPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="confirm-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="help-panel" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <header className="help-panel-head">
          <h2 id="help-title">流程与快捷键</h2>
          <button ref={closeRef} type="button" className="banner-close" onClick={onClose} aria-label="关闭帮助">×</button>
        </header>
        <section className="help-block">
          <h3>主流程</h3>
          <ol className="help-flow">
            <li><b>01 排课准备</b><span>导入班级、教师、教室、时间段与教学计划，补齐数据检查提示项。</span></li>
            <li><b>02 排课任务</b><span>确认计算时限与随机种子，生成候选课表。</span></li>
            <li><b>03 课表预览</b><span>拖动课程调整位置，可锁定不怕重算的课时。</span></li>
            <li><b>04 课表检测</b><span>硬冲突与「必须」规则都为 0 才能保存正式版。</span></li>
            <li><b>05 调代课</b><span>按日期处理临时调课、代课与停课，不改动周课表。</span></li>
          </ol>
          <p className="panel-note">页面顶部的「下一步」条会一直告诉你当前该做哪一步，不确定时点它即可。</p>
        </section>
        <section className="help-block">
          <h3>快捷键</h3>
          <dl className="help-shortcuts">
            {SHORTCUTS.map((item) => (
              <div key={item.keys}>
                <dt><kbd>{item.keys}</kbd></dt>
                <dd>{item.label}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}

/** 标题栏里的 ? 按钮；放在这里是为了和面板共用同一份状态与样式。 */
export function HelpButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} title="流程与快捷键" aria-label="流程与快捷键">
      ?
    </button>
  );
}

export function useHelpPanel() {
  const [open, setOpen] = useState(false);
  return { open, openHelp: () => setOpen(true), closeHelp: () => setOpen(false) };
}
