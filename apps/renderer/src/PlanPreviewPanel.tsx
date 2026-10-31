import React, { useEffect, useRef } from 'react';

interface PlanPreviewPanelProps {
  title: string;
  meta: React.ReactNode;
  /** 主内容：PlanToolbar + PlanTable。同一时刻全页仅挂载一份。 */
  children: React.ReactNode;
  /** 抽屉 / 固定时间 / 新增弹窗等浮层，挂在 overlay 的直接子节点上避免被卡片裁剪。 */
  floating?: React.ReactNode;
  onClose: () => void;
}

function PlanPreviewPanel({ title, meta, children, floating, onClose }: PlanPreviewPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  /** mousedown 是否落在遮罩自身；配合 click 的 target 判断，避免"内部按下、外部抬起"误关。 */
  const overlayPressRef = useRef(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // 菜单 / 约束抽屉 / 固定时间 / 新增弹窗先消费这一下 Esc，与 PlansPage 全屏同一套约定
      if (document.querySelector('details[data-plan-menu][open]')) return;
      if (document.querySelector('.plan-drawer-overlay, .fixed-slots-overlay, .composer-overlay')) return;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="plan-preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => { overlayPressRef.current = event.target === event.currentTarget; }}
      onClick={(event) => { if (overlayPressRef.current && event.target === event.currentTarget) onClose(); }}
    >
      <div className="plan-preview" ref={panelRef} tabIndex={-1}>
        <header className="plan-preview-head">
          <div>
            <h2>{title}</h2>
            <p className="plan-preview-meta">{meta}</p>
          </div>
          <button type="button" className="plan-preview-close" onClick={onClose} aria-label="关闭预览">×</button>
        </header>
        <div className="plan-preview-body">{children}</div>
        <footer className="plan-preview-foot">
          <span>与主表同一份数据：筛选、排序、分页、勾选与行内编辑双向同步。</span>
          <button type="button" className="ghost-button" onClick={onClose}>关闭预览</button>
        </footer>
      </div>
      {floating}
    </div>
  );
}

export { PlanPreviewPanel };
