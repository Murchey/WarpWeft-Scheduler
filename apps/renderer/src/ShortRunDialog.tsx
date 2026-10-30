import React, { useEffect, useMemo, useRef } from 'react';
import type { SchoolData } from './types';
import type { ShortRunRecord } from './runConfig';
import { RUN_MODE_OPTIONS, runResultText } from './runConfig';
import { shortRunEntryRows, shortRunMissingRefs } from './shortRunView';
import { fmtDateTime, fmtNumber } from './i18n';

const SCORE_LABELS: Record<string, string> = {
  subjectDistribution: '同学科分布',
  teacherContinuous: '教师连续性',
  teacherGaps: '教师空档',
  teacherWorkloadBalance: '教师工作量均衡',
  classGaps: '班级空档',
  subjectTimePreference: '学科时段偏好',
  rules: '规则软惩罚',
};

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : fmtDateTime(date);
}

export function ShortRunDialog({
  data,
  run,
  onClose,
  onDelete,
}: {
  data: SchoolData;
  run: ShortRunRecord;
  onClose: () => void;
  onDelete: () => void;
}) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const rows = useMemo(() => shortRunEntryRows(data, run), [data, run]);
  const missingRefs = useMemo(() => shortRunMissingRefs(data, run), [data, run]);
  const violations = run.result.hardConstraintViolations ?? [];
  const unsatisfied = run.result.unsatisfiedRules ?? [];
  const totalPeriods = Math.max(0, Number.isFinite(run.totalPeriods) ? run.totalPeriods : run.entries);
  const timeLimitSeconds = Number.isFinite(run.timeLimitSeconds) ? run.timeLimitSeconds : 0;
  const unplaced = Math.max(0, totalPeriods - run.result.entries.length);
  const modeLabel = run.mode === 'repair' ? '局部重排' : '短时计算';
  const runModeLabel = RUN_MODE_OPTIONS.find((item) => item.value === run.runMode)?.title ?? '未记录';
  const scoreBreakdown = Object.entries(run.result.scoreBreakdown ?? {})
    .filter(([, value]) => Number.isFinite(Number(value)))
    .sort(([, a], [, b]) => Number(b) - Number(a));

  return (
    <div
      className="rule-overlay short-run-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="短时计算详情"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="rule-dialog short-run-dialog">
        <div className="rule-dialog-head short-run-dialog-head">
          <div>
            
            <h2>短时计算详情</h2>
            <p>{formatWhen(run.createdAt)} · {modeLabel} · 只读快照 · 本次会话内保留</p>
          </div>
          <button type="button" className="banner-close" onClick={onClose} aria-label="关闭短时计算详情">×</button>
        </div>

        <div className="rule-dialog-body short-run-dialog-body">
          <dl className="short-run-meta">
            <div><dt>状态</dt><dd>{runResultText(run.status, run.result.outcome)}</dd></div>
            <div><dt>任务类型</dt><dd>{modeLabel}</dd></div>
            <div><dt>已排 / 计划</dt><dd>{run.result.entries.length} / {totalPeriods}</dd></div>
            <div><dt>未排课时</dt><dd className={unplaced > 0 ? 'is-warning' : ''}>{unplaced}</dd></div>
            <div><dt>软目标质量</dt><dd>{run.result.softScore}</dd></div>
            <div><dt>耗时</dt><dd>{fmtNumber(run.elapsedMs)} ms</dd></div>
            <div><dt>计算时限</dt><dd>{timeLimitSeconds} 秒</dd></div>
            <div><dt>随机种子</dt><dd>{run.randomSeed}</dd></div>
            <div><dt>锁定课时</dt><dd>{run.lockedCount}</dd></div>
            <div><dt>运行模式</dt><dd>{runModeLabel}</dd></div>
          </dl>

          {run.result.explanation ? (
            <div className="short-run-note">
              
              <p>{run.result.explanation}</p>
            </div>
          ) : null}

          {violations.length > 0 && (run.result.outcome ?? (run.result.hasFeasibleSolution ? 'feasible' : 'hard-conflict')) === 'hard-conflict' ? (
            <div className="short-run-issues">
              <b>硬约束冲突 {violations.length}</b>
              <ul>{violations.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          ) : null}

          {violations.length > 0 && run.result.outcome && run.result.outcome !== 'hard-conflict' ? (
            <div className="short-run-note">
              
              <p>{violations.join('\n')}</p>
            </div>
          ) : null}

          {unsatisfied.length > 0 ? (
            <div className="short-run-issues">
              <b>未满足的偏好规则 {unsatisfied.length}</b>
              <ul>{unsatisfied.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          ) : null}

          {scoreBreakdown.length > 0 ? (
            <div className="short-run-score">
              <div className="short-run-entries-head">
                <div><b>软目标分项</b></div>
                <span>总质量 {run.result.softScore} · 分项为惩罚值</span>
              </div>
              <div className="short-run-score-grid">
                {scoreBreakdown.map(([key, value]) => (
                  <div key={key}>
                    <span>{SCORE_LABELS[key] ?? key}</span>
                    <b>{Number(value)}</b>
                  </div>
                ))}
              </div>
              <p className="panel-note">总质量越高越好；分项惩罚越低越好。权重变化只影响搜索偏好，不代表一定能把对应项降到 0。</p>
            </div>
          ) : null}

          <div className="short-run-entries-head">
            <div><b>逐节结果</b></div>
            <span>{rows.length} 条</span>
          </div>

          {rows.length === 0 ? (
            <p className="panel-note">本次没有排入任何课时。</p>
          ) : (
            <div className="short-run-table-wrap">
              <table className="short-run-table">
                <thead>
                  <tr>
                    <th scope="col">时间</th>
                    <th scope="col">班级</th>
                    <th scope="col">学科</th>
                    <th scope="col">教师</th>
                    <th scope="col">教室</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td><b>{row.time}</b><small>{row.weeks}</small></td>
                      <td>{row.className}</td>
                      <td>{row.subject}</td>
                      <td>{row.teacher}</td>
                      <td>{row.room}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {missingRefs > 0 ? (
            <p className="panel-note short-run-stale">
              当前工作区已有 {missingRefs} 条记录引用的数据被删除，名称可能显示为原始 ID；记录本身不会被修改。
            </p>
          ) : null}
        </div>

        <div className="rule-dialog-actions short-run-dialog-actions">
          <button type="button" className="ghost-button short-run-delete" onClick={onDelete}>删除记录</button>
          <button type="button" className="ghost-button short-run-close" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
