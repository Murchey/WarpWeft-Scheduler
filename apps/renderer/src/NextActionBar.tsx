import React from 'react';
import { NEXT_ACTION_LABELS } from './nextAction';
import type { NextAction } from './nextAction';

/**
 * 全局"下一步"提示条。
 *
 * 只做展示：显示当前应做的一步、原因，以及一个直达该步骤的按钮。
 * 推导逻辑全部在 nextAction.ts，这里不写任何业务判断。
 */
export function NextActionBar({
  action,
  hidden,
  busy,
  onAct,
}: {
  action: NextAction;
  hidden?: boolean;
  busy?: boolean;
  onAct: () => void;
}) {
  // 完成态且当前页没有可推动的动作时不占位：与已有页面内容重复会稀释主行动。
  if (hidden) return null;
  return (
    <div className={'next-action is-' + action.tone} role="status" aria-live="polite">
      <span className="next-action-mark" aria-hidden="true">
        {action.tone === 'blocking' ? '!' : action.tone === 'done' ? '✓' : '→'}
      </span>
      <div className="next-action-copy">
        <b>{action.title}</b>
        {action.detail ? <small>{action.detail}</small> : null}
      </div>
      <button type="button" className="next-action-btn" onClick={onAct} disabled={busy}>
        {busy ? '处理中…' : NEXT_ACTION_LABELS[action.kind]}
      </button>
    </div>
  );
}
