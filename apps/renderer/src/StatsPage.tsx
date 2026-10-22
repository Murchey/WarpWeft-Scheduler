import { useState } from 'react';
import type { StatsReport } from '../../../packages/statistics/src';
import type { ActualStats } from '../../../packages/adjustments/src';
import { EmptyState } from './runViews';
import { SectionHeading } from './components';

const DAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function percent(value: number): string {
  return (value * 100).toFixed(value > 10 ? 0 : 1) + '%';
}

type SortKey = 'placed' | 'planned' | 'missing';

export function StatsPage({
  report,
  actual,
  hasCandidate,
  onExportExcel,
  onExportCsv,
  onRun,
  onTimetable,
}: {
  report: StatsReport | null;
  actual: ActualStats | null;
  hasCandidate: boolean;
  onExportExcel: () => void;
  onExportCsv: () => void;
  onRun: () => void;
  onTimetable: () => void;
}) {
  const [sort, setSort] = useState<SortKey>('planned');

  if (!report) {
    return (
      <EmptyState
        title="还没有可统计的数据"
        message="先导教学计划（准备页），再运行一次排课；统计报表会同时给出「计划」和「已排」两种口径。"
        action={
          <button className="action-button" onClick={onRun}>
            去运行排课 <span>↗</span>
          </button>
        }
      />
    );
  }

  const teachers = report.teachers.slice().sort((a, b) => {
    if (sort === 'missing') return b.missing - a.missing || b.planned - a.planned;
    if (sort === 'placed') return b.placed - a.placed || b.planned - a.planned;
    return b.planned - a.planned || b.placed - a.placed;
  });
  const totalPlanned = report.summary.planned;
  const totalPlaced = report.summary.placed;
  const completion = totalPlanned > 0 ? totalPlaced / totalPlanned : 0;

  return (
    <div className="stats-layout">
      <section className="section-panel stats-hero">
        <div className="panel-head">
          <div>
            <SectionHeading english="WORKLOAD REPORT" title="课时统计" />
            <p className="panel-note">
              同一张表并列给出两种口径：<b>计划</b> = 教学计划的周课时；<b>已排</b> = 当前候选课表的实际条目。
              两者之差就是还没排进课表的课时，导出文件里保留同样的列名。单周/双周计划按该周次计，折算成平均每周需减半
              （当前折算后平均每周 {report.summary.averagePlanned} 课时）。
            </p>
          </div>
          <div className="stats-actions">
            <button className="ghost-button" onClick={onExportExcel}>
              导出 Excel
            </button>
            <button className="ghost-button" onClick={onExportCsv}>
              导出教师表 CSV
            </button>
            <button className="ghost-button" onClick={onTimetable} disabled={!hasCandidate}>
              查看课表
            </button>
          </div>
        </div>
        <div className="summary-grid">
          <div>
            <span>计划周课时</span>
            <b>{totalPlanned}</b>
          </div>
          <div>
            <span>已排课时</span>
            <b>{totalPlaced}</b>
          </div>
          <div>
            <span>未排课时</span>
            <b className={totalPlanned - totalPlaced > 0 ? 'is-danger' : ''}>{Math.max(0, totalPlanned - totalPlaced)}</b>
          </div>
          <div>
            <span>排课完成度</span>
            <b>{percent(completion)}</b>
          </div>
        </div>
        <div className="stats-days">
          {report.days.map((row) => (
            <div key={row.day} className="stats-day">
              <span>{DAY_NAMES[row.day] ?? '第' + row.day + '天'}</span>
              <b>{row.placed}</b>
              <em>{row.placed}/{row.capacity} 格 · {percent(row.ratio)}</em>
              <div className="stats-day-track">
                <i style={{ width: Math.min(100, row.ratio * 100) + '%' }} />
              </div>
            </div>
          ))}
        </div>
        <p className="panel-note">
          共 {report.summary.classes} 个班、{report.summary.teachers} 位教师、{report.summary.subjects} 个学科、{report.summary.slots} 个时间格；
          班级平均占用率 {percent(report.summary.utilization)}。
        </p>
        {report.byKind.some((row) => row.kind !== 'regular') ? (
          <div className="stats-kinds">
            <span>按时段类型</span>
            {report.byKind.map((row) => (
              <span key={row.kind}>
                {row.label} <b>{row.placed}</b>/<em>{row.planned}</em>
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <section className="section-panel">
        <div className="panel-head">
          <div>
            <SectionHeading english="TEACHER WORKLOAD" title="教师任课周课时" />
            <p className="panel-note">按学科拆分任课，计划与已排并列；占用率 = 已排课时 ÷（时间格 − 该教师不可用时段）。</p>
          </div>
          <div className="segmented stats-sort" role="tablist" aria-label="排序">
            {([
              ['planned', '按计划'],
              ['placed', '按已排'],
              ['missing', '按未排'],
            ] as [SortKey, string][]).map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={sort === value} className={sort === value ? 'active' : ''} onClick={() => setSort(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="table-scroll stats-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>教师</th>
                <th>任教学科</th>
                <th>计划</th>
                <th>已排</th>
                <th>走班</th>
                <th>未排</th>
                <th>可用时段</th>
                <th>占用率</th>
              </tr>
            </thead>
            <tbody>
              {teachers.length === 0 ? (
                <tr>
                  <td className="table-empty" colSpan={7}>
                    还没有教师任课数据。
                  </td>
                </tr>
              ) : (
                teachers.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td className="stats-subjects">
                      {row.subjects.length === 0
                        ? '—'
                        : row.subjects.map((item) => (
                            <em key={item.subjectId} title={'计划 ' + item.planned + ' · 已排 ' + item.placed}>
                              {item.subjectName}
                              {row.subjects.length > 1 ? ' ' + item.placed + '/' + item.planned : ''}
                            </em>
                          ))}
                    </td>
                    <td>{row.planned}</td>
                    <td>{row.placed}</td>
                    <td>{row.elective}</td>
                    <td className={row.missing ? 'is-danger' : ''}>{row.missing}</td>
                    <td>{row.capacity}</td>
                    <td>
                      <span className={'stats-ratio' + (row.ratio > 0.85 ? ' is-warn' : '')}>{percent(row.ratio)}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="resource-grid">
        <section className="section-panel">
          <div className="panel-head">
            <SectionHeading english="SUBJECT WORKLOAD" title="学科周课时" />
          </div>
          <div className="table-scroll stats-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>学科</th>
                  <th>班级</th>
                  <th>教师</th>
                  <th>计划</th>
                  <th>已排</th>
                  <th>未排</th>
                </tr>
              </thead>
              <tbody>
                {report.subjects.length === 0 ? (
                  <tr>
                    <td className="table-empty" colSpan={6}>
                      还没有学科数据。
                    </td>
                  </tr>
                ) : (
                  report.subjects.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.classCount}</td>
                      <td>{row.teacherCount}</td>
                      <td>{row.planned}</td>
                      <td>{row.placed}</td>
                      <td className={row.missing ? 'is-danger' : ''}>{row.missing}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section className="section-panel">
          <div className="panel-head">
            <SectionHeading english="CLASS WORKLOAD" title="班级周课时" />
          </div>
          <div className="table-scroll stats-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>班级</th>
                  <th>计划</th>
                  <th>已排</th>
                  <th>未排</th>
                  <th>空档</th>
                </tr>
              </thead>
              <tbody>
                {report.classes.length === 0 ? (
                  <tr>
                    <td className="table-empty" colSpan={5}>
                      还没有班级数据。
                    </td>
                  </tr>
                ) : (
                  report.classes.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.planned}</td>
                      <td>{row.placed}</td>
                      <td className={row.missing ? 'is-danger' : ''}>{row.missing}</td>
                      <td>{row.freeSlots}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {actual && actual.total > 0 ? (
        <section className="section-panel stats-actual">
          <div className="panel-head">
            <div>
              <SectionHeading english="ACTUAL LESSONS" title="实际上课（已记录日期）" />
              <p className="panel-note">
                来自「调代课」页生成并确认的上课记录：实际 = 本人实际上课的节数，代课 = 替他人上课，被代课 = 自己的课由他人上，停课 = 本人被取消的课。
              </p>
            </div>
          </div>
          <div className="lesson-stats">
            <span>记录 <b>{actual.total}</b></span>
            <span>正常 <b>{actual.normal}</b></span>
            <span>代课 <b>{actual.substituted}</b></span>
            <span>调课 <b>{actual.moved}</b></span>
            <span>停课 <b>{actual.cancelled}</b></span>
            <span>已确认 <b>{actual.confirmed}</b></span>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>教师</th>
                  <th>实际上课</th>
                  <th>代课</th>
                  <th>被代课</th>
                  <th>调课</th>
                  <th>停课</th>
                </tr>
              </thead>
              <tbody>
                {actual.teachers.map((row) => (
                  <tr key={row.teacherId}>
                    <td>{row.name}</td>
                    <td>{row.taught}</td>
                    <td>{row.substitute}</td>
                    <td>{row.covered}</td>
                    <td>{row.moved}</td>
                    <td className={row.cancelled ? 'is-danger' : ''}>{row.cancelled}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

