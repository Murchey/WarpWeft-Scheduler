import React, { useEffect, useMemo, useState } from 'react';
import type { CoursePlan, SlotKind, WeekType } from './types';
import type { PlanLookups } from './planTableView';
import { KIND_LABELS, planFixedLabels } from './planTableView';

interface PlanDetailDrawerProps {
  plan: CoursePlan;
  lookups: PlanLookups;
  roomTypes: string[];
  onClose: () => void;
  onSave: (patch: Partial<CoursePlan>) => void;
  onDelete: () => boolean;
  onOpenFixed: () => void;
  /** The fixed-slot dialog owns Esc while it is open. */
  escapeDisabled?: boolean;
}

const WEEK_OPTIONS: { value: WeekType; label: string }[] = [
  { value: 'all', label: '每周' },
  { value: 'odd', label: '单周' },
  { value: 'even', label: '双周' },
];
const KIND_OPTIONS: { value: SlotKind; label: string }[] = [
  { value: 'regular', label: '常规' },
  { value: 'morning', label: '早读' },
  { value: 'study', label: '自习' },
  { value: 'aftercare', label: '课后服务' },
  { value: 'evening', label: '晚自习' },
  { value: 'makeup', label: '补课' },
];

/** Advanced constraints that are hidden from the default table columns. */
function PlanDetailDrawer({ plan, lookups, roomTypes, onClose, onSave, onDelete, onOpenFixed, escapeDisabled = false }: PlanDetailDrawerProps) {
  const initial = useMemo(() => ({
    weeks: plan.weeks ?? 'all',
    kind: plan.kind ?? 'regular',
    roomType: plan.roomType ?? '',
    consecutive: plan.consecutive && plan.consecutive >= 2 ? plan.consecutive : 0,
    pairId: plan.pairId ?? '',
  }), [plan.id, plan.weeks, plan.kind, plan.roomType, plan.consecutive, plan.pairId]);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState('');

  useEffect(() => {
    setDraft(initial);
    setError('');
  }, [initial]);

  const dirty = draft.weeks !== initial.weeks
    || draft.kind !== initial.kind
    || draft.roomType !== initial.roomType
    || draft.consecutive !== initial.consecutive
    || draft.pairId !== initial.pairId;

  const close = () => {
    if (dirty && !window.confirm('有未保存的约束修改，放弃后关闭？')) return;
    onClose();
  };

  useEffect(() => {
    if (escapeDisabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (dirty && !window.confirm('有未保存的约束修改，放弃后关闭？')) return;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dirty, onClose, escapeDisabled]);

  const save = () => {
    if (draft.consecutive === 1 || draft.consecutive < 0 || draft.consecutive > 4) {
      setError('连堂节数只能填 0 或 2–4。');
      return;
    }
    if (draft.consecutive >= 2 && draft.consecutive > Number(plan.weeklyPeriods || 0)) {
      setError('连堂节数不能超过每周课时。');
      return;
    }
    setError('');
    onSave({
      weeks: draft.weeks,
      kind: draft.kind,
      roomType: draft.roomType.trim() || undefined,
      consecutive: draft.consecutive >= 2 ? draft.consecutive : undefined,
      pairId: draft.pairId.trim() || undefined,
    });
    onClose();
  };

  const fixedLabels = planFixedLabels(plan, lookups);
  const klass = lookups.classById.get(plan.classId)?.name ?? plan.classId;
  const subject = lookups.subjectById.get(plan.subjectId)?.name ?? plan.subjectId;
  const teacher = lookups.teacherById.get(plan.teacherId)?.name ?? '未指定教师';

  return (
    <div className="plan-drawer-overlay" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <aside className="plan-drawer" role="dialog" aria-modal="true" aria-label="教学计划约束设置">
        <header className="plan-drawer-head">
          <div>
            <p className="plan-menu-kicker">// CONSTRAINTS / 约束</p>
            <h3>{klass} / {subject}</h3>
            <p className="plan-drawer-meta">{teacher} <span>│</span> {plan.weeklyPeriods} 节/周 <span>│</span> {plan.weeks === 'odd' ? '单周' : plan.weeks === 'even' ? '双周' : '每周'}</p>
          </div>
          <button type="button" className="plan-drawer-close" onClick={close} aria-label="关闭">×</button>
        </header>
        <div className="plan-drawer-body">
          <section className="plan-drawer-section">
            <p className="plan-menu-kicker">// TIME / 时间</p>
            <label className="plan-drawer-field">
              <span>周次</span>
              <select value={draft.weeks} onChange={(event) => setDraft({ ...draft, weeks: event.target.value as WeekType })}>
                {WEEK_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <div className="plan-drawer-field">
              <span>固定时间</span>
              <div className="plan-drawer-fixed">
                <span>{fixedLabels.length ? fixedLabels.join(' / ') : '不固定，由求解器安排'}</span>
                <button type="button" className="ghost-button" onClick={onOpenFixed}>编辑固定时间</button>
              </div>
            </div>
            <label className="plan-drawer-field">
              <span>连堂节数</span>
              <input
                type="number"
                min={0}
                max={4}
                value={draft.consecutive}
                onChange={(event) => setDraft({ ...draft, consecutive: Number(event.target.value) || 0 })}
              />
              <small>0 = 不连堂；2–4 = 连续几节一起排。</small>
            </label>
            <label className="plan-drawer-field">
              <span>课程类型</span>
              <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as SlotKind })}>
                {KIND_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
          </section>
          <section className="plan-drawer-section">
            <p className="plan-menu-kicker">// PAIRING / 配对</p>
            <label className="plan-drawer-field">
              <span>配对组</span>
              <input
                value={draft.pairId}
                onChange={(event) => setDraft({ ...draft, pairId: event.target.value })}
                placeholder="如 语数间周"
              />
              <small>单周与双周计划填同一个配对组后，必须排在同一时间格。</small>
            </label>
            <label className="plan-drawer-field">
              <span>教室类型</span>
              <input
                list="plan-drawer-room-types"
                value={draft.roomType}
                onChange={(event) => setDraft({ ...draft, roomType: event.target.value })}
                placeholder="不限"
              />
              <datalist id="plan-drawer-room-types">
                {roomTypes.map((type) => <option key={type} value={type} />)}
              </datalist>
            </label>
          </section>
          {error ? <p className="plan-drawer-error" role="alert">{error}</p> : null}
          <p className="plan-drawer-note">这些字段默认收在「约束」列里；修改会清空候选课表。</p>
        </div>
        <footer className="plan-drawer-actions">
          <button
            type="button"
            className="danger-link"
            onClick={() => {
              if (!window.confirm('删除这条教学计划？相关候选课表会被清空。')) return;
              if (onDelete()) onClose();
            }}
          >
            删除计划
          </button>
          <div>
            <button type="button" className="ghost-button" onClick={close}>取消</button>
            <button type="button" className="mini-button" onClick={save}>保存约束</button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

export { PlanDetailDrawer };
