import type { SolverOutcome } from './types';

/**
 * "下一步做什么"的唯一推导入口。
 *
 * 五个页面（工作台 / 排课准备 / 排课任务 / 课表预览 / 课表检测）此前各写一套
 * 判断，同一状态下会给出互相矛盾的建议。这里把决策收敛成纯函数，页面只负责
 * 把结果渲染成一条提示 + 一个主按钮。
 *
 * **优先级固定，不得在调用方重新排序：**
 * 1. 数据未通过预检（没有可排的输入，其余状态都无意义）
 * 2. 硬冲突（会阻断保存正式版）
 * 3. 未排满 / 超时（启发式没排完，需先看未排原因）
 * 4. 还没有候选课表（先排课）
 * 5. 还没有检测报告（候选已生成，去检测）
 * 6. 已通过检测但未保存正式版
 * 7. 已是正式版（可继续导出或调整）
 */
export type NextActionKind =
  | 'prepare'
  | 'rules'
  | 'run'
  | 'inspect'
  | 'publish'
  | 'export';

export type NextActionTone = 'blocking' | 'attention' | 'ready' | 'done';

export interface NextActionInput {
  /** 预检问题列表；非空表示数据还没准备好。 */
  issues: readonly string[];
  /** 是否存在候选课表。 */
  hasCandidate: boolean;
  /** 求解结果语义；旧数据可能缺失。 */
  outcome?: SolverOutcome;
  /** 是否已生成检测报告。 */
  hasReport: boolean;
  /** 检测是否通过（硬冲突与「必须」规则均为 0）。 */
  reportOk: boolean;
  /** 硬冲突数量。 */
  hardConflicts: number;
  /** 未排课时数量。 */
  unplaced: number;
  /** 是否已保存正式版。 */
  hasPublished: boolean;
}

export interface NextAction {
  kind: NextActionKind;
  tone: NextActionTone;
  /** 一句话说明"为什么是这一步"。 */
  title: string;
  /** 一句补充，可为空串。 */
  detail: string;
}

export function resolveNextAction(input: NextActionInput): NextAction {
  const {
    issues,
    hasCandidate,
    outcome,
    hasReport,
    reportOk,
    hardConflicts,
    unplaced,
    hasPublished,
  } = input;

  if (issues.length > 0) {
    return {
      kind: 'prepare',
      tone: 'blocking',
      title: '先补齐排课准备里的 ' + issues.length + ' 项数据',
      detail: issues[0] ?? '',
    };
  }

  if (hasCandidate && hardConflicts > 0) {
    return {
      kind: 'inspect',
      tone: 'blocking',
      title: '课表里还有 ' + hardConflicts + ' 项硬冲突',
      detail: '硬冲突会阻断保存正式版，先在课表检测里定位并调整。',
    };
  }

  if (hasCandidate && (outcome === 'partial' || outcome === 'timeout' || unplaced > 0)) {
    const tail = unplaced > 0 ? '还有 ' + unplaced + ' 课时未排。' : '当前时限内没有排满。';
    return {
      kind: 'run',
      tone: 'attention',
      title: '候选课表未排满',
      detail: tail + '先看未排原因，再决定改数据、放宽规则还是提高时限重算。',
    };
  }

  if (!hasCandidate) {
    return {
      kind: 'run',
      tone: 'ready',
      title: '数据已就绪，可以开始排课',
      detail: '排课任务里确认时限与随机种子后开始计算。',
    };
  }

  if (!hasReport) {
    return {
      kind: 'inspect',
      tone: 'ready',
      title: '候选课表已生成，去检测一次',
      detail: '检测通过后才能保存为正式版。',
    };
  }

  if (!reportOk) {
    return {
      kind: 'inspect',
      tone: 'blocking',
      title: '检测未通过，先处理阻断项',
      detail: '硬冲突或「必须」规则违反会阻止保存正式版。',
    };
  }

  if (!hasPublished) {
    return {
      kind: 'publish',
      tone: 'ready',
      title: '检测通过，可以保存为正式版',
      detail: '保存后可在最终课表里导出，并继续做调代课。',
    };
  }

  return {
    kind: 'export',
    tone: 'done',
    title: '正式版已保存',
    detail: '可以导出课表，也可以继续在调代课里处理临时变动。',
  };
}

/** 主按钮文案。与 kind 一一对应，避免各页面各写一份。 */
export const NEXT_ACTION_LABELS: Record<NextActionKind, string> = {
  prepare: '去排课准备',
  rules: '去设置规则',
  run: '去排课任务',
  inspect: '去课表检测',
  publish: '保存为正式版',
  export: '去课表预览',
};
