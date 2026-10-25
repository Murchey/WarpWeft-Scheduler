import React, { useMemo, useState } from 'react';
import type { CoursePlan } from './types';
import type { PlanColumnDef, PlanLookups, PlanSort, PlanTableView } from './planTableView';
import { KIND_LABELS, PLAN_COLUMNS, paginatePlans, planConstraintSummary, planFixedLabels } from './planTableView';
import { usePlanColumnWidths } from './resizableTable';

const PLAN_KIND_OPTIONS = ['regular', 'morning', 'study', 'aftercare', 'evening', 'makeup'];
const PLAN_WEEK_OPTIONS = [
  { value: 'all', label: '每周' },
  { value: 'odd', label: '单周' },
  { value: 'even', label: '双周' },
];

interface PlanTableProps {
  plans: CoursePlan[];
  lookups: PlanLookups;
  view: PlanTableView;
  onViewChange: (patch: Partial<PlanTableView>) => void;
  columnWidths: Record<string, number> | null;
  onColumnWidthsChange: (widths: Record<string, number> | null) => void;
  page: number;
  onPageChange: (page: number) => void;
  sort: PlanSort;
  onSortChange: (sort: PlanSort) => void;
  selected: string[];
  onToggleSelect: (id: string) => void;
  onSelectPage: (ids: string[], selected: boolean) => void;
  onSelectAllFiltered: () => void;
  onClearSelection: () => void;
  onUpdate: (id: string, patch: Partial<CoursePlan>) => void;
  onDelete: (id: string) => void;
  onBatch: (key: string, value: string | number) => void;
  onBatchDelete: () => void;
  onOpenDrawer: (planId: string) => void;
  onOpenFixed: (planId: string) => void;
  roomTypes: string[];
}

function PlanTable({
  plans,
  lookups,
  view,
  onViewChange,
  columnWidths,
  onColumnWidthsChange,
  page,
  onPageChange,
  sort,
  onSortChange,
  selected,
  onToggleSelect,
  onSelectPage,
  onSelectAllFiltered,
  onClearSelection,
  onUpdate,
  onDelete,
  onBatch,
  onBatchDelete,
  onOpenDrawer,
  onOpenFixed,
  roomTypes,
}: PlanTableProps) {
  const [batchKey, setBatchKey] = useState('teacherId');
  const [batchValue, setBatchValue] = useState('');
  const visibleColumns = useMemo(
    () => PLAN_COLUMNS.filter((column) => view.columns[column.key].visible),
    [view.columns],
  );
  const defaultWidths = useMemo(
    () => Object.fromEntries(PLAN_COLUMNS.map((column) => [column.key, column.defaultWidth])),
    [],
  );
  const minWidths = useMemo(
    () => Object.fromEntries(PLAN_COLUMNS.map((column) => [column.key, column.minWidth])),
    [],
  );
  const resize = usePlanColumnWidths({
    widths: columnWidths,
    onChange: onColumnWidthsChange,
    defaultWidths,
    minWidths,
  });
  const effectiveWidths = useMemo(() => {
    const hasManual = visibleColumns.some((column) => columnWidths && columnWidths[column.key]);
    if (!hasManual) return null;
    const result: Record<string, number> = {};
    for (const column of visibleColumns) result[column.key] = columnWidths?.[column.key] ?? column.defaultWidth;
    return result;
  }, [columnWidths, visibleColumns]);
  const totalWidth = effectiveWidths
    ? 40 + visibleColumns.reduce((sum, column) => sum + (effectiveWidths[column.key] ?? column.defaultWidth), 0)
    : 0;
  const tableStyle = effectiveWidths
    ? { tableLayout: 'fixed' as const, width: totalWidth, minWidth: totalWidth }
    : undefined;
  const pageData = useMemo(() => paginatePlans(plans, page, view.pageSize), [plans, page, view.pageSize]);
  const pageIds = pageData.items.map((plan) => plan.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));
  const selectedSet = new Set(selected);
  const classes = [...lookups.classById.values()];
  const subjects = [...lookups.subjectById.values()];
  const teachers = [...lookups.teacherById.values()];

  const toggleSort = (key: PlanColumnDef['key']) => {
    if (key !== 'classId' && key !== 'subjectId' && key !== 'teacherId' && key !== 'weeklyPeriods') return;
    onSortChange({ key, dir: sort.key === key && sort.dir === 'asc' ? 'desc' : 'asc' });
  };

  const applyBatch = () => {
    if (!selected.length) return;
    const numeric = batchKey === 'weeklyPeriods' || batchKey === 'consecutive';
    const value = numeric ? Number(batchValue) : batchValue;
    if (batchKey === 'weeklyPeriods' && (!Number.isFinite(value) || Number(value) <= 0)) return;
    if (batchKey === 'consecutive' && (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 4)) return;
    onBatch(batchKey, value);
  };
  const batchInvalid =
    ((batchKey === 'classId' || batchKey === 'subjectId' || batchKey === 'weeklyPeriods' || batchKey === 'weeks' || batchKey === 'kind') && !batchValue) ||
    (batchKey === 'weeklyPeriods' && Number(batchValue) <= 0) ||
    (batchKey === 'consecutive' && (!Number.isInteger(Number(batchValue)) || Number(batchValue) < 0 || Number(batchValue) > 4));
  const renderBatchValue = () => {
    switch (batchKey) {
      case 'classId':
        return (
          <select value={batchValue} onChange={(event) => setBatchValue(event.target.value)} aria-label="批量班级">
            <option value="">选择班级</option>
            {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        );
      case 'subjectId':
        return (
          <select value={batchValue} onChange={(event) => setBatchValue(event.target.value)} aria-label="批量学科">
            <option value="">选择学科</option>
            {subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        );
      case 'teacherId':
        return (
          <select value={batchValue} onChange={(event) => setBatchValue(event.target.value)} aria-label="批量教师">
            <option value="">未指定</option>
            {teachers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        );
      case 'weeklyPeriods':
        return <input type="number" min={1} value={batchValue} onChange={(event) => setBatchValue(event.target.value)} placeholder="节/周" aria-label="批量每周课时" />;
      case 'weeks':
        return (
          <select value={batchValue} onChange={(event) => setBatchValue(event.target.value)} aria-label="批量周次">
            <option value="">选择周次</option>
            {PLAN_WEEK_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        );
      case 'kind':
        return (
          <select value={batchValue} onChange={(event) => setBatchValue(event.target.value)} aria-label="批量课程类型">
            <option value="">选择类型</option>
            {PLAN_KIND_OPTIONS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind] ?? kind}</option>)}
          </select>
        );
      case 'roomType':
        return <input value={batchValue} onChange={(event) => setBatchValue(event.target.value)} list="plan-room-types" placeholder="教室类型（留空=不限）" aria-label="批量教室类型" />;
      case 'consecutive':
        return <input type="number" min={0} max={4} value={batchValue} onChange={(event) => setBatchValue(event.target.value)} placeholder="0–4（0=不连堂）" aria-label="批量连堂节数" />;
      case 'pairId':
        return <input value={batchValue} onChange={(event) => setBatchValue(event.target.value)} placeholder="配对组（留空=清除）" aria-label="批量配对组" />;
      default:
        return null;
    }
  };

  const renderCell = (column: PlanColumnDef, plan: CoursePlan) => {
    switch (column.key) {
      case 'classId':
        return (
          <select value={plan.classId} onChange={(event) => onUpdate(plan.id, { classId: event.target.value })} aria-label="班级">
            {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        );
      case 'subjectId':
        return (
          <select value={plan.subjectId} onChange={(event) => onUpdate(plan.id, { subjectId: event.target.value })} aria-label="学科">
            {subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        );
      case 'teacherId':
        return (
          <select value={plan.teacherId ?? ''} onChange={(event) => onUpdate(plan.id, { teacherId: event.target.value })} aria-label="教师">
            <option value="">未指定</option>
            {teachers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        );
      case 'weeklyPeriods':
        return (
          <input
            type="number"
            min={1}
            value={plan.weeklyPeriods}
            onChange={(event) => onUpdate(plan.id, { weeklyPeriods: Number(event.target.value) })}
            aria-label="每周课时"
          />
        );
      case 'constraints': {
        const badges = planConstraintSummary(plan, lookups);
        return (
          <button type="button" className="plan-constraints" onClick={() => onOpenDrawer(plan.id)} title="打开约束设置">
            {badges.length === 0 ? <span className="plan-none">—</span> : null}
            {badges.slice(0, 3).map((badge) => (
              <span key={badge.key} className={badge.tone === 'accent' ? 'plan-badge is-accent' : 'plan-badge'}>{badge.label}</span>
            ))}
            {badges.length > 3 ? <span className="plan-badge is-more">+{badges.length - 3}</span> : null}
          </button>
        );
      }
      case 'weeks':
        return (
          <select value={plan.weeks ?? 'all'} onChange={(event) => onUpdate(plan.id, { weeks: event.target.value as CoursePlan['weeks'] })} aria-label="周次">
            {PLAN_WEEK_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        );
      case 'kind':
        return (
          <select value={plan.kind ?? 'regular'} onChange={(event) => onUpdate(plan.id, { kind: event.target.value as CoursePlan['kind'] })} aria-label="课程类型">
            {PLAN_KIND_OPTIONS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind] ?? kind}</option>)}
          </select>
        );
      case 'roomType':
        return (
          <input
            list="plan-room-types"
            value={plan.roomType ?? ''}
            onChange={(event) => onUpdate(plan.id, { roomType: event.target.value })}
            placeholder="不限"
            aria-label="教室类型"
          />
        );
      case 'fixed': {
        const labels = planFixedLabels(plan, lookups);
        return (
          <button type="button" className="plan-fixed-trigger" onClick={() => onOpenFixed(plan.id)} title="选择固定时间">
            <span>{labels.length ? labels.join('；') : '不固定'}</span>
            <em>编辑</em>
          </button>
        );
      }
      case 'consecutive':
        return (
          <input
            type="number"
            min={0}
            max={4}
            value={plan.consecutive ?? 0}
            onChange={(event) => onUpdate(plan.id, { consecutive: Number(event.target.value) || undefined })}
            aria-label="连堂节数"
          />
        );
      case 'pairId':
        return (
          <input
            value={plan.pairId ?? ''}
            onChange={(event) => onUpdate(plan.id, { pairId: event.target.value || undefined })}
            placeholder="如 语数间周"
            aria-label="配对组"
          />
        );
      case 'actions':
        return (
          <div className="plan-row-actions">
            <button type="button" className="plan-row-more" onClick={() => onOpenDrawer(plan.id)}>更多</button>
            <button type="button" className="danger-link" onClick={() => onDelete(plan.id)}>删除</button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className={'plan-table-block plan-table-' + view.height + (view.density === 'compact' ? ' is-compact' : '')}>
      <datalist id="plan-room-types">
        {roomTypes.map((type) => <option key={type} value={type} />)}
      </datalist>
      {selected.length > 0 ? (
        <div className="plan-batch-bar">
          <span className="plan-batch-count"><b>{selected.length}</b> 条已选</span>
          <select value={batchKey} onChange={(event) => { setBatchKey(event.target.value); setBatchValue(''); }} aria-label="批量修改字段">
            <option value="classId">班级</option>
            <option value="subjectId">学科</option>
            <option value="teacherId">教师</option>
            <option value="weeklyPeriods">每周课时</option>
            <option value="weeks">周次</option>
            <option value="kind">课程类型</option>
            <option value="roomType">教室类型</option>
            <option value="consecutive">连堂节数</option>
            <option value="pairId">配对组</option>
          </select>
          {renderBatchValue()}
          <button type="button" className="mini-button" onClick={applyBatch} disabled={batchInvalid}>
            应用
          </button>
          <span className="plan-batch-hint">可选多条后一次修改；留空的选填字段会清除；班级/教师/学科改动会触发数据检查。</span>
          <button type="button" className="plan-batch-link" onClick={onSelectAllFiltered}>全选筛选结果</button>
          <button type="button" className="danger-link" onClick={onBatchDelete}>删除选中</button>
          <button type="button" className="plan-batch-link" onClick={onClearSelection}>取消</button>
        </div>
      ) : null}
      <div className="plan-table-scroll">
        <table className={'data-table plan-table' + (resize.active ? ' is-resizing' : '')} style={tableStyle}>
          {effectiveWidths ? (
            <colgroup>
              <col style={{ width: 40 }} />
              {visibleColumns.map((column) => <col key={column.key} style={{ width: effectiveWidths[column.key] }} />)}
            </colgroup>
          ) : null}
          <thead>
            <tr>
              <th className="plan-col-select">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={() => onSelectPage(pageIds, !allPageSelected)}
                  aria-label="选择当前页"
                  disabled={pageData.items.length === 0}
                />
              </th>
              {visibleColumns.map((column) => (
                <th
                  key={column.key}
                  data-plan-col={column.key}
                  className={column.key === 'classId' || column.key === 'actions' ? 'plan-sticky-' + (column.key === 'classId' ? 'left' : 'right') : undefined}
                  aria-sort={sort.key === column.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {column.sortable ? (
                    <button type="button" className="plan-sort" onClick={() => toggleSort(column.key)}>
                      {column.label}
                      <span className={sort.key === column.key ? 'plan-sort-mark is-active' : 'plan-sort-mark'} aria-hidden="true">
                        {sort.key === column.key ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                    </button>
                  ) : (
                    <span className="plan-th-label">{column.label}</span>
                  )}
                  <span
                    className="col-resizer"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={'调整「' + column.label + '」列宽'}
                    title="拖动调整列宽；双击恢复默认"
                    onPointerDown={resize.start(column.key)}
                    onPointerMove={resize.move}
                    onPointerUp={resize.end}
                    onPointerCancel={resize.end}
                    onDoubleClick={() => resize.resetColumn(column.key)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageData.items.length === 0 ? (
              <tr>
                <td className="table-empty" colSpan={visibleColumns.length + 1}>
                  {plans.length === 0 ? '还没有教学计划。用「新增」创建，或从 Excel 导入。' : '没有符合筛选条件的教学计划。清除筛选后再试。'}
                </td>
              </tr>
            ) : pageData.items.map((plan) => (
              <tr
                key={plan.id}
                className={selectedSet.has(plan.id) ? 'is-selected' : undefined}
                onDoubleClick={(event) => {
                  const tag = (event.target as HTMLElement).tagName;
                  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON') return;
                  onOpenDrawer(plan.id);
                }}
              >
                <td className="plan-col-select">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(plan.id)}
                    onChange={() => onToggleSelect(plan.id)}
                    aria-label={'选择 ' + (lookups.classById.get(plan.classId)?.name ?? '') + ' ' + (lookups.subjectById.get(plan.subjectId)?.name ?? '')}
                  />
                </td>
                {visibleColumns.map((column) => {
                  const cellClass = [
                    column.align === 'right' ? 'num' : '',
                    column.key === 'classId' ? 'plan-sticky-left' : '',
                    column.key === 'actions' ? 'plan-sticky-right' : '',
                  ].filter(Boolean).join(' ');
                  return (
                    <td key={column.key} className={cellClass || undefined}>
                      {renderCell(column, plan)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="plan-table-foot">
        <span className="plan-foot-count"><b>{plans.length}</b> 条筛选结果 / 当前第 {pageData.page} 页</span>
        <label className="plan-page-size">
          每页
          <select value={view.pageSize} onChange={(event) => onViewChange({ pageSize: Number(event.target.value) })} aria-label="每页条数">
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>
        </label>
        <div className="plan-pager">
          <button type="button" className="ghost-button" onClick={() => onPageChange(pageData.page - 1)} disabled={pageData.page <= 1}>上一页</button>
          <span className="plan-pager-count">{pageData.page} / {pageData.pageCount}</span>
          <button type="button" className="ghost-button" onClick={() => onPageChange(pageData.page + 1)} disabled={pageData.page >= pageData.pageCount}>下一页</button>
        </div>
      </div>
    </div>
  );
}

export { PlanTable };
