import React, { useState } from 'react';
import type { Commit, CoursePlan, SchoolData } from './types';
import { SectionHeading } from './components';
import { PlanComposer } from './PlanComposer';
import { uid } from './utils';

function PlansPage({
  data,
  commit,
  setError,
}: {
  data: SchoolData;
  commit: Commit;
  setError: (value: string) => void;
}) {
  const roomTypes = Array.from(new Set(data.rooms.map((room) => room.type).filter(Boolean)));
  const [composerOpen, setComposerOpen] = useState(false);
  const total = data.coursePlans.reduce((sum, plan) => sum + Number(plan.weeklyPeriods || 0), 0);
  const update = (id: string, patch: Partial<CoursePlan>) => {
    const plans = data.coursePlans.map((plan) => (plan.id === id ? { ...plan, ...patch } : plan));
    commit({ ...data, coursePlans: plans }, { invalidate: true });
  };
  const remove = (id: string) => {
    if (!window.confirm('删除这条教学计划？相关候选课表会被清空。')) return;
    commit({ ...data, coursePlans: data.coursePlans.filter((plan) => plan.id !== id) }, { invalidate: true });
  };
  return (
    <section className="section-panel table-panel">
      <div className="panel-head">
        <SectionHeading english="COURSE PLAN REGISTER" title="教学计划" />
        <button className="mini-button" onClick={() => { if (!data.classes.length) { setError('请先添加至少一个班级'); return; } setError(''); setComposerOpen(true); }}>
          + 批量新增
        </button>
      </div>
      <datalist id="plan-room-types">{roomTypes.map((type) => <option key={type} value={type} />)}</datalist>
      <div className="plan-summary">
        <span>
          共 <b>{data.coursePlans.length}</b> 条计划
        </span>
        <span>
          每周 <b>{total}</b> 课时
        </span>
        <span>
          可用时间格 <b>{data.timeSlots.length}</b>
        </span>
      </div>
      <div className="table-scroll">
        <table className="data-table plan-table">
          <thead>
            <tr>
              <th>班级</th>
              <th>学科</th>
              <th>教师</th>
              <th>周课时</th>
              <th>周次</th>
              <th>时段类型</th>
              <th>教室类型</th>
              <th>固定时间</th>
              <th className="action-column">操作</th>
            </tr>
          </thead>
          <tbody>
            {data.coursePlans.length === 0 ? (
              <tr>
                <td className="table-empty" colSpan={9}>
                  暂无教学计划，先新增一条。
                </td>
              </tr>
            ) : (
              data.coursePlans.map((plan) => (
                <tr key={plan.id}>
                  <td>
                    <select value={plan.classId} onChange={(event) => update(plan.id, { classId: event.target.value })}>
                      {data.classes.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={plan.subjectId} onChange={(event) => update(plan.id, { subjectId: event.target.value })}>
                      {data.subjects.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={plan.teacherId} onChange={(event) => update(plan.id, { teacherId: event.target.value })}>
                      {data.teachers.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      value={plan.weeklyPeriods}
                      onChange={(event) => update(plan.id, { weeklyPeriods: Number(event.target.value) })}
                    />
                  </td>
                  <td>
                    <select value={plan.weeks ?? 'all'} onChange={(event) => update(plan.id, { weeks: event.target.value as 'all' | 'odd' | 'even' })} title="单双周计划只在对应周次上课，可与其他周次共用同一时段">
                      <option value="all">每周</option>
                      <option value="odd">单周</option>
                      <option value="even">双周</option>
                    </select>
                  </td>
                  <td>
                    <select value={plan.kind ?? 'regular'} onChange={(event) => update(plan.id, { kind: event.target.value as 'morning' | 'regular' | 'evening' | 'makeup' })} title="早读/晚自习/补课计划只会排进对应类型的时段">
                      <option value="regular">常规</option>
                      <option value="morning">早读</option>
                      <option value="evening">晚自习</option>
                      <option value="makeup">补课</option>
                    </select>
                  </td>
                  <td>
                    <input list="plan-room-types" value={plan.roomType ?? ''} onChange={(event) => update(plan.id, { roomType: event.target.value })} placeholder="不限" />
                  </td>
                  <td>
                    <select value={plan.fixedSlotId ?? ''} onChange={(event) => update(plan.id, { fixedSlotId: event.target.value })}>
                      <option value="">不固定</option>
                      {data.timeSlots.map((slot) => (
                        <option key={slot.id} value={slot.id}>
                          {slot.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="action-column">
                    <button className="danger-link" onClick={() => remove(plan.id)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="panel-note">
        固定时间会优先占用指定时间格；「单周 / 双周」计划只在对应周次上课，可以和另一周次的课程共用同一时段。修改教学计划会清空候选课表，避免旧课表与新计划混用。
      </p>
      {composerOpen ? <PlanComposer data={data} commit={commit} setError={setError} onClose={() => setComposerOpen(false)} /> : null}
    </section>
  );
}


export { PlansPage };

