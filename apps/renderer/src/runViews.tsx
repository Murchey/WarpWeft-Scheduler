import React, { useEffect, useState } from 'react';
import { Progress } from '@heroui/react';
import type { CoursePlan, SchoolData } from './types';
import { RUN_STEPS } from './runConfig';
import type { RunProgress } from './runConfig';
import { unscheduledHints } from './rules';
import { findClass, planSubjectName } from './selectors';

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span>00</span>
      <p>
        <b>{title}</b>
        <br />
        {message}
      </p>
      {action}
    </div>
  );
}

export function RunProgressView({ progress }: { progress: RunProgress }) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (
      !progress.startedAt ||
      progress.phase === 'completed' ||
      progress.phase === 'failed' ||
      progress.phase === 'idle'
    ) {
      return;
    }
    const timer = window.setInterval(() => forceTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [progress.phase, progress.startedAt]);
  const activeIndex =
    progress.phase === 'failed'
      ? 2
      : progress.phase === 'idle'
        ? -1
        : RUN_STEPS.findIndex((step) => step.phase === progress.phase);
  return (
    <div className={'run-progress ' + progress.phase} aria-live="polite">
      <div className="run-progress-head">
        <div>
          <span className="kicker">// SCHEDULE PROGRESS</span>
          <strong>{progress.message}</strong>
        </div>
        {progress.startedAt ? (
          <small>
            {Math.max(0, Math.round((Date.now() - progress.startedAt) / 1000))}s
          </small>
        ) : null}
      </div>
      <div className="run-progress-track">
        {RUN_STEPS.map((step, index) => (
          <div
            key={step.phase}
            className={
              'run-progress-step' +
              (index <= activeIndex ? ' active' : '') +
              (step.phase === progress.phase ? ' current' : '')
            }
          >
            <i /> <span>{step.label}</span>
          </div>
        ))}
      </div>
      <Progress
        className="hero-ui-progress"
        size="sm"
        aria-label="排课阶段进度"
        value={activeIndex < 0 ? 0 : ((activeIndex + 1) / RUN_STEPS.length) * 100}
        color={progress.phase === 'failed' ? 'danger' : 'primary'}
      />
      {progress.phase === 'solving' ? <div className="run-progress-pulse" /> : null}
    </div>
  );
}

export function MissingReasons({
  data,
  missing,
}: {
  data: SchoolData;
  missing: { plan: CoursePlan; missing: number }[];
}) {
  if (missing.length === 0) return null;
  return (
    <div className="missing-reasons">
      <div className="missing-head">
        <div>
          <span className="kicker">// UNSCHEDULED</span>
          <h3>未排原因</h3>
        </div>
        <span className="status-tag danger">{missing.length} 条计划未排完</span>
      </div>
      <p className="panel-note">
        以下是基于当前教师时间、教室和已启用规则的可能原因；不是数学证明。
      </p>
      {missing.slice(0, 6).map((item) => {
        const hints = unscheduledHints(item.plan, data);
        return (
          <div className="missing-reason" key={item.plan.id}>
            <div className="missing-reason-title">
              <b>
                {findClass(data, item.plan.classId)?.name ?? item.plan.classId} ·{' '}
                {planSubjectName(data, item.plan)}
              </b>
              <span>还缺 {item.missing} 课时</span>
            </div>
            {hints.length > 0 ? (
              <ul>
                {hints.map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ul>
            ) : (
              <p>时间格、教师或教室资源不足；可先检查教师时间和教室容量。</p>
            )}
          </div>
        );
      })}
      {missing.length > 6 ? (
        <p className="panel-note">还有 {missing.length - 6} 条未展开。</p>
      ) : null}
    </div>
  );
}
