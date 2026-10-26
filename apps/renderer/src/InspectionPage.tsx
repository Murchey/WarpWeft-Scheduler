import { useMemo, useState } from 'react';
import { CATEGORY_LABELS } from '../../../packages/inspection/src';
import type { InspectionIssue, InspectionRefs, InspectionReport, UtilizationRow } from '../../../packages/inspection/src';
import { EmptyState } from './runViews';
import { SectionHeading } from './components';
import type { SchoolData, SolverOutput } from './types';
import { diffTimetables } from './timetableDiff';

type Filter = 'all' | 'hard' | 'must' | 'prefer';

const SEVERITY_LABELS: Record<Filter, string> = {
  all: '全部',
  hard: '硬冲突',
  must: '必须规则',
  prefer: '尽量规则',
};

function severityLabel(issue: InspectionIssue): string {
  return issue.severity === 'hard' ? '硬冲突' : issue.severity === 'must' ? '必须' : '尽量';
}

function hasTarget(refs: InspectionRefs): boolean {
  return Boolean(refs.entryIds?.length || refs.classIds?.length || refs.teacherIds?.length || refs.roomIds?.length);
}

function percentLabel(ratio: number): string {
  return (ratio * 100).toFixed(ratio > 10 ? 0 : 1) + '%';
}

function UtilizationTable({
  rows,
  nameHeader,
  empty,
  limit,
}: {
  rows: UtilizationRow[];
  nameHeader: string;
  empty: string;
  limit?: number;
}) {
  const visible = limit ? rows.slice(0, limit) : rows;
  return (
    <div className="table-scroll">
      <table className="data-table inspect-util">
        <thead>
          <tr>
            <th>{nameHeader}</th>
            <th>已用</th>
            <th>可用</th>
            <th>占用率</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <td className="table-empty" colSpan={4}>
                {empty}
              </td>
            </tr>
          ) : (
            visible.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.used}</td>
                <td>{row.capacity}</td>
                <td>
                  <div className="inspect-meter">
                    <div className="inspect-meter-track">
                      <span
                        className={row.ratio > 1 ? 'is-over' : row.warning ? 'is-warn' : ''}
                        style={{ width: Math.min(100, row.ratio * 100) + '%' }}
                      />
                    </div>
                    <em className={row.ratio > 1 ? 'is-over' : row.warning ? 'is-warn' : ''}>{percentLabel(row.ratio)}</em>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function InspectionPage({
  data,
  candidate,
  publishedResult,
  report,
  onLocate,
  onExportExcel,
  onExportCsv,
  onPrint,
  onTimetable,
  onRules,
  onRun,
  onClear,
  adjustmentDays,
  onViewAdjustment,
  onExportAdjustment,
  onSaveOfficial,
  hasCandidate,
  published,
}: {
  data: SchoolData;
  candidate: SolverOutput | null;
  publishedResult: SolverOutput | null | undefined;
  report: InspectionReport | null;
  onLocate: (refs: InspectionRefs) => void;
  onExportExcel: () => void;
  onExportCsv: () => void;
  onPrint: () => void;
  onTimetable: () => void;
  onRules: () => void;
  onRun: () => void;
  onClear: () => void;
  adjustmentDays: { date: string; label: string; count: number; summary: string }[];
  onViewAdjustment: (date: string) => void;
  onExportAdjustment: (date: string) => void;
  onSaveOfficial: () => void;
  hasCandidate: boolean;
  published: boolean;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const counts = useMemo(() => {
    const raw = report?.issues ?? [];
    return {
      all: raw.length,
      hard: raw.filter((item) => item.severity === 'hard').length,
      must: raw.filter((item) => item.severity === 'must').length,
      prefer: raw.filter((item) => item.severity === 'prefer').length,
    };
  }, [report]);
  const issues = useMemo(() => {
    if (!report) return [];
    return filter === 'all' ? report.issues : report.issues.filter((item) => item.severity === filter);
  }, [report, filter]);

  if (!report || !hasCandidate) {
    return (
      <EmptyState
        title="还没有可检测的候选课表"
        message="先运行一次自动排课生成候选课表，检测报告会在这里生成；报告是保存正式版的依据。"
        action={
          <button className="action-button" onClick={onRun}>
            去运行排课 <span>↗</span>
          </button>
        }
      />
    );
  }

  const teachers = report.utilization.teachers;
  const teacherWarnings = teachers.filter((row) => row.warning).length;
  const roomWarnings = report.utilization.rooms.filter((row) => row.warning).length;
  const versionDiff = publishedResult && candidate ? diffTimetables(data, publishedResult, candidate) : null;

  return (
    <div className="inspect-layout">
      {adjustmentDays.length > 0 ? (
        <section className="section-panel adjust-highlight">
          <div className="panel-head">
            <SectionHeading english="ADJUSTED TIMETABLE" title="调代课更新后的课表" />
            <span className="status-tag">{adjustmentDays.length} 天有调整</span>
          </div>
          <p className="panel-note">这些日期已叠加调课、代课或停课；可查看当天，或导出该周（含调整）的课表。</p>
          <div className="adjust-highlight-list">
            {adjustmentDays.map((day) => (
              <div className="adjust-highlight-row" key={day.date}>
                <div>
                  <b>{day.label}</b>
                  <small>{day.summary}</small>
                </div>
                <div className="adjust-highlight-actions">
                  <button type="button" className="ghost-button" onClick={() => onViewAdjustment(day.date)}>查看当天</button>
                  <button type="button" className="ghost-button" onClick={() => onExportAdjustment(day.date)}>导出该周（含调整）</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <section className={'section-panel inspect-hero ' + (report.ok ? 'is-ok' : 'is-fail')}>
        <div className="panel-head">
          <SectionHeading english="FINAL TIMETABLE" title="最终课表" />
          <span className={'status-tag ' + (report.ok ? '' : 'danger')}>{report.ok ? '检测通过' : '检测未通过'}</span>
        </div>
        <p className="panel-note">
          报告基于当前候选课表计算：硬冲突或「必须」规则违反会阻止保存正式版；「尽量」规则只提示。生成于{' '}
          {new Date(report.generatedAt).toLocaleString('zh-CN')} · 用时 {report.elapsedMs} ms。
        </p>
        <div className="inspect-verdict">
          <div className="inspect-verdict-copy">
            <b>{report.ok ? '可以保存为正式版' : '先处理阻断项再保存'}</b>
            <small>
              {report.ok
                ? '没有硬冲突，也没有「必须」规则违反。'
                : report.summary.hard + ' 项硬冲突、' + report.summary.must + ' 条「必须」规则违反会阻断保存正式版。'}
            </small>
          </div>
          <div className="inspect-verdict-actions">
            <button className="ghost-button" onClick={onExportExcel}>
              导出检测报告
            </button>
            <button className="ghost-button" onClick={onExportCsv}>
              导出 CSV
            </button>
            <button className="ghost-button" onClick={onPrint}>
              打印
            </button>
            <button className="ghost-button" onClick={onClear}>
              清空候选
            </button>
            <button className="action-button" onClick={report.ok ? onSaveOfficial : onTimetable}>
              {report.ok ? (published ? '重新导出并保存为正式版' : '导出并保存为正式版') : '去调整课表'} <span>↗</span>
            </button>
          </div>
        </div>
        <div className="summary-grid inspect-summary">
          <div>
            <span>已排课时</span>
            <b>{report.summary.placed}</b>
          </div>
          <div>
            <span>未排课时</span>
            <b className={report.summary.unplaced ? 'is-danger' : ''}>{report.summary.unplaced}</b>
          </div>
          <div>
            <span>硬冲突</span>
            <b className={report.summary.hard ? 'is-danger' : ''}>{report.summary.hard}</b>
          </div>
          <div>
            <span>规则问题</span>
            <b>
              {report.summary.must}
              <em className="inspect-muted"> 必须</em> · {report.summary.prefer}
              <em className="inspect-muted"> 尽量</em>
            </b>
          </div>
        </div>
      </section>

      {versionDiff ? (
        <section className="section-panel inspect-version-diff">
          <div className="panel-head">
            <div>
              <SectionHeading english="VERSION DIFF" title="候选版与正式版差异" />
              <p className="panel-note">以当前正式版为基线，展示本次候选课表新增、移除和位置变化的课时；调整叠加版仍按日期单独记录。</p>
            </div>
            <span className="status-tag">未变化 {versionDiff.unchanged}</span>
          </div>
          <div className="summary-grid inspect-summary">
            <div><span>新增课时</span><b>{versionDiff.added}</b></div>
            <div><span>移除课时</span><b className={versionDiff.removed ? 'is-danger' : ''}>{versionDiff.removed}</b></div>
            <div><span>位置/属性变化</span><b>{versionDiff.changed}</b></div>
            <div><span>软目标质量</span><b>{publishedResult?.softScore ?? 0} → {candidate?.softScore ?? 0}</b></div>
          </div>
          <p className="panel-note">软目标质量变化：{(candidate?.softScore ?? 0) - (publishedResult?.softScore ?? 0) >= 0 ? '+' : ''}{(candidate?.softScore ?? 0) - (publishedResult?.softScore ?? 0)}；人工调整记录 {(data.adjustments ?? []).filter((item) => item.status === 'active').length} 条。</p>
          {versionDiff.items.length === 0 ? (
            <p className="panel-note success-note">候选版与正式版没有课表差异。</p>
          ) : (
            <ol className="inspect-issue-list inspect-version-list">
              {versionDiff.items.slice(0, 16).map((item) => (
                <li key={item.id} className={'inspect-issue is-' + (item.kind === 'changed' ? 'prefer' : item.kind === 'removed' ? 'hard' : 'must')}>
                  <span className={'inspect-severity is-' + (item.kind === 'changed' ? 'prefer' : item.kind === 'removed' ? 'hard' : 'must')}>
                    {item.kind === 'changed' ? '变化' : item.kind === 'removed' ? '移除' : '新增'}
                  </span>
                  <div className="inspect-issue-copy"><b>{item.label}</b><small>{item.detail}</small></div>
                </li>
              ))}
            </ol>
          )}
          {versionDiff.items.length > 16 ? <p className="panel-note">还有 {versionDiff.items.length - 16} 项差异，完整结果可通过导出课表和审计记录复核。</p> : null}
        </section>
      ) : null}

      <section className="section-panel inspect-issues">
        <div className="panel-head">
          <div>
            <SectionHeading english="FINDINGS" title="问题清单" />
            <p className="panel-note">按类型列出硬冲突与规则违反；「定位」会跳到课表预览并选中对应对象。</p>
          </div>
          <div className="segmented inspect-filter" role="tablist" aria-label="问题级别">
            {(['all', 'hard', 'must', 'prefer'] as Filter[]).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                className={filter === value ? 'active' : ''}
                onClick={() => setFilter(value)}
              >
                {SEVERITY_LABELS[value]} {counts[value]}
              </button>
            ))}
          </div>
        </div>
        {issues.length === 0 ? (
          <p className="panel-note success-note">
            {filter === 'all' ? '没有发现问题。' : '没有「' + SEVERITY_LABELS[filter] + '」级别的问题。'}
          </p>
        ) : (
          <ol className="inspect-issue-list">
            {issues.map((issue) => (
              <li key={issue.id} className={'inspect-issue is-' + issue.severity}>
                <span className={'inspect-severity is-' + issue.severity}>{severityLabel(issue)}</span>
                <div className="inspect-issue-copy">
                  <b>{issue.title}</b>
                  <small>
                    {CATEGORY_LABELS[issue.category]} · {issue.detail}
                  </small>
                </div>
                {issue.category === 'RULE' ? <button className="ghost-button inspect-locate" onClick={onRules}>去规则</button> : null}
                <button className="ghost-button inspect-locate" disabled={!hasTarget(issue.refs)} onClick={() => onLocate(issue.refs)}>
                  定位
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="resource-grid inspect-util-grid">
        <section className="section-panel">
          <div className="panel-head">
            <SectionHeading english="ROOM UTILIZATION" title="教室类型利用率" />
            {roomWarnings > 0 ? <span className="status-tag danger">{roomWarnings} 类接近上限</span> : null}
          </div>
          <UtilizationTable rows={report.utilization.rooms} nameHeader="教室类型" empty="没有教室数据。" />
          <p className="panel-note">占用率 = 已排课次 ÷（该类教室间数 × 可用时间格）；超过 85% 标黄，超过 100% 标红。</p>
        </section>
        <section className="section-panel">
          <div className="panel-head">
            <SectionHeading english="TEACHER LOAD" title="教师周课时" />
            {teacherWarnings > 0 ? <span className="status-tag danger">{teacherWarnings} 位接近上限</span> : null}
          </div>
          <UtilizationTable rows={teachers} nameHeader="教师" empty="没有教师任课数据。" limit={12} />
          <p className="panel-note">
            按占用率从高到低排列；共 {teachers.length} 位任课教师，这里显示前 12 位，完整名单在导出的报告里。
          </p>
        </section>
        <section className="section-panel inspect-class-panel">
          <div className="panel-head">
            <SectionHeading english="CLASS DENSITY" title="班级课时密度" />
          </div>
          <UtilizationTable rows={report.utilization.classes} nameHeader="班级" empty="没有班级数据。" />
          <p className="panel-note">占用率 = 该班已排课时 ÷ 可用时间格；计划课时少于可用格时占用率偏低是正常的。日内空档请看统计报表。</p>
        </section>
      </div>

    </div>
  );
}




