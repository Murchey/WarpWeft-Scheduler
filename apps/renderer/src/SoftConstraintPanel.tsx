import React from 'react';
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
  const weightOf = (kind: SoftRuleKind) => current.find((item) => item.kind === kind)?.weight ?? 0;
  const update = (kind: SoftRuleKind, weight: number) => {
    commit(withSoftWeight(data, kind, weight), { invalidate: true, immediate: true });
  };
  return (
    <div className="soft-prefs">
      <div className="soft-prefs-head">
        <div>
          <b>课表偏好（软约束）</b>
          <small>数字是权重：0 = 不启用，1–5 越大表示越优先满足该偏好。权重只影响课程位置，不改变可行性，也不保证目标为 0；修改后会清除当前候选课表。</small>
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
              aria-label={definition.label + '权重'}
              title={'权重 0–5：数字越大越优先，不保证目标为 0'}
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
        权重不是“空档数量”，数值越大只代表求解器越优先减少空档，仍可能因教师/教室约束保留空档。
        班级空档只统计常规、自习、课后服务三类日间时段；早读、晚自习、补课之间的作息间隔不计入。
      </p>
    </div>
  );
}
