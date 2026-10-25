import React, { useEffect, useMemo, useState } from 'react';
import type { Commit, CoursePlan, SchoolData } from './types';
import { SectionHeading } from './components';
import { PlanComposer } from './PlanComposer';
import { GradePlanComposer } from './GradePlanComposer';
import { FixedSlotsDialog } from './FixedSlotsDialog';
import { PlanMatrixPanel } from './PlanMatrixPanel';
import { PlanToolbar } from './PlanToolbar';
import { PlanTable } from './PlanTable';
import { PlanDetailDrawer } from './PlanDetailDrawer';
import {
  EMPTY_PLAN_FILTERS,
  EMPTY_PLAN_SORT,
  PLAN_COLUMNS,
  PLAN_COLUMN_BY_KEY,
  filterPlans,
  loadPlanView,
  paginatePlans,
  planLookups,
  resetPlanView,
  savePlanView,
  sortPlans,
} from './planTableView';
import type { PlanColumnKey, PlanFilters, PlanSort, PlanTableView } from './planTableView';
import { fixedSlotIdsOf } from '../../../packages/contracts/src';

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
  const [view, setView] = useState<PlanTableView>(() => loadPlanView());
  const [fullscreen, setFullscreen] = useState(false);
  const [filters, setFilters] = useState<PlanFilters>(EMPTY_PLAN_FILTERS);
  const [sort, setSort] = useState<PlanSort>(EMPTY_PLAN_SORT);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [gradeComposerOpen, setGradeComposerOpen] = useState(false);
  const [fixedEditor, setFixedEditor] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const lookups = useMemo(() => planLookups(data), [data]);
  const roomTypes = useMemo(() => Array.from(new Set(data.rooms.map((room) => room.type).filter(Boolean))), [data.rooms]);
  const filtered = useMemo(() => filterPlans(data.coursePlans, lookups, filters), [data.coursePlans, lookups, filters]);
  const sorted = useMemo(() => sortPlans(filtered, sort, lookups), [filtered, sort, lookups]);
  const pageData = useMemo(() => paginatePlans(sorted, page, view.pageSize), [sorted, page, view.pageSize]);
  const totalWeekly = useMemo(
    () => data.coursePlans.reduce((sum, plan) => sum + Number(plan.weeklyPeriods || 0), 0),
    [data.coursePlans],
  );
  const filterOptions = useMemo(() => ({
    grades: Array.from(new Set(data.classes.map((klass) => klass.grade?.trim() || '未分年级'))).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    classes: [...lookups.classById.values()].map((klass) => ({ id: klass.id, name: klass.name })),
    subjects: [...lookups.subjectById.values()].map((subject) => ({ id: subject.id, name: subject.name })),
  }), [data.classes, lookups]);

  useEffect(() => {
    // Column dragging updates the view on every pointer move; coalesce writes.
    const timer = window.setTimeout(() => savePlanView(view), 120);
    return () => window.clearTimeout(timer);
  }, [view]);

  useEffect(() => {
    setPage(1);
    setSelected([]);
  }, [filters, sort, view.pageSize, view.tab]);

  useEffect(() => {
    if (page !== pageData.page) setPage(pageData.page);
  }, [page, pageData.page]);

  useEffect(() => {
    if (drawerId && !data.coursePlans.some((plan) => plan.id === drawerId)) setDrawerId(null);
  }, [data.coursePlans, drawerId]);

  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // A menu or the fixed-slot dialog consumes the first Esc.
      if (document.querySelector('details[data-plan-menu][open]')) return;
      if (document.querySelector('.composer-overlay, .fixed-slots-overlay')) return;
      if (!drawerId && !fixedEditor) setFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [fullscreen, drawerId, fixedEditor]);

  const update = (id: string, patch: Partial<CoursePlan>) => {
    const plans = data.coursePlans.map((plan) => (plan.id === id ? { ...plan, ...patch } : plan));
    commit({ ...data, coursePlans: plans }, { invalidate: true });
  };

  const removePlan = (id: string): boolean => {
    if (!window.confirm('删除这条教学计划？相关候选课表会被清空。')) return false;
    commit({ ...data, coursePlans: data.coursePlans.filter((plan) => plan.id !== id) }, { invalidate: true });
    setSelected((current) => current.filter((item) => item !== id));
    return true;
  };

  const removeMany = (ids: string[]) => {
    const selectedIds = new Set(ids);
    commit(
      { ...data, coursePlans: data.coursePlans.filter((plan) => !selectedIds.has(plan.id)) },
      { invalidate: true, immediate: true },
    );
    setSelected((current) => current.filter((id) => !selectedIds.has(id)));
  };

  const batchEdit = (ids: string[], key: string, value: string | number) => {
    const selectedIds = new Set(ids);
    const plans = data.coursePlans.map((plan) => {
      if (!selectedIds.has(plan.id)) return plan;
      const next: CoursePlan = { ...plan, [key]: value } as CoursePlan;
      if ((key === 'roomType' || key === 'pairId') && String(value).trim() === '') {
        delete next[key];
      }
      if (key === 'consecutive') {
        const consecutive = Number(value);
        if (!Number.isInteger(consecutive) || consecutive < 2) delete next.consecutive;
        else next.consecutive = consecutive;
      }
      return next;
    });
    commit({ ...data, coursePlans: plans }, { invalidate: true, immediate: true });
  };

  const openComposer = () => {
    if (!data.classes.length) {
      setError('请先添加至少一个班级');
      return;
    }
    setError('');
    setComposerOpen(true);
  };
  const openGradeComposer = () => {
    if (!data.classes.length) {
      setError('请先添加至少一个班级');
      return;
    }
    setError('');
    setGradeComposerOpen(true);
  };

  const setViewPatch = (patch: Partial<PlanTableView>) => setView((current) => ({ ...current, ...patch }));
  const toggleColumn = (key: PlanColumnKey, visible: boolean) => {
    setView((current) => ({
      ...current,
      columns: {
        ...current.columns,
        [key]: { ...current.columns[key], visible: PLAN_COLUMN_BY_KEY.get(key)?.required ? true : visible },
      },
    }));
  };
  const showAllColumns = () => {
    setView((current) => {
      const columns = { ...current.columns };
      for (const column of PLAN_COLUMNS) columns[column.key] = { ...columns[column.key], visible: true };
      return { ...current, columns };
    });
  };
  const defaultColumns = () => {
    setView((current) => {
      const columns = { ...current.columns };
      for (const column of PLAN_COLUMNS) columns[column.key] = { ...columns[column.key], visible: column.defaultVisible };
      return { ...current, columns };
    });
  };

  const columnWidths = useMemo(() => {
    const hasManual = PLAN_COLUMNS.some((column) => view.columns[column.key].visible && view.columns[column.key].width);
    if (!hasManual) return null;
    const result: Record<string, number> = {};
    for (const column of PLAN_COLUMNS) {
      const width = view.columns[column.key].width;
      if (width) result[column.key] = width;
    }
    return result;
  }, [view.columns]);

  const changeColumnWidths = (next: Record<string, number> | null) => {
    setView((current) => {
      const columns = { ...current.columns };
      if (!next) {
        for (const key of Object.keys(columns) as PlanColumnKey[]) {
          columns[key] = { ...columns[key], width: undefined };
        }
      } else {
        for (const [key, width] of Object.entries(next)) {
          const columnKey = key as PlanColumnKey;
          if (!PLAN_COLUMN_BY_KEY.has(columnKey)) continue;
          columns[columnKey] = { ...columns[columnKey], width };
        }
      }
      return { ...current, columns };
    });
  };

  const resetView = () => {
    setView(resetPlanView());
    setFullscreen(false);
    setNotice('已恢复默认视图');
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

  const editingPlan = fixedEditor ? data.coursePlans.find((plan) => plan.id === fixedEditor) : undefined;
  const drawerPlan = drawerId ? data.coursePlans.find((plan) => plan.id === drawerId) : undefined;
  const panelClass = 'section-panel table-panel plan-panel' + (fullscreen ? ' is-fullscreen' : '');

  return (
    <section className={panelClass}>
      <div className="panel-head">
        <div>
          <SectionHeading english="COURSE PLAN REGISTER" title="教学计划明细" />
          <p className="plan-summary">
            <span><b>{data.coursePlans.length}</b> 条计划</span>
            <span>每周 <b>{totalWeekly}</b> 课时</span>
            <span><b>{data.timeSlots.length}</b> 个时间格</span>
          </p>
        </div>
        <div className="plan-head-right">
          <div className="plan-tabs" role="tablist" aria-label="教学计划视图">
            <button
              type="button"
              role="tab"
              aria-selected={view.tab === 'detail'}
              className={view.tab === 'detail' ? 'active' : ''}
              onClick={() => setViewPatch({ tab: 'detail' })}
            >
              明细
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view.tab === 'summary'}
              className={view.tab === 'summary' ? 'active' : ''}
              onClick={() => { setDrawerId(null); setViewPatch({ tab: 'summary' }); }}
            >
              课时汇总
            </button>
          </div>
          {fullscreen ? (
            <button type="button" className="ghost-button plan-exit-fullscreen" onClick={() => setFullscreen(false)}>
              退出全屏
            </button>
          ) : null}
        </div>
      </div>

      {view.tab === 'detail' ? (
        <>
          <PlanToolbar
            filters={filters}
            onFiltersChange={setFilters}
            options={filterOptions}
            total={data.coursePlans.length}
            filteredCount={filtered.length}
            view={view}
            onViewChange={setViewPatch}
            onToggleColumn={toggleColumn}
            onShowAllColumns={showAllColumns}
            onDefaultColumns={defaultColumns}
            onResetColumnWidths={() => changeColumnWidths(null)}
            onResetView={resetView}
            onAdd={openComposer}
            onAddGrade={openGradeComposer}
            fullscreen={fullscreen}
            onToggleFullscreen={() => setFullscreen((current) => !current)}
          />
          <PlanTable
            plans={sorted}
            lookups={lookups}
            view={view}
            onViewChange={setViewPatch}
            columnWidths={columnWidths}
            onColumnWidthsChange={changeColumnWidths}
            page={page}
            onPageChange={setPage}
            sort={sort}
            onSortChange={setSort}
            selected={selected}
            onToggleSelect={(id) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
            onSelectPage={(ids, checked) => setSelected((current) => checked ? Array.from(new Set([...current, ...ids])) : current.filter((id) => !ids.includes(id)))}
            onSelectAllFiltered={() => setSelected(filtered.map((plan) => plan.id))}
            onClearSelection={() => setSelected([])}
            onUpdate={update}
            onDelete={(id) => { removePlan(id); }}
            onBatch={(key, value) => batchEdit(selected, key, value)}
            onBatchDelete={() => {
              if (!selected.length) return;
              if (!window.confirm('删除选中的 ' + selected.length + ' 条教学计划？相关候选课表会被清空。')) return;
              removeMany(selected);
              setSelected([]);
            }}
            onOpenDrawer={setDrawerId}
            onOpenFixed={setFixedEditor}
            roomTypes={roomTypes}
          />
        </>
      ) : (
        <PlanMatrixPanel data={data} />
      )}

      <p className="panel-note">
        明细支持拖动列宽、双击分隔线恢复单列；约束与固定时间可从「约束」列或「更多」打开。视图、列显示与列宽保存在本机浏览器。
      </p>

      {drawerPlan ? (
        <PlanDetailDrawer
          plan={drawerPlan}
          lookups={lookups}
          roomTypes={roomTypes}
          onClose={() => setDrawerId(null)}
          onSave={(patch) => update(drawerPlan.id, patch)}
          onDelete={() => removePlan(drawerPlan.id)}
          onOpenFixed={() => setFixedEditor(drawerPlan.id)}
          escapeDisabled={Boolean(fixedEditor)}
        />
      ) : null}
      {fixedEditor && editingPlan ? (
        <FixedSlotsDialog
          title={'固定时间：' + (lookups.classById.get(editingPlan.classId)?.name ?? '') + ' / ' + (lookups.subjectById.get(editingPlan.subjectId)?.name ?? '')}
          slots={data.timeSlots}
          value={fixedSlotIdsOf(editingPlan)}
          max={Number(editingPlan.weeklyPeriods ?? 0)}
          onChange={saveFixedSlots}
          onClose={() => setFixedEditor(null)}
        />
      ) : null}
      {composerOpen ? <PlanComposer data={data} commit={commit} setError={setError} onClose={() => setComposerOpen(false)} /> : null}
      {gradeComposerOpen ? <GradePlanComposer data={data} commit={commit} setError={setError} onClose={() => setGradeComposerOpen(false)} /> : null}
    </section>
  );
}

export { PlansPage };
