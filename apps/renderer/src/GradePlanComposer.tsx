import React, { useEffect, useMemo, useState } from 'react';
import type { Commit, CoursePlan, SchoolData } from './types';
import { uid } from './utils';

interface SubjectRow {
  subjectId: string;
  weeklyPeriods: number;
  teacherId: string;
}

function gradeOf(klass: SchoolData['classes'][number]): string {
  return klass.grade?.trim() || '未分年级';
}

function GradePlanComposer({
  data,
  commit,
  setError,
  setNotice,
  onClose,
}: {
  data: SchoolData;
  commit: Commit;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
  onClose: () => void;
}) {
  const grades = useMemo(
    () => Array.from(new Set(data.classes.map((klass) => gradeOf(klass)))),
    [data.classes],
  );
  const [grade, setGrade] = useState(grades[0] ?? '');
  const [weeks, setWeeks] = useState<'all' | 'odd' | 'even'>('all');
  const classes = useMemo(
    () => data.classes.filter((klass) => gradeOf(klass) === grade),
    [data.classes, grade],
  );
  const [rows, setRows] = useState<SubjectRow[]>([]);

  useEffect(() => {
    const first = classes[0];
    setRows(
      data.subjects.map((subject) => {
        const existing = first
          ? data.coursePlans.find(
              (plan) =>
                plan.classId === first.id &&
                plan.subjectId === subject.id &&
                (plan.weeks ?? 'all') === weeks,
            )
          : undefined;
        return {
          subjectId: subject.id,
          weeklyPeriods: existing?.weeklyPeriods ?? 0,
          teacherId: existing?.teacherId ?? '',
        };
      }),
    );
  }, [classes, data.coursePlans, data.subjects]);

  const updateRow = (subjectId: string, patch: Partial<SubjectRow>) => {
    setRows((current) =>
      current.map((row) => (row.subjectId === subjectId ? { ...row, ...patch } : row)),
    );
  };

  const submit = () => {
    if (!grade || classes.length === 0) {
      setError('请先选择有班级的年级');
      return;
    }
    const filled = rows.filter((row) => row.weeklyPeriods > 0);
    if (filled.length === 0) {
      setError('请至少为一个学科填写每周课时');
      return;
    }
    const plans = data.coursePlans.map((plan) => ({ ...plan }));
    let created = 0;
    let updated = 0;
    for (const row of filled) {
      const subject = data.subjects.find((item) => item.id === row.subjectId);
      if (!subject) continue;
      for (const klass of classes) {
        const existing = plans.find(
          (plan) =>
            plan.classId === klass.id &&
            plan.subjectId === row.subjectId &&
            (plan.weeks ?? 'all') === weeks,
        );
        if (existing) {
          existing.weeklyPeriods = row.weeklyPeriods;
          existing.teacherId = row.teacherId;
          updated += 1;
        } else {
          const plan: CoursePlan = {
            id: uid('plan'),
            classId: klass.id,
            subjectId: row.subjectId,
            teacherId: row.teacherId,
            weeklyPeriods: row.weeklyPeriods,
            weeks,
            kind: 'regular',
          };
          plans.push(plan);
          created += 1;
        }
      }
    }
    commit({ ...data, coursePlans: plans }, { invalidate: true });
    setNotice(`已更新 ${updated} 条、新建 ${created} 条教学计划（${grade}，${classes.length} 个班）。`);
    onClose();
  };

  return (
    <div className="composer-overlay" role="dialog" aria-modal="true">
      <div className="composer-dialog grade-plan-dialog">
        <div className="composer-head">
          <div>
            <span className="kicker">// GRADE COURSE PLAN</span>
            <h2>按年级批量设置每周课时</h2>
            <p>选一个年级，一次性设置该年级所有班级的各学科每周课时；教师可留空。</p>
          </div>
          <button type="button" className="banner-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="composer-body">
          <div className="composer-fields">
            <label>
              年级
              <select value={grade} onChange={(event) => setGrade(event.target.value)}>
                {grades.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label>
              周次
              <select value={weeks} onChange={(event) => setWeeks(event.target.value as 'all' | 'odd' | 'even')}>
                <option value="all">每周</option>
                <option value="odd">单周</option>
                <option value="even">双周</option>
              </select>
            </label>
            <label>
              包含班级
              <input value={classes.map((klass) => klass.name).join('、') || '暂无班级'} readOnly />
            </label>
          </div>
          <div className="table-scroll grade-plan-table-wrap">
            <table className="data-table grade-plan-table">
              <thead>
                <tr>
                  <th>学科</th>
                  <th>每周课时</th>
                  <th>教师（选填，留空不设硬条件）</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const subject = data.subjects.find((item) => item.id === row.subjectId);
                  return (
                    <tr key={row.subjectId}>
                      <td>{subject?.name ?? row.subjectId}</td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          max={30}
                          value={row.weeklyPeriods}
                          onChange={(event) => updateRow(row.subjectId, { weeklyPeriods: Math.max(0, Number(event.target.value) || 0) })}
                        />
                      </td>
                      <td>
                        <select value={row.teacherId} onChange={(event) => updateRow(row.subjectId, { teacherId: event.target.value })}>
                          <option value="">不指定</option>
                          {data.teachers.map((teacher) => (
                            <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="panel-note">
            填 0 表示不设置该学科。保存会按“年级内每个班 × 每个学科”更新或新建所选周次的计划；不会删除其他周次的特殊计划。
          </p>
        </div>
        <div className="composer-actions">
          <button type="button" className="ghost-button" onClick={onClose}>取消</button>
          <button type="button" className="action-button" onClick={submit}>
            应用到 {classes.length} 个班 <span>→</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export { GradePlanComposer };

