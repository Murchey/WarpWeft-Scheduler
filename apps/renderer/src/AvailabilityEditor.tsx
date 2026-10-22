import { useMemo, useState } from 'react';
import type { SchoolData } from './types';
import { applyAvailability } from '../../../packages/availability/src';

type Commit = (next: SchoolData, options?: { invalidate?: boolean; immediate?: boolean }) => void;

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function AvailabilityEditor({ data, commit }: { data: SchoolData; commit: Commit }) {
  const unavailable = data.unavailableSlots ?? [];
  const slots = useMemo(
    () => [...data.timeSlots].sort((a, b) => a.day - b.day || a.period - b.period),
    [data.timeSlots],
  );
  const days = useMemo(() => Array.from(new Set(slots.map((slot) => slot.day))).sort((a, b) => a - b), [slots]);
  const periods = useMemo(() => Array.from(new Set(slots.map((slot) => slot.period))).sort((a, b) => a - b), [slots]);

  const [batchOpen, setBatchOpen] = useState(false);
  const [scope, setScope] = useState<'all' | 'selected'>('all');
  const [pickedTeachers, setPickedTeachers] = useState<string[]>([]);
  const [pickedDays, setPickedDays] = useState<number[]>([]);
  const [pickedPeriods, setPickedPeriods] = useState<number[]>([]);
  const [batchMessage, setBatchMessage] = useState('');

  const add = (teacherId: string, slotId: string) => {
    if (!slotId || unavailable.some((item) => item.teacherId === teacherId && item.slotId === slotId)) return;
    commit({ ...data, unavailableSlots: [...unavailable, { teacherId, slotId }] }, { invalidate: true });
  };
  const remove = (teacherId: string, slotId: string) => {
    commit(
      { ...data, unavailableSlots: unavailable.filter((item) => !(item.teacherId === teacherId && item.slotId === slotId)) },
      { invalidate: true },
    );
  };
  const clear = (teacherId: string) => {
    commit(
      { ...data, unavailableSlots: unavailable.filter((item) => item.teacherId !== teacherId) },
      { invalidate: true },
    );
  };

  const teacherIdsForBatch = scope === 'all' ? data.teachers.map((teacher) => teacher.id) : pickedTeachers;
  const batchSlotIds = slots
    .filter((slot) => pickedDays.includes(slot.day) && pickedPeriods.includes(slot.period))
    .map((slot) => slot.id);

  const toggleItem = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  const runBatch = (mode: 'block' | 'unblock') => {
    if (teacherIdsForBatch.length === 0 || batchSlotIds.length === 0) {
      setBatchMessage('请先选择教师和时间（至少一个节次）。');
      return;
    }
    const result = applyAvailability(unavailable, teacherIdsForBatch, batchSlotIds, mode);
    if (result.added === 0 && result.removed === 0) {
      setBatchMessage(
        mode === 'block'
          ? '所选教师在这些时间格已全部设为不可用，没有变化。'
          : '所选教师在这些时间格本来都可用，没有变化。',
      );
      return;
    }
    commit({ ...data, unavailableSlots: result.next }, { invalidate: true });
    setBatchMessage(
      mode === 'block'
        ? '已为 ' +
            teacherIdsForBatch.length +
            ' 位教师设置 ' +
            batchSlotIds.length +
            ' 个时间格：新增 ' +
            result.added +
            '，原本已设置 ' +
            result.unchanged +
            '。'
        : '已恢复 ' +
            teacherIdsForBatch.length +
            ' 位教师、' +
            batchSlotIds.length +
            ' 个时间格的可用状态：移除 ' +
            result.removed +
            ' 条。',
    );
  };

  return (
    <section className="section-panel resource-panel availability-panel">
      <div className="panel-head">
        <div><span className="kicker">// TEACHER AVAILABILITY</span><h2>教师不可用时间</h2></div>
        <span className="status-tag muted">单人或批量</span>
      </div>
      <p className="panel-note">从下拉框选择教师不可用的时间段，添加后会显示为标签；点击标签即可移除。排课时会自动避开这些时间。</p>

      <div className="availability-batch">
        <button type="button" className="ghost-button availability-batch-toggle" onClick={() => setBatchOpen((value) => !value)}>
          {batchOpen ? '− 收起批量设置' : '+ 批量设置（全体或多位教师）'}
        </button>
        {batchOpen ? (
          <div className="availability-batch-body">
            <div className="availability-scope">
              <label><input type="radio" name="availability-scope" checked={scope === 'all'} onChange={() => setScope('all')} /> 全体教师（{data.teachers.length} 人）</label>
              <label><input type="radio" name="availability-scope" checked={scope === 'selected'} onChange={() => setScope('selected')} /> 指定教师（{pickedTeachers.length} 人）</label>
            </div>

            {scope === 'selected' ? (
              <div className="availability-teacher-picks">
                <div className="availability-pick-actions">
                  <button type="button" className="ghost-button" onClick={() => setPickedTeachers(data.teachers.map((teacher) => teacher.id))}>全选</button>
                  <button type="button" className="ghost-button" onClick={() => setPickedTeachers([])}>清空</button>
                </div>
                <div className="availability-teacher-grid">
                  {data.teachers.map((teacher) => (
                    <label key={teacher.id}>
                      <input
                        type="checkbox"
                        checked={pickedTeachers.includes(teacher.id)}
                        onChange={() => setPickedTeachers((current) => toggleItem(current, teacher.id))}
                      />
                      {teacher.name}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="availability-batch-group">
              <span>星期（可多选）</span>
              <div className="availability-chip-group">
                {days.map((day) => (
                  <button
                    key={day}
                    type="button"
                    className={pickedDays.includes(day) ? 'availability-chip-toggle active' : 'availability-chip-toggle'}
                    onClick={() => setPickedDays((current) => toggleItem(current, day))}
                  >
                    {DAY_LABELS[day - 1] ?? '第' + day + '天'}
                  </button>
                ))}
              </div>
            </div>

            <div className="availability-batch-group">
              <span>节次（可多选）</span>
              <div className="availability-chip-group">
                {periods.map((period) => (
                  <button
                    key={period}
                    type="button"
                    className={pickedPeriods.includes(period) ? 'availability-chip-toggle active' : 'availability-chip-toggle'}
                    onClick={() => setPickedPeriods((current) => toggleItem(current, period))}
                  >
                    第 {period} 节
                  </button>
                ))}
              </div>
            </div>

            <div className="availability-batch-foot">
              <span className="availability-batch-preview">
                将影响 <b>{teacherIdsForBatch.length}</b> 位教师 × <b>{batchSlotIds.length}</b> 个时间格 = <b>{teacherIdsForBatch.length * batchSlotIds.length}</b> 项
              </span>
              <div className="availability-batch-actions">
                <button type="button" className="action-button" onClick={() => runBatch('block')}>批量设为不可用</button>
                <button type="button" className="ghost-button" onClick={() => runBatch('unblock')}>批量恢复可用</button>
              </div>
            </div>
            {batchMessage ? <p className="availability-batch-message" role="status">{batchMessage}</p> : null}
            <p className="panel-note">示例：全体教师 + 周五 + 第 3、4 节，可一次设置“周五下午集体开会”。修改会清空候选课表，需重新排课。</p>
          </div>
        ) : null}
      </div>

      {data.teachers.length === 0 ? (
        <p className="panel-note">还没有教师，请先在教师资料中添加。</p>
      ) : slots.length === 0 ? (
        <p className="panel-note">还没有时间段，请先在时间段资料中添加。</p>
      ) : (
        <div className="availability-list">
          {data.teachers.map((teacher) => {
            const own = slots.filter((slot) => unavailable.some((item) => item.teacherId === teacher.id && item.slotId === slot.id));
            const remaining = slots.filter((slot) => !own.some((item) => item.id === slot.id));
            return (
              <div className="availability-person" key={teacher.id}>
                <div className="availability-person-head">
                  <strong>{teacher.name}</strong>
                  <small>{own.length > 0 ? own.length + ' 个不可用时间' : '全部时间可用'}</small>
                </div>
                <div className="availability-chips">
                  {own.length > 0 ? own.map((slot) => (
                    <button
                      type="button"
                      key={slot.id}
                      className="availability-chip"
                      onClick={() => remove(teacher.id, slot.id)}
                      title="点击移除"
                    >
                      {slot.label}<span>×</span>
                    </button>
                  )) : <span className="availability-empty">未设置</span>}
                </div>
                <div className="availability-actions">
                  <select
                    className="availability-select"
                    value=""
                    aria-label={'为 ' + teacher.name + ' 添加不可用时间'}
                    disabled={remaining.length === 0}
                    onChange={(event) => {
                      add(teacher.id, event.target.value);
                      event.currentTarget.value = '';
                    }}
                  >
                    <option value="">{remaining.length === 0 ? '全部时间已设置' : '+ 添加不可用时间'}</option>
                    {remaining.map((slot) => <option key={slot.id} value={slot.id}>{slot.label}</option>)}
                  </select>
                  {own.length > 0 ? (
                    <button type="button" className="availability-clear" onClick={() => clear(teacher.id)}>清空</button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="panel-note">修改教师不可用时间会清空候选课表，需重新排课。</p>
    </section>
  );
}

export { AvailabilityEditor };

