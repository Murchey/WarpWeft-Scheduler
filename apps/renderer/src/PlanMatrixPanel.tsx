import React, { useMemo, useState } from 'react';
import type { CoursePlan, SchoolData } from './types';

function planPeriodsInWeeks(plan: CoursePlan, weeks: number): number {
  const weekly = Number(plan.weeklyPeriods || 0);
  const parity = plan.weeks ?? 'all';
  if (parity === 'odd') return weekly * Math.ceil(weeks / 2);
  if (parity === 'even') return weekly * Math.floor(weeks / 2);
  return weekly * weeks;
}

function formatPeriods(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Subject load matrix; shown in the 课时汇总 tab instead of stacking above the table. */
function PlanMatrixPanel({ data }: { data: SchoolData }) {
  const [matrixMode, setMatrixMode] = useState<'class' | 'grade'>('class');
  const [duration, setDuration] = useState(1);
  const [durationUnit, setDurationUnit] = useState<'week' | 'month'>('week');
  const matrixWeeks = Math.max(1, Math.floor(duration || 1)) * (durationUnit === 'month' ? 4 : 1);
  const matrix = useMemo(() => {
    const subjects = data.subjects;
    const classRows = data.classes.map((klass) => ({
      key: klass.id,
      label: klass.name,
      note: klass.grade || '未填年级',
      classIds: [klass.id],
    }));
    const gradeMap = new Map<string, typeof data.classes>();
    for (const klass of data.classes) {
      const grade = klass.grade?.trim() || '未分年级';
      const list = gradeMap.get(grade) ?? [];
      list.push(klass);
      gradeMap.set(grade, list);
    }
    const gradeRows = Array.from(gradeMap.entries()).map(([grade, classes]) => ({
      key: 'grade-' + grade,
      label: /^\d+$/.test(grade) ? grade + '年级' : grade,
      note: classes.length + ' 个班 / 每班平均',
      classIds: classes.map((klass) => klass.id),
    }));
    const sourceRows = matrixMode === 'class' ? classRows : gradeRows;
    const rows = sourceRows.map((row) => {
      const classIds = new Set(row.classIds);
      const counts = subjects.map((subject) => {
        const sum = data.coursePlans
          .filter((plan) => classIds.has(plan.classId) && plan.subjectId === subject.id)
          .reduce((value, plan) => value + planPeriodsInWeeks(plan, matrixWeeks), 0);
        return matrixMode === 'grade' ? sum / row.classIds.length : sum;
      });
      return { ...row, counts, total: counts.reduce((sum, value) => sum + value, 0) };
    });
    return { subjects, rows };
  }, [data, matrixMode, matrixWeeks]);

  return (
    <div className="plan-matrix-panel">
      <div className="plan-matrix-head">
        <div>
          
          <h3>课时汇总</h3>
          <p className="panel-note">按班级或年级查看所选周期内各学科的上课节数。</p>
        </div>
        <div className="plan-matrix-controls">
          <div className="segmented plan-seg" role="group" aria-label="汇总粒度">
            <button type="button" className={matrixMode === 'class' ? 'active' : ''} onClick={() => setMatrixMode('class')}>按班级</button>
            <button type="button" className={matrixMode === 'grade' ? 'active' : ''} onClick={() => setMatrixMode('grade')}>按年级</button>
          </div>
          <label>
            统计周期
            <input
              type="number"
              min={1}
              max={60}
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value) || 1)}
            />
            <select value={durationUnit} onChange={(event) => setDurationUnit(event.target.value as 'week' | 'month')}>
              <option value="week">周</option>
              <option value="month">月（按 4 周）</option>
            </select>
          </label>
          <span className="plan-matrix-total">共 {matrixWeeks} 周</span>
        </div>
      </div>
      <div className="table-scroll plan-matrix-scroll">
        <table className="data-table plan-matrix-table">
          <thead>
            <tr>
              <th>{matrixMode === 'class' ? '班级' : '年级'}</th>
              {matrix.subjects.map((subject) => <th key={subject.id} className="num">{subject.name}</th>)}
              <th className="num">合计</th>
            </tr>
          </thead>
          <tbody>
            {matrix.rows.length === 0 ? (
              <tr><td className="table-empty" colSpan={matrix.subjects.length + 2}>还没有班级数据，添加班级和教学计划后会在这里汇总。</td></tr>
            ) : matrix.rows.map((row) => (
              <tr key={row.key}>
                <td>
                  <b>{row.label}</b>
                  <small className="plan-matrix-note">{row.note}</small>
                </td>
                {row.counts.map((count, index) => (
                  <td key={matrix.subjects[index].id} className={count === 0 ? 'num is-zero' : 'num'}>
                    {count === 0 ? '—' : formatPeriods(count)}
                  </td>
                ))}
                <td className="num"><b>{formatPeriods(row.total)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="panel-note">
        每周计划按全部周计入，单周计划按奇数周、双周计划按偶数周折算；按年级查看时显示每班平均。
      </p>
    </div>
  );
}

export { PlanMatrixPanel };
