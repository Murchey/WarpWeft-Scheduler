import { useMemo, useState } from 'react';
import { exportCsv, exportWorkbook } from '../../../packages/import-export/src';
import {
  ADJUSTMENT_LABELS,
  activeAdjustments,
  describeAdjustment,
  effectiveEntries,
  substituteCandidates,
  summarizeAdjustments,
  validateAdjustment,
  weekdayOf,
} from '../../../packages/adjustments/src';
import type { Adjustment, AdjustmentDraft, AdjustmentEntry, AdjustmentType } from '../../../packages/adjustments/src';
import type { Commit, ScheduleEntry, SchoolData } from './types';
import { EmptyState } from './runViews';
import { SectionHeading } from './components';
import { download, exportMessage } from './download';
import { LessonLogPanel } from './LessonLogPanel';
import { messageOf, todayLocal, uid } from './utils';
import { findRoom, findTeacher, planOf, planSubjectName } from './selectors';

const DAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const TYPES: AdjustmentType[] = ['move', 'substitute', 'cancel'];

function weekLabelOf(date: string): string {
  const day = weekdayOf(date);
  return day ? DAY_NAMES[day] : '';
}

function timeText(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function AdjustmentsPage({
  data,
  commit,
  setError,
  setNotice,
}: {
  data: SchoolData;
  commit: Commit;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
}) {
  const [date, setDate] = useState(() => new URLSearchParams(window.location.search).get('date') || todayLocal());
  const [operator, setOperator] = useState(() => window.localStorage.getItem('warpweft-operator') || '本机管理员');
  const [selectedEntryId, setSelectedEntryId] = useState('');
  const [draftType, setDraftType] = useState<AdjustmentType>('move');
  const [targetSlotId, setTargetSlotId] = useState('');
  const [substituteTeacherId, setSubstituteTeacherId] = useState('');
  const [reason, setReason] = useState('');
  const [dragEntryId, setDragEntryId] = useState('');
  const [dropCell, setDropCell] = useState('');

  const result = data.candidate ?? data.published ?? null;
  const adjustments = data.adjustments ?? [];
  const weekday = weekdayOf(date);
  const daySlots = useMemo(
    () => data.timeSlots.filter((slot) => slot.day === weekday).slice().sort((a, b) => a.period - b.period),
    [data.timeSlots, weekday],
  );
  const effective = useMemo<AdjustmentEntry[]>(
    () => (result ? effectiveEntries({ ...data, entries: result.entries as AdjustmentEntry[] }, date, adjustments) : []),
    [data, date, adjustments, result],
  );
  const baseOf = (entryId: string) => (result?.entries ?? []).find((entry) => entry.id === entryId);
  const selected = selectedEntryId ? baseOf(selectedEntryId) : undefined;
  const selectedPlan = selected ? planOf(data, selected) : undefined;
  const selectedAdjustment = useMemo(
    () => activeAdjustments(adjustments, date).find((item) => item.originalEntryId === selectedEntryId),
    [adjustments, date, selectedEntryId],
  );
  const hasCandidate = Boolean(result && result.entries.length > 0);
  const dragEntry = dragEntryId ? (result?.entries ?? []).find((entry) => entry.id === dragEntryId) : undefined;
  const dropValidation = (entryId: string, slotId: string) => {
    if (!result) return { ok: false, errors: ['没有候选课表'] };
    return validateAdjustment(
      { ...data, entries: result.entries as AdjustmentEntry[] },
      { date, type: 'move', originalEntryId: entryId, targetSlotId: slotId, reason, createdBy: operator },
      adjustments,
    );
  };
  const freeSlots = result && selected
    ? daySlots.filter((slot) => slot.id !== selected.slotId && dropValidation(selected.id, slot.id).ok)
    : [];

  const draft: AdjustmentDraft | null = selected
    ? {
        date,
        type: draftType,
        originalEntryId: selected.id,
        targetSlotId: draftType === 'move' ? targetSlotId : undefined,
        substituteTeacherId: draftType === 'substitute' ? substituteTeacherId : undefined,
        reason,
        createdBy: operator,
      }
    : null;
  const validation = useMemo(() => {
    if (!draft || !result) return { ok: false, errors: [] as string[] };
    return validateAdjustment({ ...data, entries: result.entries as AdjustmentEntry[] }, draft, adjustments);
  }, [adjustments, data, draft, result]);

  const candidates = useMemo(
    () => (result && selected ? substituteCandidates({ ...data, entries: result.entries as AdjustmentEntry[] }, date, selected.id, adjustments) : []),
    [adjustments, data, date, result, selected],
  );

  const dayAdjustments = adjustments.filter((item) => item.date === date);
  const summary = summarizeAdjustments(dayAdjustments);

  const selectEntry = (entryId: string) => {
    setSelectedEntryId(entryId);
    setDraftType('move');
    setTargetSlotId('');
    setSubstituteTeacherId('');
    setReason('');
  };

  const persistOperator = (value: string) => {
    setOperator(value);
    try {
      window.localStorage.setItem('warpweft-operator', value);
    } catch {
      // ignore
    }
  };

  const save = () => {
    if (!result || !selected || !draft) return;
    if (!validation.ok) {
      setError('调整未通过校验：\n' + validation.errors.join('\n'));
      return;
    }
    const createdAt = new Date().toISOString();
    const adjustment: Adjustment = {
      id: uid('adjust'),
      date,
      type: draftType,
      slotId: selected.slotId,
      classId: selected.classId,
      originalEntryId: selected.id,
      targetSlotId: draftType === 'move' ? targetSlotId : undefined,
      substituteTeacherId: draftType === 'substitute' ? substituteTeacherId : undefined,
      reason: reason.trim() || undefined,
      createdBy: operator.trim() || undefined,
      createdAt,
      status: 'active',
    };
    const detail = describeAdjustment(adjustment, data) + (adjustment.reason ? ' · ' + adjustment.reason : '') + ' · 操作人 ' + (adjustment.createdBy ?? '未填写');
    commit(
      {
        ...data,
        adjustments: [...adjustments, adjustment],
        auditLog: [...(data.auditLog ?? []), { id: uid('audit'), at: createdAt, action: 'ADJUSTMENT', detail }],
      },
      { immediate: true },
    );
    setSelectedEntryId('');
    setReason('');
    setNotice('已记录：' + detail);
  };

  const dropMove = (entryId: string, targetSlot: string) => {
    if (!result) return;
    const entry = baseOf(entryId);
    if (!entry) return;
    const check = dropValidation(entryId, targetSlot);
    if (!check.ok) {
      setError('不能移动到这里：' + check.errors.join('；'));
      return;
    }
    const createdAt = new Date().toISOString();
    const adjustment: Adjustment = {
      id: uid('adjust'),
      date,
      type: 'move',
      slotId: entry.slotId,
      classId: entry.classId,
      originalEntryId: entry.id,
      targetSlotId: targetSlot,
      createdBy: operator.trim() || undefined,
      createdAt,
      status: 'active',
    };
    const detail = describeAdjustment(adjustment, data) + ' · 操作人 ' + (adjustment.createdBy ?? '未填写');
    commit(
      {
        ...data,
        adjustments: [...adjustments, adjustment],
        auditLog: [...(data.auditLog ?? []), { id: uid('audit'), at: createdAt, action: 'ADJUSTMENT', detail }],
      },
      { immediate: true },
    );
    setSelectedEntryId('');
    setDragEntryId('');
    setDropCell('');
    setNotice('已记录：' + detail);
  };
  const revoke = (adjustment: Adjustment) => {
    if (!window.confirm('撤销这条调整？撤销记录会保留在审计里。')) return;
    const at = new Date().toISOString();
    const detail = describeAdjustment(adjustment, data) + ' · 撤销 · 操作人 ' + (operator.trim() || '未填写');
    commit(
      {
        ...data,
        adjustments: adjustments.map((item) =>
          item.id === adjustment.id ? { ...item, status: 'revoked', revokedAt: at, revokedBy: operator.trim() || undefined } : item,
        ),
        auditLog: [...(data.auditLog ?? []), { id: uid('audit'), at, action: 'ADJUSTMENT_REVOKE', detail }],
      },
      { immediate: true },
    );
    setNotice('已撤销一条调整');
  };

  const exportNotice = async () => {
    try {
      const active = dayAdjustments.filter((item) => item.status === 'active');
      const rows = active.map((item) => {
        const base = result?.entries.find((entry) => entry.id === item.originalEntryId);
        const plan = base ? planOf(data, base) : undefined;
        const originalSlot = data.timeSlots.find((slot) => slot.id === item.slotId)?.label ?? item.slotId;
        const targetSlot = item.targetSlotId ? data.timeSlots.find((slot) => slot.id === item.targetSlotId)?.label ?? item.targetSlotId : '';
        return {
          日期: item.date,
          星期: weekLabelOf(item.date),
          调整类型: ADJUSTMENT_LABELS[item.type],
          原时间: originalSlot,
          调整后时间: item.targetSlotId ? targetSlot : originalSlot,
          班级: data.classes.find((klass) => klass.id === item.classId)?.name ?? item.classId,
          学科: plan ? planSubjectName(data, plan) : '',
          原任课教师: base ? findTeacher(data, base.teacherId)?.name ?? base.teacherId : '',
          代课教师: item.substituteTeacherId ? findTeacher(data, item.substituteTeacherId)?.name ?? item.substituteTeacherId : '',
          原因: item.reason ?? '',
          操作人: item.createdBy ?? '',
        };
      });
      const bytes = exportWorkbook({
        代课通知单: rows,
        汇总: [
          { 项目: '学校', 值: data.school.name },
          { 项目: '日期', 值: date + ' ' + weekLabelOf(date) },
          { 项目: '调整条数', 值: active.length },
          { 项目: '操作人', 值: operator },
          { 项目: '导出时间', 值: new Date().toLocaleString('zh-CN') },
        ],
      });
      const exported = await download(
        bytes,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'warpweft-notice-' + date + '.xlsx',
      );
      const message = exportMessage(exported, '代课通知单');
      if (!message) return;
      if (message.tone === 'error') setError(message.text);
      else setNotice(message.text);
    } catch (cause) {
      setError('导出通知单失败：' + messageOf(cause));
    }
  };

  const exportDay = async () => {
    try {
      const rows = dayAdjustments.map((item) => ({
        日期: item.date,
        类型: ADJUSTMENT_LABELS[item.type],
        班级: data.classes.find((klass) => klass.id === item.classId)?.name ?? item.classId,
        原时间: data.timeSlots.find((slot) => slot.id === item.slotId)?.label ?? item.slotId,
        目标时间: item.targetSlotId ? data.timeSlots.find((slot) => slot.id === item.targetSlotId)?.label ?? item.targetSlotId : '',
        代课教师: item.substituteTeacherId ? findTeacher(data, item.substituteTeacherId)?.name ?? item.substituteTeacherId : '',
        原因: item.reason ?? '',
        操作人: item.createdBy ?? '',
        状态: item.status === 'active' ? '生效' : '已撤销',
        记录时间: item.createdAt,
      }));
      const csv = exportCsv(rows);
      const exported = await download(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), 'text/csv', 'warpweft-adjustments-' + date + '.csv');
      const message = exportMessage(exported, '调整清单');
      if (!message) return;
      if (message.tone === 'error') setError(message.text);
      else setNotice(message.text);
    } catch (cause) {
      setError('导出调整清单失败：' + messageOf(cause));
    }
  };

  if (!hasCandidate) {
    return (
      <EmptyState
        title="还没有可调整的课表"
        message="先运行一次自动排课或载入长时任务的最佳解；调代课会叠加在这张周课表的某一天上。"
      />
    );
  }

  return (
    <div className="adjust-layout">
      <section className="section-panel adjust-head">
        <div className="panel-head">
          <div>
            <SectionHeading english="TEMPORARY ADJUSTMENTS" title="临时调代课" />
            <p className="panel-note">
              调整只作用于所选日期，不改动周课表。保存前会校验班级、教师、教室冲突和教师不可用时间；撤销会保留审计记录。
            </p>
          </div>
          <span className={'status-tag ' + (summary.total ? '' : 'muted')}>{summary.total ? dayAdjustments.length + ' 条记录' : '当天无调整'}</span>
        </div>
        <div className="adjust-controls">
          <label>
            日期
            <input type="date" value={date} onChange={(event) => { setDate(event.target.value); setSelectedEntryId(''); }} />
          </label>
          <label>
            操作人
            <input value={operator} onChange={(event) => persistOperator(event.target.value)} placeholder="记录到审计日志" />
          </label>
          <span className="adjust-day">{weekday ? DAY_NAMES[weekday] : '无效日期'} · {daySlots.length} 个时间格</span>
          <div className="adjust-controls-spacer" />
          <button className="ghost-button" onClick={() => void exportDay()} disabled={dayAdjustments.length === 0}>
            导出当天调整
          </button>
          <button className="ghost-button" onClick={() => void exportNotice()} disabled={dayAdjustments.filter((item) => item.status === 'active').length === 0}>
            导出代课通知单
          </button>
        </div>
        <div className="adjust-summary">
          <span>调课 <b>{summary.move}</b></span>
          <span>代课 <b>{summary.substitute}</b></span>
          <span>停课 <b>{summary.cancel}</b></span>
          <span>已撤销 <b>{summary.revoked}</b></span>
          {Object.entries(summary.substituteByTeacher).map(([teacherId, count]) => (
            <span key={teacherId} className="adjust-substitute">
              {findTeacher(data, teacherId)?.name ?? teacherId} 代课 <b>{count}</b> 节
            </span>
          ))}
        </div>
      </section>

      <div className="adjust-grid">
        <section className="section-panel adjust-board">
          <div className="panel-head">
            <SectionHeading english="DAY TIMETABLE" title={date + ' ' + (weekday ? DAY_NAMES[weekday] : '')} />
            <span className="panel-note">
              点击课程查看并调整；带角标的课程当天已有调整。
              {data.coursePlans.some((plan) => (plan.weeks ?? 'all') !== 'all')
                ? ' 未设置学期起始周，单双周课程会同时显示。'
                : ''}
            </span>
          </div>
          <div className="table-scroll adjust-board-scroll">
            <table className="data-table adjust-table">
              <thead>
                <tr>
                  <th className="adjust-period-head">节次</th>
                  {data.classes.map((klass) => (
                    <th key={klass.id}>{klass.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {daySlots.length === 0 ? (
                  <tr>
                    <td className="table-empty" colSpan={data.classes.length + 1}>
                      这一天没有时间段。
                    </td>
                  </tr>
                ) : (
                  daySlots.map((slot) => (
                    <tr key={slot.id}>
                      <th className="adjust-period-cell">第{slot.period}节</th>
                      {data.classes.map((klass) => {
                        const slotEntries = effective.filter((entry) => entry.slotId === slot.id && entry.classId === klass.id);
                        const cellKey = slot.id + '|' + klass.id;
                        const dropHere = dragEntry && dragEntry.classId === klass.id && dragEntry.slotId !== slot.id
                          ? dropValidation(dragEntry.id, slot.id)
                          : null;
                        return (
                          <td
                            key={klass.id}
                            className={
                              (slotEntries.length ? ' is-filled' : '') +
                              (dropCell === cellKey && dropHere ? (dropHere.ok ? ' is-drop-ok' : ' is-drop-bad') : '')
                            }
                            onDragOver={(event) => {
                              if (!dragEntry || dragEntry.classId !== klass.id) return;
                              event.preventDefault();
                              setDropCell(cellKey);
                            }}
                            onDragLeave={() => setDropCell('')}
                            onDrop={(event) => {
                              event.preventDefault();
                              const entryId = event.dataTransfer.getData('text/plain') || dragEntryId;
                              if (!entryId) return;
                              const entry = baseOf(entryId);
                              if (!entry || entry.classId !== klass.id) return;
                              dropMove(entryId, slot.id);
                            }}
                          >
                            {slotEntries.length === 0 ? (
                              <span className="adjust-empty">·</span>
                            ) : (
                              slotEntries.map((entry) => {
                                const base = baseOf(entry.id);
                                const plan = base ? planOf(data, base) : undefined;
                                const adjustment = activeAdjustments(adjustments, date).find((item) => item.originalEntryId === entry.id);
                                return (
                                  <button
                                    key={entry.id}
                                    type="button"
                                    className={
                                      'adjust-card' +
                                      (entry.id === selectedEntryId ? ' is-selected' : '') +
                                      (adjustment ? ' is-adjusted' : '')
                                    }
                                    onClick={() => selectEntry(entry.id)}
                                    draggable={Boolean(base)}
                                    onDragStart={(event) => {
                                      if (!base) return;
                                      event.dataTransfer.effectAllowed = 'move';
                                      event.dataTransfer.setData('text/plain', entry.id);
                                      setDragEntryId(entry.id);
                                      selectEntry(entry.id);
                                    }}
                                    onDragEnd={() => {
                                      setDragEntryId('');
                                      setDropCell('');
                                    }}
                                    title={adjustment ? describeAdjustment(adjustment, data) : '点击调整或拖动到同班其它节次'}
                                  >
                                    <b>{planSubjectName(data, plan)}</b>
                                    <small>{findTeacher(data, entry.teacherId)?.name ?? entry.teacherId} · {findRoom(data, entry.roomId)?.name ?? entry.roomId}</small>
                                    {adjustment ? <em>{ADJUSTMENT_LABELS[adjustment.type]}</em> : null}
                                  </button>
                                );
                              })
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="section-panel adjust-editor">
          <div className="panel-head">
            <SectionHeading english="NEW ADJUSTMENT" title="新增调整" />
          </div>
          {!selected ? (
            <p className="panel-note">先在左侧选择一节课程。</p>
          ) : (
            <>
              <div className="adjust-selected">
                <span className="kicker">SELECTED LESSON</span>
                <b>{planSubjectName(data, selectedPlan)}</b>
                <small>
                  {data.classes.find((klass) => klass.id === selected.classId)?.name} ·{' '}
                  {findTeacher(data, selected.teacherId)?.name} ·{' '}
                  {data.timeSlots.find((slot) => slot.id === selected.slotId)?.label}
                </small>
              </div>
              {selectedAdjustment ? (
                <div className="inline-warning">
                  <b>这节课程当天已有{ADJUSTMENT_LABELS[selectedAdjustment.type]}</b>
                  <div>{describeAdjustment(selectedAdjustment, data)}</div>
                  <button className="ghost-button" onClick={() => revoke(selectedAdjustment)}>撤销这条调整</button>
                </div>
              ) : (
                <>
                  <div className="adjust-types" role="tablist" aria-label="调整类型">
                    {TYPES.map((value) => (
                      <button
                        key={value}
                        type="button"
                        role="tab"
                        aria-selected={draftType === value}
                        className={draftType === value ? 'active' : ''}
                        onClick={() => { setDraftType(value); setTargetSlotId(''); setSubstituteTeacherId(''); }}
                      >
                        {ADJUSTMENT_LABELS[value]}
                      </button>
                    ))}
                  </div>
                  {draftType === 'move' ? (
                    <>
                      <label className="adjust-field">
                        调到
                        <select value={targetSlotId} onChange={(event) => setTargetSlotId(event.target.value)}>
                          <option value="">选择目标时间</option>
                          {daySlots.filter((slot) => slot.id !== selected.slotId).map((slot) => (
                            <option key={slot.id} value={slot.id}>{slot.label}</option>
                          ))}
                        </select>
                      </label>
                      <div className="adjust-free">
                        <span>当天空闲时段（{freeSlots.length}）</span>
                        {freeSlots.length === 0 ? (
                          <small>没有可移动的空闲时段，可直接拖到左侧课表试试。</small>
                        ) : (
                          <div className="adjust-free-list">
                            {freeSlots.map((slot) => (
                              <button
                                key={slot.id}
                                type="button"
                                className={targetSlotId === slot.id ? 'active' : ''}
                                onClick={() => setTargetSlotId(slot.id)}
                              >
                                {slot.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  ) : null}
                  {draftType === 'substitute' ? (
                    <label className="adjust-field">
                      代课教师
                      <select value={substituteTeacherId} onChange={(event) => setSubstituteTeacherId(event.target.value)}>
                        <option value="">选择代课教师</option>
                        {candidates.map((item) => (
                          <option key={item.id} value={item.id} disabled={item.unavailable}>
                            {item.name}{item.unavailable ? '（该时段无空）' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {draftType === 'cancel' ? (
                    <p className="panel-note">停课后这节课程当天不再出现在课表里，周课表不受影响。</p>
                  ) : null}
                  <label className="adjust-field">
                    原因
                    <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="如：教师出差、临时会议（可留空）" />
                  </label>
                  {validation.errors.length > 0 ? (
                    <ul className="adjust-errors">
                      {validation.errors.map((error) => <li key={error}>{error}</li>)}
                    </ul>
                  ) : draft ? (
                    <p className="panel-note success-note">校验通过，可以保存。</p>
                  ) : null}
                  <div className="adjust-actions">
                    <button className="action-button" onClick={save} disabled={!validation.ok}>
                      保存{ADJUSTMENT_LABELS[draftType]} <span>→</span>
                    </button>
                    <button className="ghost-button" onClick={() => setSelectedEntryId('')}>取消</button>
                  </div>
                </>
              )}
            </>
          )}
        </aside>
      </div>

      <section className="section-panel">
        <div className="panel-head">
          <SectionHeading english="HISTORY" title="当天调整记录" />
          <span className="panel-note">撤销保留历史，审计日志里可以查到操作人和前后值。</span>
        </div>
        {dayAdjustments.length === 0 ? (
          <p className="panel-note">这一天还没有调整记录。</p>
        ) : (
          <ul className="adjust-list">
            {dayAdjustments.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((item) => {
              const orphaned = !baseOf(item.originalEntryId);
              return (
                <li key={item.id} className={'adjust-row is-' + item.status + (orphaned ? ' is-orphaned' : '')}>
                  <span className={'adjust-type is-' + item.type}>{ADJUSTMENT_LABELS[item.type]}</span>
                  <div className="adjust-row-copy">
                    <b>{describeAdjustment(item, data)}</b>
                    <small>
                      {item.reason ? item.reason + ' · ' : ''}
                      {item.createdBy ?? '未记录操作人'} · {timeText(item.createdAt)}
                      {orphaned ? ' · 课表已重排，原课次不存在' : ''}
                      {item.status === 'revoked' ? ' · 已撤销 ' + timeText(item.revokedAt) + (item.revokedBy ? '（' + item.revokedBy + '）' : '') : ''}
                    </small>
                  </div>
                  {item.status === 'active' ? (
                    <button className="ghost-button adjust-revoke" onClick={() => revoke(item)}>撤销</button>
                  ) : (
                    <span className="status-tag muted">已撤销</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <LessonLogPanel
        data={data}
        commit={commit}
        date={date}
        operator={operator}
        setError={setError}
        setNotice={setNotice}
      />
    </div>
  );
}








