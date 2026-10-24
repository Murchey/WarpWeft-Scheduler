import React from 'react';
import type { Commit, SchoolData, SoftRuleKind } from './types';
import { normalizeSoftConstraints, SOFT_CONSTRAINT_DEFINITIONS, withSoftWeight } from './softConstraints';

const WEIGHT_OPTIONS = [
  { value: 0, label: '关闭' },
  { value: 1, label: '低 1' },
  { value: 2, label: '中 2' },
  { value: 3, label: '高 3' },
  { value: 4, label: '很高 4' },
  { value: 5, label: '最高 5' },
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
  const weightOf = (kind: SoftRuleKind) => current.find((item) => item.kind === kind)?.weight ?? 0;
  const update = (kind: SoftRuleKind, weight: number) => {
    commit(withSoftWeight(data, kind, weight), { invalidate: true, immediate: true });
  };
  return (
    <div className="soft-prefs">
      <div className="soft-prefs-head">
        <div>
          <b>课表偏好（软约束）</b>
          <small>只影响课程位置，不改变可行性；权重越高越优先。修改后会清除当前候选课表。</small>
        </div>
        <span className="status-tag">{current.filter((item) => item.weight > 0).length} 项启用</span>
      </div>
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
              onChange={(event) => update(definition.kind, Number(event.target.value))}
            >
              {WEIGHT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <p className="panel-note">
        班级空档只统计常规、自习、课后服务三类日间时段；早读、晚自习、补课之间的作息间隔不计入。
      </p>
    </div>
  );
}
