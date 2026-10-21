import React, { useState } from 'react';
import type { CoursePlan, SchoolData } from './types';
import { uid } from './utils';

type Commit = (next: SchoolData, options?: { invalidate?: boolean; immediate?: boolean }) => void;

function PlanComposer({
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
  const roomTypes = Array.from(new Set(data.rooms.map((room) => room.type).filter(Boolean)));
  const [classIds, setClassIds] = useState<string[]>(data.classes[0] ? [data.classes[0].id] : []);
  const [subjectId, setSubjectId] = useState(data.subjects[0]?.id ?? '');
  const [teacherId, setTeacherId] = useState(data.teachers[0]?.id ?? '');
  const [customSubject, setCustomSubject] = useState('');
  const [customTeacher, setCustomTeacher] = useState('');
  const [weeklyPeriods, setWeeklyPeriods] = useState(1);
  const [roomType, setRoomType] = useState(data.rooms[0]?.type ?? '');
  const [fixedSlotId, setFixedSlotId] = useState('');
  const toggleClass = (id: string) => {
    setClassIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };
  const submit = () => {
    if (classIds.length === 0) {
      setError('请至少选择一个班级');
      return;
    }
    if (!Number.isFinite(weeklyPeriods) || weeklyPeriods < 1) {
      setError('周课时必须是大于 0 的整数');
      return;
    }
    let nextSubjects = data.subjects;
    let nextTeachers = data.teachers;
    let nextSubjectId = subjectId;
    let nextTeacherId = teacherId;
    const subjectName = customSubject.trim();
    const teacherName = customTeacher.trim();
    if (subjectName) {
      const existing = data.subjects.find((item) => item.name.trim() === subjectName);
      if (existing) {
        nextSubjectId = existing.id;
      } else {
        nextSubjectId = uid('subject');
        nextSubjects = [...data.subjects, { id: nextSubjectId, name: subjectName }];
      }
    }
    if (teacherName) {
      const existing = data.teachers.find((item) => item.name.trim() === teacherName);
      if (existing) {
        nextTeacherId = existing.id;
      } else {
        nextTeacherId = uid('teacher');
        nextTeachers = [...data.teachers, { id: nextTeacherId, name: teacherName }];
      }
    }
    if (!nextSubjectId || !nextSubjects.some((item) => item.id === nextSubjectId)) {
      setError('请选择学科，或填写一个新学科');
      return;
    }
    if (!nextTeacherId || !nextTeachers.some((item) => item.id === nextTeacherId)) {
      setError('请选择教师，或填写一位新教师');
      return;
    }
    const duplicate = data.coursePlans.find((plan) => classIds.includes(plan.classId) && plan.subjectId === nextSubjectId && plan.teacherId === nextTeacherId);
    if (duplicate) {
      setError('所选班级中已存在同学科、同教师的教学计划，请调整后再添加');
      return;
    }
    const plans: CoursePlan[] = classIds.map((classId) => ({
      id: uid('plan'),
      classId,
      subjectId: nextSubjectId,
      teacherId: nextTeacherId,
      weeklyPeriods: Math.floor(weeklyPeriods),
      roomType: roomType.trim(),
      fixedSlotId,
    }));
    setError('');
    commit(
      { ...data, subjects: nextSubjects, teachers: nextTeachers, coursePlans: [...data.coursePlans, ...plans] },
      { invalidate: true },
    );
    onClose();
  };
  return (
    <div className="composer-overlay" role="dialog" aria-modal="true">
      <div className="composer-dialog">
        <div className="composer-head">
          <div><span className="kicker">// BATCH COURSE PLAN</span><h2>批量新增教学计划</h2><p>一次为多个班级创建同一门课；学科和教师也可以直接填写新的名称。</p></div>
          <button type="button" className="banner-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="composer-body">
          <div className="composer-field full">
            <span>选择班级（可多选）</span>
            <div className="composer-options">
              <button type="button" className="composer-mini" onClick={() => setClassIds(data.classes.map((item) => item.id))}>全选</button>
              <button type="button" className="composer-mini" onClick={() => setClassIds([])}>清空</button>
              {data.classes.map((item) => (
                <button type="button" key={item.id} className={classIds.includes(item.id) ? 'composer-choice active' : 'composer-choice'} onClick={() => toggleClass(item.id)}>
                  {item.name}
                </button>
              ))}
            </div>
          </div>
          <div className="composer-fields">
            <label>已有学科<select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}><option value="">选择学科</option>{data.subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>新建学科<input value={customSubject} onChange={(event) => setCustomSubject(event.target.value)} placeholder="留空则使用左侧学科" /></label>
            <label>已有教师<select value={teacherId} onChange={(event) => setTeacherId(event.target.value)}><option value="">选择教师</option>{data.teachers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>新建教师<input value={customTeacher} onChange={(event) => setCustomTeacher(event.target.value)} placeholder="留空则使用左侧教师" /></label>
          </div>
          <div className="composer-fields">
            <label>周课时<input type="number" min={1} value={weeklyPeriods} onChange={(event) => setWeeklyPeriods(Number(event.target.value))} /></label>
            <label>教室类型<input list="composer-room-types" value={roomType} onChange={(event) => setRoomType(event.target.value)} placeholder="不限 / 普通教室" /><datalist id="composer-room-types">{roomTypes.map((type) => <option key={type} value={type} />)}</datalist></label>
            <label>固定时间<select value={fixedSlotId} onChange={(event) => setFixedSlotId(event.target.value)}><option value="">不固定</option>{data.timeSlots.map((slot) => <option key={slot.id} value={slot.id}>{slot.label}</option>)}</select></label>
          </div>
        </div>
        <div className="composer-actions">
          <button type="button" className="ghost-button" onClick={onClose}>取消</button>
          <button type="button" className="action-button" onClick={submit}>创建 {classIds.length} 条计划 <span>→</span></button>
        </div>
      </div>
    </div>
  );
}

export { PlanComposer };
