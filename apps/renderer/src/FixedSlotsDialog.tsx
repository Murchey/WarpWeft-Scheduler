import React, { useEffect, useMemo } from 'react';
import type { TimeSlot } from './types';

const DAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function FixedSlotsDialog({
  title,
  slots,
  value,
  max,
  onChange,
  onClose,
}: {
  title: string;
  slots: TimeSlot[];
  value: string[];
  max: number;
  onChange: (slotIds: string[]) => void;
  onClose: () => void;
}) {
  const groups = useMemo(() => {
    const byDay = new Map<number, TimeSlot[]>();
    for (const slot of slots) {
      const list = byDay.get(slot.day) ?? [];
      list.push(slot);
      byDay.set(slot.day, list);
    }
    return [...byDay.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([day, list]) => ({ day, slots: [...list].sort((a, b) => a.period - b.period) }));
  }, [slots]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  const selected = new Set(value);
  const limit = Math.max(0, max);
  const toggle = (slotId: string) => {
    if (selected.has(slotId)) {
      onChange(value.filter((id) => id !== slotId));
      return;
    }
    if (selected.size >= limit) return;
    onChange([...value, slotId]);
  };
  const labelOf = (slotId: string) => slots.find((slot) => slot.id === slotId)?.label ?? slotId;
  return (
    <div className="rule-overlay fixed-slots-overlay" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="rule-dialog fixed-slots-dialog">
        <div className="rule-dialog-head">
          <div>
            
            <h2>{title}</h2>
            <p>按顺序固定第 1、2…节课的位置。例如只固定 1 节，就只勾一个时段；连堂就勾相邻两节。</p>
          </div>
          <button type="button" className="banner-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="rule-dialog-body">
          <div className="fixed-slots-meta">
            <span>已选 <b>{selected.size}</b> / 最多 <b>{limit}</b> 节</span>
            <button type="button" className="ghost-button" onClick={() => onChange([])} disabled={selected.size === 0}>清空</button>
          </div>
          <div className="fixed-slots-days">
            {groups.map((group) => (
              <div className="fixed-slots-day" key={group.day}>
                <b>{DAY_NAMES[group.day] ?? '第' + group.day + '天'}</b>
                <div className="fixed-slots-options">
                  {group.slots.map((slot) => {
                    const checked = selected.has(slot.id);
                    return (
                      <label key={slot.id} className={checked ? 'fixed-slot-option is-checked' : 'fixed-slot-option'}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(slot.id)}
                          disabled={!checked && selected.size >= limit}
                        />
                        <span>{slot.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <p className="panel-note">
            {value.length > 0 ? '将按勾选顺序固定：' + value.map((id) => labelOf(id)).join(' → ') : '当前不固定，由求解器自行安排。'}
          </p>
        </div>
        <div className="rule-dialog-actions">
          <button type="button" className="ghost-button" onClick={onClose}>取消</button>
          <button type="button" className="action-button" onClick={onClose}>完成</button>
        </div>
      </div>
    </div>
  );
}

export { FixedSlotsDialog };
