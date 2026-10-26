import React, { useState } from 'react';
import type { Commit, SchoolData, SoftRuleKind } from './types';
import { normalizeSoftConstraints, SOFT_CONSTRAINT_DEFINITIONS, withSoftWeight } from './softConstraints';

const WEIGHT_OPTIONS = [
  { value: 0, label: '0 不启用' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5' },
];

export function SoftConstraintPanel({
  data,
  commit,
  disabled,
}: {
  data: SchoolData;
  commit: Commit;
  disabled?: boolean;
}) {
  const current = normalizeSoftConstraints(data);
  const [advanced, setAdvanced] = useState(false);
  const weightOf = (kind: SoftRuleKind) => current.find((item) => item.kind === kind)?.weight ?? 0;
  const update = (kind: SoftRuleKind, weight: number) => {
    if (weight === weightOf(kind)) return;
    if (data.candidate && !window.confirm('修改课表偏好将清除当前候选课表，包括锁定课程和手动调整，需重新排课。正式版保留。确认应用？')) return;
    commit(withSoftWeight(data, kind, weight), { invalidate: true, immediate: true });
  };
  return (
    <div className="soft-prefs">
      <div className="soft-prefs-head">
        <div>
          <b>课表偏好（软约束）</b>
          <small>偏好用于在可行课表之间取舍，允许不满足。必须遵守的政策请使用下方规则库的“必须”。修改偏好后需要重新排课。</small>
        </div>
        <span className="status-tag">{current.filter((item) => item.weight > 0).length} 项启用</span>
      </div>
      <label className="import-replace"><input type="checkbox" checked={advanced} onChange={event => setAdvanced(event.target.checked)} />显示高级权重（0–5）</label>
      <div className="soft-prefs-list">
        {SOFT_CONSTRAINT_DEFINITIONS.map((definition) => (
          <label key={definition.kind} className="soft-prefs-row">
            <span>
              <b>{definition.label}</b>
              <small>{definition.description}</small>
            </span>
            <select
              value={weightOf(definition.kind)}
              disabled={disabled}
              aria-label={definition.label + '权重'}
              title="偏好允许不满足；固定时间与必须规则优先"
              onChange={(event) => update(definition.kind, Number(event.target.value))}
            >
              {(advanced ? WEIGHT_OPTIONS : [
                { value: 0, label: '不启用' }, { value: 1, label: '一般偏好' },
                { value: 3, label: '优先满足' }, { value: 5, label: '重点优化' },
                ...([0, 1, 3, 5].includes(weightOf(definition.kind)) ? [] : [{ value: weightOf(definition.kind), label: '现有自定义偏好' }]),
              ]).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <p className="panel-note">
        「学科时段偏好」不是主科/副科两套独立开关：先在「排课准备 → 学科」逐科或批量设置「上午 / 下午 / 不限」，这里的权重同时控制两类偏好的优先程度。导入时留空会按学科名推荐，填「不限」才表示不限制；手动新增学科请在学科表选择。固定时间和教师不可用仍可能覆盖软偏好。
        权重不是“空档数量”，数值越大只代表求解器越优先减少空档，仍可能因教师/教室约束保留空档。
        班级空档只统计常规、自习、课后服务三类日间时段；早读、晚自习、补课之间的作息间隔不计入。
        如果要绝对禁止某个时段（例如体育绝不排上午），请新建「学科时间偏好」规则并选“必须”；软权重只影响优先级，不能保证。要禁止同学科相邻两节，请新建「同学科不连排」规则。
      </p>
    </div>
  );
}
