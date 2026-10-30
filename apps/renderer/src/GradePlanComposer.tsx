import React, { useMemo, useState } from 'react';
import type { Commit, CoursePlan, SchoolData } from './types';
import { uid } from './utils';

function gradeOf(klass: SchoolData['classes'][number]): string {
  return klass.grade?.trim() || '未分年级';
}

function GradePlanComposer({
  data,
  commit,
  setError,
  onClose,
}: {
  data: SchoolData;
  commit: Commit;
  setError: (value: string) => void;
  onClose: () => void;
}) {
  const grades = useMemo(
    () => Array.from(new Set(data.classes.map((klass) => gradeOf(klass)))),
    [data.classes],
  );
  const [selected, setSelected] = useState<string[]>(grades);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const subjects = data.subjects;

  const classesOf = (grade: string) => data.classes.filter((klass) => gradeOf(klass) === grade);
  const allWeekPlan = (classId: string, subjectId: string) =>
    data.coursePlans.find(
      (plan) => plan.classId === classId && plan.subjectId === subjectId && (plan.weeks ?? 'all') === 'all',
    );
  const currentValue = (grade: string, subjectId: string): number => {
    const first = classesOf(grade)[0];
    return first ? Number(allWeekPlan(first.id, subjectId)?.weeklyPeriods ?? 0) : 0;
  };
  const toggleGrade = (grade: string) => {
    setSelected((current) =>
      current.includes(grade) ? current.filter((item) => item !== grade) : [...current, grade],
    );
  };

  const saveCell = (grade: string, subjectId: string) => {
    const key = grade + '|' + subjectId;
    const raw = drafts[key];
    if (raw === undefined) return;
    const value = Math.max(0, Math.floor(Number(raw) || 0));
    const classes = classesOf(grade);
    if (classes.length === 0) return;
    const plans: CoursePlan[] = data.coursePlans.map((plan) => ({ ...plan }));
    let changed = false;
    for (const klass of classes) {
      const index = plans.findIndex(
        (plan) => plan.classId === klass.id && plan.subjectId === subjectId && (plan.weeks ?? 'all') === 'all',
      );
      if (value <= 0) {
        if (index >= 0) {
          plans.splice(index, 1);
          changed = true;
        }
        continue;
      }
      if (index >= 0) {
        if (plans[index].weeklyPeriods !== value) {
          plans[index].weeklyPeriods = value;
          changed = true;
        }
      } else {
        plans.push({
          id: uid('plan'),
          classId: klass.id,
          subjectId,
          teacherId: '',
          weeklyPeriods: value,
          weeks: 'all',
          kind: 'regular',
        });
        changed = true;
      }
    }
    setDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    if (!changed) return;
    commit({ ...data, coursePlans: plans }, { invalidate: true });
  };

  const totalFor = (grade: string) =>
    subjects.reduce((sum, subject) => sum + currentValue(grade, subject.id), 0);

  return (
    <div className="composer-overlay" role="dialog" aria-modal="true">
      <div className="composer-dialog grade-plan-dialog">
        <div className="composer-head">
          <div>
            
            <h2>按年级批量设置课程</h2>
            <p>勾选多个年级，直接修改每周课时；每个输入框失去焦点或按回车即自动保存，不需要再点应用。</p>
          </div>
          <button type="button" className="banner-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="composer-body">
          <div className="composer-options">
            <button type="button" className="composer-mini" onClick={() => setSelected(grades)}>全选年级</button>
            <button type="button" className="composer-mini" onClick={() => setSelected([])}>清空</button>
            <span className="composer-selected-count">已选 {selected.length} / {grades.length} 个年级</span>
          </div>
          <div className="composer-class-list grade-picker-list">
            {grades.map((grade) => (
              <label key={grade} className={selected.includes(grade) ? 'composer-class-item is-checked' : 'composer-class-item'}>
                <input type="checkbox" checked={selected.includes(grade)} onChange={() => toggleGrade(grade)} />
                <span>{/^\d+$/.test(grade) ? grade + '年级' : grade}</span>
                <small>{classesOf(grade).length} 个班</small>
              </label>
            ))}
          </div>
          <div className="table-scroll grade-plan-table-wrap">
            <table className="data-table grade-plan-table grade-matrix-table">
              <thead>
                <tr>
                  <th>年级</th>
                  {subjects.map((subject) => <th key={subject.id}>{subject.name}</th>)}
                  <th>合计</th>
                </tr>
              </thead>
              <tbody>
                {selected.length === 0 ? (
                  <tr><td className="table-empty" colSpan={subjects.length + 2}>请先勾选至少一个年级。</td></tr>
                ) : selected.map((grade) => (
                  <tr key={grade}>
                    <td>
                      <b>{/^\d+$/.test(grade) ? grade + '年级' : grade}</b>
                      <small className="plan-matrix-note">{classesOf(grade).length} 个班</small>
                    </td>
                    {subjects.map((subject) => {
                      const key = grade + '|' + subject.id;
                      const value = drafts[key] ?? String(currentValue(grade, subject.id));
                      return (
                        <td key={subject.id}>
                          <input
                            className="grade-matrix-input"
                            type="number"
                            min={0}
                            max={30}
                            value={value}
                            onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
                            onBlur={() => saveCell(grade, subject.id)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') event.currentTarget.blur();
                            }}
                            aria-label={grade + ' ' + subject.name + ' 每周课时'}
                          />
                        </td>
                      );
                    })}
                    <td><b>{totalFor(grade)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="panel-note">
            输入 0 会移除该年级该学科的每周计划；已有单/双周计划不会被修改。教师仍在明细表中单独设置。
          </p>
        </div>
        <div className="composer-actions">
          <button type="button" className="action-button" onClick={onClose}>关闭 <span>→</span></button>
        </div>
      </div>
    </div>
  );
}

export { GradePlanComposer };
