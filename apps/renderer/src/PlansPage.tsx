import React, { useMemo, useState } from 'react';
import type { Commit, CoursePlan, SchoolData, SlotKind } from './types';
import { SectionHeading } from './components';
import type { Column } from './components';
import { ResourceWorkspace } from './ResourceWorkspace';
import { PlanComposer } from './PlanComposer';
import { GradePlanComposer } from './GradePlanComposer';
import { FixedSlotsDialog } from './FixedSlotsDialog';
import { uid } from './utils';
import { fixedSlotIdsOf } from '../../../packages/contracts/src';
import { useColumnWidths, usePanelResize } from './resizableTable';

const PLAN_PREVIEW = 8;

/** Header labels double as the table's column list for drag-to-resize. */
const PLAN_TABLE_HEADERS = [
  '班级',
  '学科',
  '教师（选填）',
  '每周课时',
  '周次（选填）',
  '课程类型（选填）',
  '教室类型（选填）',
  '固定时间（选填）',
  '连堂（选填）',
  '配对组（选填）',
  '操作',
];
const PLAN_COLUMN_MIN_WIDTHS = [112, 90, 108, 76, 86, 104, 104, 144, 64, 96, 66];
const PLAN_COLUMN_WIDTH_KEY = 'warpweft.plans.columnWidths.v1';
const PLAN_PANEL_SIZE_KEY = 'warpweft.plans.panelSize.v1';

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

function PlansPage({
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
  const roomTypes = Array.from(new Set(data.rooms.map((room) => room.type).filter(Boolean)));
  const [composerOpen, setComposerOpen] = useState(false);
  const [gradeComposerOpen, setGradeComposerOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [fixedEditor, setFixedEditor] = useState<string | null>(null);
  const columnLayout = useColumnWidths(PLAN_TABLE_HEADERS.length, PLAN_COLUMN_WIDTH_KEY, PLAN_COLUMN_MIN_WIDTHS);
  const panelLayout = usePanelResize(PLAN_PANEL_SIZE_KEY, { minWidth: 640, minHeight: 300 });
  const layoutCustomised = Boolean(columnLayout.widths || panelLayout.size);
  const resetLayout = () => {
    columnLayout.reset();
    panelLayout.reset();
  };
  const total = data.coursePlans.reduce((sum, plan) => sum + Number(plan.weeklyPeriods || 0), 0);
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
      note: classes.length + ' 个班 · 每班平均',
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
  const update = (id: string, patch: Partial<CoursePlan>) => {
    const plans = data.coursePlans.map((plan) => (plan.id === id ? { ...plan, ...patch } : plan));
    commit({ ...data, coursePlans: plans }, { invalidate: true });
  };
  const remove = (id: string) => {
    if (!window.confirm('删除这条教学计划？相关候选课表会被清空。')) return;
    commit({ ...data, coursePlans: data.coursePlans.filter((plan) => plan.id !== id) }, { invalidate: true });
  };
  const removeMany = (ids: string[]) => {
    const selected = new Set(ids);
    commit({ ...data, coursePlans: data.coursePlans.filter((plan) => !selected.has(plan.id)) }, { invalidate: true, immediate: true });
  };
  const batchEdit = (ids: string[], key: string, value: string | number) => {
    const selected = new Set(ids);
    const plans = data.coursePlans.map((plan) =>
      selected.has(plan.id) ? ({ ...plan, [key]: value } as CoursePlan) : plan,
    );
    commit({ ...data, coursePlans: plans }, { invalidate: true, immediate: true });
  };
  const slotLabel = (slotId: string) => data.timeSlots.find((slot) => slot.id === slotId)?.label ?? slotId;
  const planFixedText = (plan: CoursePlan) => {
    const ids = fixedSlotIdsOf(plan);
    return ids.length ? ids.map(slotLabel).join('；') : '';
  };
  const saveFixedSlots = (slotIds: string[]) => {
    if (!fixedEditor) return;
    const plans = data.coursePlans.map((plan) => {
      if (plan.id !== fixedEditor) return plan;
      const { fixedSlotId: _legacy, fixedSlotIds: _legacyIds, ...rest } = plan;
      return slotIds.length ? { ...rest, fixedSlotIds: slotIds } : rest;
    });
    commit({ ...data, coursePlans: plans }, { invalidate: true, immediate: true });
  };
  const planColumns: Column<CoursePlan>[] = [
    { key: 'classId', label: '班级', type: 'select', options: data.classes.map((item) => ({ value: item.id, label: item.name })) },
    { key: 'subjectId', label: '学科', type: 'select', options: data.subjects.map((item) => ({ value: item.id, label: item.name })) },
    { key: 'teacherId', label: '教师（选填）', type: 'select', options: [{ value: '', label: '未指定' }, ...data.teachers.map((item) => ({ value: item.id, label: item.name }))] },
    { key: 'weeklyPeriods', label: '每周课时', type: 'number', width: '10%' },
    {
      key: 'weeks',
      label: '周次（选填）',
      type: 'select',
      width: '10%',
      defaultValue: 'all',
      options: [
        { value: 'all', label: '每周' },
        { value: 'odd', label: '单周' },
        { value: 'even', label: '双周' },
      ],
    },
    {
      key: 'kind',
      label: '课程类型（选填）',
      type: 'select',
      width: '12%',
      defaultValue: 'regular',
      options: [
        { value: 'regular', label: '常规' },
        { value: 'morning', label: '早读' },
        { value: 'study', label: '自习' },
        { value: 'aftercare', label: '课后服务' },
        { value: 'evening', label: '晚自习' },
        { value: 'makeup', label: '补课' },
      ],
    },
    { key: 'roomType', label: '教室类型（选填）', width: '12%' },
    { key: 'fixedSlotIds', label: '固定时间（选填）', type: 'fixedSlots', width: '16%' },
    { key: 'consecutive', label: '连堂（选填）', type: 'number', width: '8%' },
    { key: 'pairId', label: '配对组（选填）', width: '12%' },
  ];
  const editingPlan = fixedEditor ? data.coursePlans.find((plan) => plan.id === fixedEditor) : undefined;
  const planLabel = (plan: CoursePlan) => {
    const klass = data.classes.find((item) => item.id === plan.classId)?.name ?? '';
    const subject = data.subjects.find((item) => item.id === plan.subjectId)?.name ?? '';
    const teacher = data.teachers.find((item) => item.id === plan.teacherId)?.name ?? '';
    return [klass, subject, teacher, plan.roomType ?? ''].join(' ');
  };
  return (
    <section
      ref={panelLayout.panelRef}
      className={'section-panel table-panel plan-panel' + (panelLayout.size ? ' is-sized' : '')}
      style={panelLayout.style}
    >
      <div className="plan-panel-body">
      <div className="panel-head">
        <SectionHeading english="COURSE PLAN REGISTER" title="教学计划明细" />
        <div className="panel-head-actions">
          {layoutCustomised ? (
            <button className="ghost-button" type="button" onClick={resetLayout} title="恢复默认列宽和面板大小">
              重置布局
            </button>
          ) : null}
          <button className="ghost-button" onClick={() => setWorkspaceOpen(true)}>
            查看全部（{data.coursePlans.length}）
          </button>
          <button className="mini-button" onClick={() => { if (!data.classes.length) { setError('请先添加至少一个班级'); return; } setError(''); setGradeComposerOpen(true); }}>
            按年级批量设置
          </button>
          <button className="mini-button" onClick={() => { if (!data.classes.length) { setError('请先添加至少一个班级'); return; } setError(''); setComposerOpen(true); }}>
            + 批量新增
          </button>
        </div>
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
      <div className="plan-matrix-panel">
        <div className="plan-matrix-head">
          <div>
            <h3>各学科课时汇总</h3>
            <p className="panel-note">把教学计划理解为“某班/某年级在一段时间内各学科的上课节数”。</p>
          </div>
          <div className="plan-matrix-controls">
            <div className="segmented">
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
        <div className="table-scroll">
          <table className="data-table plan-matrix-table">
            <thead>
              <tr>
                <th>{matrixMode === 'class' ? '班级' : '年级'}</th>
                {matrix.subjects.map((subject) => <th key={subject.id}>{subject.name}</th>)}
                <th>合计</th>
              </tr>
            </thead>
            <tbody>
              {matrix.rows.length === 0 ? (
                <tr><td className="table-empty" colSpan={matrix.subjects.length + 2}>暂无班级数据。</td></tr>
              ) : matrix.rows.map((row) => (
                <tr key={row.key}>
                  <td>
                    <b>{row.label}</b>
                    <small className="plan-matrix-note">{row.note}</small>
                  </td>
                  {row.counts.map((count, index) => (
                    <td key={matrix.subjects[index].id} className={count === 0 ? 'is-zero' : ''}>
                      {count === 0 ? '—' : formatPeriods(count)}
                    </td>
                  ))}
                  <td><b>{formatPeriods(row.total)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="panel-note">
          数值为所选周期内的上课节数：每周计划按全部周计入，单周计划按奇数周、双周计划按偶数周折算；按年级查看时显示每班平均。
        </p>
      </div>
      <div className="table-scroll">
        <table className="data-table plan-table" style={columnLayout.tableStyle}>
          {columnLayout.widths ? (
            <colgroup>
              {columnLayout.widths.map((width, index) => (
                <col key={index} style={{ width }} />
              ))}
            </colgroup>
          ) : null}
          <thead>
            <tr>
              {PLAN_TABLE_HEADERS.map((label, index) => (
                <th key={label} className={index === PLAN_TABLE_HEADERS.length - 1 ? 'action-column' : undefined}>
                  <span className="plan-th-label">{label}</span>
                  <span
                    className="col-resizer"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={'调整「' + label.replace(/（选填）/g, '') + '」列宽'}
                    title="拖动调整列宽"
                    onPointerDown={columnLayout.start(index)}
                    onPointerMove={columnLayout.move}
                    onPointerUp={columnLayout.end}
                    onPointerCancel={columnLayout.end}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.coursePlans.length === 0 ? (
              <tr>
                <td className="table-empty" colSpan={11}>
                  暂无教学计划，先新增一条。
                </td>
              </tr>
            ) : (
              data.coursePlans.slice(0, PLAN_PREVIEW).map((plan) => (
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
                    <select value={plan.teacherId ?? ''} onChange={(event) => update(plan.id, { teacherId: event.target.value })}>
                      <option value="">未指定</option>
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
                    <select value={plan.kind ?? 'regular'} onChange={(event) => update(plan.id, { kind: event.target.value as SlotKind })} title="自习/课后服务可排入常规时段；早读/晚自习/补课只排进对应类型的时段">
                      <option value="regular">常规</option>
                      <option value="morning">早读</option>
                      <option value="study">自习</option>
                      <option value="aftercare">课后服务</option>
                      <option value="evening">晚自习</option>
                      <option value="makeup">补课</option>
                    </select>
                  </td>
                  <td>
                    <input list="plan-room-types" value={plan.roomType ?? ''} onChange={(event) => update(plan.id, { roomType: event.target.value })} placeholder="不限" />
                  </td>
                  <td>
                    <button type="button" className="classes-trigger" onClick={() => setFixedEditor(plan.id)} title="点击选择固定时间；可多选，按顺序固定每一节">
                      <span>{planFixedText(plan) || '不固定'}</span>
                      <em>编辑</em>
                    </button>
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={4}
                      value={plan.consecutive ?? 0}
                      onChange={(event) => update(plan.id, { consecutive: Number(event.target.value) || undefined })}
                      title="2–4 表示连续几节一起排；0 表示不连堂"
                    />
                  </td>
                  <td>
                    <input
                      value={plan.pairId ?? ''}
                      onChange={(event) => update(plan.id, { pairId: event.target.value || undefined })}
                      placeholder="如 语数间周"
                      title="单周/双周两条计划填同一个配对组，会排在同一时间格"
                    />
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
        固定时间会作为硬约束优先占用指定时间格，并按勾选顺序固定第 1、2…节；「连堂」2–4 表示连续几节一起排；「单周 / 双周」两条计划填同一个配对组，会排在同一时间格。修改教学计划会清空候选课表，避免旧课表与新计划混用。
        {data.coursePlans.length > PLAN_PREVIEW ? ' 当前只显示前 ' + PLAN_PREVIEW + ' 条，点击「查看全部」进入完整列表与批量操作。' : ''}
      </p>
      {workspaceOpen ? (
        <ResourceWorkspace<CoursePlan>
          title="教学计划"
          english="COURSE PLAN REGISTER"
          rows={data.coursePlans}
          columns={planColumns}
          batchFields={[
            { key: 'teacherId', label: '教师（选填）', type: 'select', options: [{ value: '', label: '未指定' }, ...data.teachers.map((item) => ({ value: item.id, label: item.name }))] },
            { key: 'weeklyPeriods', label: '每周课时', type: 'number', placeholder: '如 3' },
            {
              key: 'weeks',
              label: '周次（选填）',
              type: 'select',
              options: [
                { value: 'all', label: '每周' },
                { value: 'odd', label: '单周' },
                { value: 'even', label: '双周' },
              ],
            },
            {
              key: 'kind',
              label: '课程类型（选填）',
              type: 'select',
              options: [
                { value: 'regular', label: '常规' },
                { value: 'morning', label: '早读' },
                { value: 'study', label: '自习' },
                { value: 'aftercare', label: '课后服务' },
                { value: 'evening', label: '晚自习' },
                { value: 'makeup', label: '补课' },
              ],
            },
            { key: 'consecutive', label: '连堂节数（选填）', type: 'number', placeholder: '2–4' },
            { key: 'pairId', label: '配对组（选填）', type: 'text', placeholder: '如 语数间周' },
          ]}
          searchText={(plan) => planLabel(plan) + ' ' + (plan.pairId ?? '') + ' ' + planFixedText(plan)}
          onChange={(id, key, value) => update(id, { [key]: value } as Partial<CoursePlan>)}
          onBatchEdit={batchEdit}
          onRemoveMany={removeMany}
          onEditFixedSlots={(id) => setFixedEditor(id)}
          onClose={() => setWorkspaceOpen(false)}
          note="批量修改教师/每周课时/周次/时段类型会清空候选课表；固定时间按顺序固定每一节，连堂填 2–4，单双周配对填同一个配对组。"
        />
      ) : null}
      {fixedEditor && editingPlan ? (
        <FixedSlotsDialog
          title={'固定时间：' + planLabel(editingPlan)}
          slots={data.timeSlots}
          value={fixedSlotIdsOf(editingPlan)}
          max={Number(editingPlan.weeklyPeriods ?? 0)}
          onChange={saveFixedSlots}
          onClose={() => setFixedEditor(null)}
        />
      ) : null}
      {composerOpen ? <PlanComposer data={data} commit={commit} setError={setError} onClose={() => setComposerOpen(false)} /> : null}
      {gradeComposerOpen ? <GradePlanComposer data={data} commit={commit} setError={setError} onClose={() => setGradeComposerOpen(false)} /> : null}
      </div>
      <div
        className="panel-resize-handle"
        role="separator"
        aria-label="拖动调整教学计划面板大小"
        title="拖动调整面板大小；双击重置"
        onPointerDown={panelLayout.start}
        onPointerMove={panelLayout.move}
        onPointerUp={panelLayout.end}
        onPointerCancel={panelLayout.end}
        onDoubleClick={panelLayout.reset}
      />
    </section>
  );
}


export { PlansPage };





