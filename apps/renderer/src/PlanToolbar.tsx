import React, { useEffect } from 'react';
import type { PlanColumnKey, PlanFilters, PlanTableView } from './planTableView';
import { PLAN_COLUMNS } from './planTableView';

export interface PlanFilterOptions {
  grades: string[];
  classes: { id: string; name: string }[];
  subjects: { id: string; name: string }[];
}

interface PlanToolbarProps {
  filters: PlanFilters;
  onFiltersChange: (next: PlanFilters) => void;
  options: PlanFilterOptions;
  total: number;
  filteredCount: number;
  view: PlanTableView;
  onViewChange: (patch: Partial<PlanTableView>) => void;
  onToggleColumn: (key: PlanColumnKey, visible: boolean) => void;
  onShowAllColumns: () => void;
  onDefaultColumns: () => void;
  onResetColumnWidths: () => void;
  onResetView: () => void;
  onAdd: () => void;
  onAddGrade: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}

function closeMenu(target: EventTarget | null) {
  const menu = target instanceof Element ? target.closest('details[data-plan-menu]') : null;
  if (menu instanceof HTMLDetailsElement) menu.removeAttribute('open');
}

/** Filter row and the three menus (new plan / columns / view). */
function PlanToolbar({
  filters,
  onFiltersChange,
  options,
  total,
  filteredCount,
  view,
  onViewChange,
  onToggleColumn,
  onShowAllColumns,
  onDefaultColumns,
  onResetColumnWidths,
  onResetView,
  onAdd,
  onAddGrade,
  fullscreen,
  onToggleFullscreen,
}: PlanToolbarProps) {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      document.querySelectorAll<HTMLDetailsElement>('details[data-plan-menu][open]').forEach((menu) => {
        if (!menu.contains(event.target as Node)) menu.removeAttribute('open');
      });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const open = document.querySelectorAll<HTMLDetailsElement>('details[data-plan-menu][open]');
      if (!open.length) return;
      open.forEach((menu) => menu.removeAttribute('open'));
      // The menu owns this Esc; do not also leave fullscreen on the same key.
      event.stopImmediatePropagation();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const set = (patch: Partial<PlanFilters>) => onFiltersChange({ ...filters, ...patch });
  const active = Boolean(filters.query || filters.grade || filters.classId || filters.subjectId || filters.weeks || filters.teacherUnset);
  const optionalColumns = PLAN_COLUMNS.filter((column) => !column.required);
  const visibleOptional = optionalColumns.filter((column) => view.columns[column.key].visible).length;

  return (
    <div className="plan-toolbar">
      <div className="plan-filter-row">
        <span className="plan-filter-kicker">// FILTER / 筛选</span>
        <label className="plan-search">
          <span aria-hidden="true">//</span>
          <input
            type="search"
            value={filters.query}
            onChange={(event) => set({ query: event.target.value })}
            placeholder="班级 / 学科 / 教师 / 配对组 / 固定时间"
            aria-label="搜索教学计划"
          />
        </label>
        <select value={filters.grade} onChange={(event) => set({ grade: event.target.value })} aria-label="按年级筛选">
          <option value="">全部年级</option>
          {options.grades.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
        </select>
        <select value={filters.classId} onChange={(event) => set({ classId: event.target.value })} aria-label="按班级筛选">
          <option value="">全部班级</option>
          {options.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select value={filters.subjectId} onChange={(event) => set({ subjectId: event.target.value })} aria-label="按学科筛选">
          <option value="">全部学科</option>
          {options.subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select value={filters.weeks} onChange={(event) => set({ weeks: event.target.value as PlanFilters['weeks'] })} aria-label="按周次筛选">
          <option value="">全部周次</option>
          <option value="all">每周</option>
          <option value="odd">单周</option>
          <option value="even">双周</option>
        </select>
        <button
          type="button"
          className={filters.teacherUnset ? 'plan-filter-toggle is-active' : 'plan-filter-toggle'}
          aria-pressed={filters.teacherUnset}
          onClick={() => set({ teacherUnset: !filters.teacherUnset })}
        >
          未指定教师
        </button>
        {active ? <button type="button" className="plan-filter-clear" onClick={() => onFiltersChange({ query: '', grade: '', classId: '', subjectId: '', weeks: '', teacherUnset: false })}>清除筛选</button> : null}
        <span className="plan-filter-count"><b>{filteredCount}</b> / {total} 条</span>
      </div>
      <div className="plan-toolbar-actions">
        <details className="plan-menu" data-plan-menu>
          <summary className="plan-menu-trigger">新增 <span aria-hidden="true">▾</span></summary>
          <div className="plan-menu-panel plan-menu-small">
            <p className="plan-menu-kicker">// NEW PLAN</p>
            <button type="button" onClick={(event) => { closeMenu(event.currentTarget); onAdd(); }}>批量新增教学计划</button>
            <button type="button" onClick={(event) => { closeMenu(event.currentTarget); onAddGrade(); }}>按年级批量设置</button>
          </div>
        </details>
        <details className="plan-menu" data-plan-menu>
          <summary className="plan-menu-trigger">列设置 <span className="plan-menu-count">{visibleOptional}/{optionalColumns.length}</span></summary>
          <div className="plan-menu-panel">
            <p className="plan-menu-kicker">// COLUMNS / 列</p>
            <div className="plan-column-list">
              {PLAN_COLUMNS.map((column) => {
                const checked = view.columns[column.key].visible;
                return (
                  <label key={column.key} className={column.required ? 'plan-column-row is-required' : 'plan-column-row'}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={column.required}
                      onChange={(event) => onToggleColumn(column.key, event.target.checked)}
                    />
                    <span>{column.label}</span>
                    {column.required ? <em>必显</em> : null}
                  </label>
                );
              })}
            </div>
            <div className="plan-menu-row">
              <button type="button" className="plan-menu-link" onClick={(event) => { onShowAllColumns(); closeMenu(event.currentTarget); }}>显示全部</button>
              <button type="button" className="plan-menu-link" onClick={(event) => { onDefaultColumns(); closeMenu(event.currentTarget); }}>恢复默认列</button>
            </div>
            <button type="button" className="plan-menu-action" onClick={(event) => { onResetColumnWidths(); closeMenu(event.currentTarget); }}>列宽自适应</button>
          </div>
        </details>
        <details className="plan-menu" data-plan-menu>
          <summary className="plan-menu-trigger">视图 <span aria-hidden="true">▾</span></summary>
          <div className="plan-menu-panel">
            <p className="plan-menu-kicker">// VIEW / 视图</p>
            <div className="plan-menu-field">
              <span>密度</span>
              <div className="plan-seg" role="group" aria-label="表格密度">
                <button type="button" className={view.density === 'compact' ? 'active' : ''} onClick={() => onViewChange({ density: 'compact' })}>紧凑</button>
                <button type="button" className={view.density === 'standard' ? 'active' : ''} onClick={() => onViewChange({ density: 'standard' })}>标准</button>
              </div>
            </div>
            <div className="plan-menu-field">
              <span>高度</span>
              <div className="plan-seg" role="group" aria-label="表格高度">
                <button type="button" className={view.height === 'standard' ? 'active' : ''} onClick={() => onViewChange({ height: 'standard' })}>标准</button>
                <button type="button" className={view.height === 'tall' ? 'active' : ''} onClick={() => onViewChange({ height: 'tall' })}>加高</button>
              </div>
            </div>
            <button type="button" className="plan-menu-action" onClick={(event) => { onToggleFullscreen(); closeMenu(event.currentTarget); }}>{fullscreen ? '退出全屏表格' : '全屏表格'}</button>
            <button type="button" className="plan-menu-action" onClick={(event) => { onResetColumnWidths(); closeMenu(event.currentTarget); }}>列宽自适应</button>
            <button type="button" className="plan-menu-action is-quiet" onClick={(event) => { onResetView(); closeMenu(event.currentTarget); }}>恢复默认视图</button>
          </div>
        </details>
      </div>
    </div>
  );
}

export { PlanToolbar };
