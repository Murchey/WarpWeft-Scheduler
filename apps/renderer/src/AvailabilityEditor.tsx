import type { SchoolData } from './types';

type Commit = (next: SchoolData, options?: { invalidate?: boolean; immediate?: boolean }) => void;

function AvailabilityEditor({ data, commit }: { data: SchoolData; commit: Commit }) {
  const unavailable = data.unavailableSlots ?? [];
  const slots = [...data.timeSlots].sort((a, b) => a.day - b.day || a.period - b.period);
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

  return (
    <section className="section-panel resource-panel availability-panel">
      <div className="panel-head">
        <div><span className="kicker">// TEACHER AVAILABILITY</span><h2>教师不可用时间</h2></div>
        <span className="status-tag muted">下拉选择</span>
      </div>
      <p className="panel-note">从下拉框选择教师不可用的时间段，添加后会显示为标签；点击标签即可移除。排课时会自动避开这些时间。</p>
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

type PrepareSection = 'import' | 'classes' | 'teachers' | 'subjects' | 'rooms' | 'timeSlots' | 'plans' | 'availability' | 'rules';

export { AvailabilityEditor };
