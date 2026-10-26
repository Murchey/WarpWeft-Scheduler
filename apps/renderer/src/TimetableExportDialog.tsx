import React, { useMemo, useState } from 'react';
import type { SchoolData, SolverOutput } from './types';
import { SectionHeading } from './components';
import { batchTimetableFileName, batchTimetableFolderName, buildTimetableGrid, exportEntityName, VIEW_LABELS } from './timetableExport';
import type { BatchTimetableOutput, BatchTimetableSelection, ExportView, TimetableExportSettings } from './timetableExport';
import { semesterWeeks } from '../../../packages/semester/src';

export function TimetableExportDialog({
  data,
  result,
  initialView,
  initialEntityId,
  initialWeekNo,
  initialBatch = false,
  mode,
  onClose,
  onConfirm,
  onBatchConfirm,
}: {
  data: SchoolData;
  result: SolverOutput;
  initialView: ExportView;
  initialEntityId: string;
  initialWeekNo?: number | null;
  initialBatch?: boolean;
  mode: 'export' | 'publish';
  onClose: () => void;
  onConfirm: (settings: TimetableExportSettings, onStage: (stage: 'generating' | 'writing') => void) => Promise<boolean>;
  onBatchConfirm?: (
    settings: TimetableExportSettings,
    selection: BatchTimetableSelection,
    onStage: (stage: 'generating' | 'writing') => void,
    onProgress: (done: number, total: number) => void,
  ) => Promise<boolean>;
}) {
  // 正式版导出与普通导出共用批量课表链路，避免两套模板填充和命名逻辑漂移。
  const canBatch = Boolean(onBatchConfirm);
  const entities = initialView === 'teacher' ? data.teachers : initialView === 'room' ? data.rooms : data.classes;
  const initialEntity = entities.some((item) => item.id === initialEntityId) ? initialEntityId : entities[0]?.id || '';
  const [settings, setSettings] = useState<TimetableExportSettings>({
    view: initialView,
    entityId: initialEntity,
    layout: 'vertical',
    schoolName: data.school.name,
    title: VIEW_LABELS[initialView],
    weeks: 'all',
    weekNo: initialWeekNo ?? null,
    scope: 'single',
    showTeacher: true,
    showRoom: true,
    showWeeks: true,
  });
  const [batch, setBatch] = useState(Boolean(initialBatch) && canBatch);
  const [batchClasses, setBatchClasses] = useState(true);
  const [batchTeachers, setBatchTeachers] = useState(true);
  const [batchOutput, setBatchOutput] = useState<BatchTimetableOutput>('workbook');
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'idle' | 'generating' | 'writing'>('idle');
  const [error, setError] = useState('');
  const weeks = semesterWeeks(data.semester);
  const entityOptions = settings.view === 'teacher' ? data.teachers : settings.view === 'room' ? data.rooms : data.classes;
  const entityLabel = settings.view === 'teacher' ? '教师' : settings.view === 'room' ? '教室' : '班级';
  const batchCount = (batchClasses ? data.classes.length : 0) + (batchTeachers ? data.teachers.length : 0);
  const grid = useMemo(() => {
    try {
      return buildTimetableGrid(data, result, settings);
    } catch {
      return null;
    }
  }, [data, result, settings]);

  const switchBatch = (next: boolean) => {
    if (!canBatch) return;
    setBatch(next);
    setError('');
    setBatchProgress(null);
    if (next) setSettings((current) => ({ ...current, scope: 'single' }));
  };

  const confirm = async () => {
    if (batch && (!batchClasses && !batchTeachers)) {
      setError('请至少选择班级课表或教师课表。');
      return;
    }
    if (batch && !onBatchConfirm) return;
    setBusy(true);
    setStage('generating');
    setError('');
    setBatchProgress(null);
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 40));
      let ok = false;
      if (batch && onBatchConfirm) {
        const batchSettings: TimetableExportSettings = { ...settings, scope: 'single' };
        ok = await onBatchConfirm(
          batchSettings,
          { classes: batchClasses, teachers: batchTeachers, output: batchOutput },
          (next) => setStage(next),
          (done, total) => setBatchProgress({ done, total }),
        );
      } else {
        ok = await onConfirm(settings, (next) => setStage(next));
      }
      if (ok) onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      setStage('idle');
    }
  };

  const progressPercent =
    stage === 'writing'
      ? 92
      : batch && batchProgress
        ? Math.min(88, 8 + Math.round((batchProgress.done / Math.max(1, batchProgress.total)) * 80))
        : batch
          ? 8
          : 40;
  const batchSelection: BatchTimetableSelection = { classes: batchClasses, teachers: batchTeachers, output: batchOutput };
  const batchDescriptor = { schoolName: settings.schoolName, weeks: settings.weeks, weekNo: settings.weekNo };
  const fileName = batch
    ? batchOutput === 'workbook'
      ? batchTimetableFileName(data, batchDescriptor, batchSelection)
      : batchTimetableFolderName(data, batchDescriptor, batchSelection) + '/'
    : (settings.schoolName || data.school.name) + '-' + exportEntityName(data, settings) + '-' + (settings.title || '课表') + (settings.weekNo ? '-第' + settings.weekNo + '周' : '') + '-日期.xlsx';

  return (
    <div className="export-overlay" role="dialog" aria-modal="true" aria-label="导出课表">
      <div className="export-dialog">
        <header className="export-head">
          <SectionHeading english="EXPORT & LAYOUT" title={mode === 'publish' ? '保存正式版' : batch ? '批量导出课表' : '导出课表'} />
          <button type="button" className="resource-workspace-close" onClick={onClose} aria-label="关闭" disabled={busy}>×</button>
        </header>
        <p className="panel-note">
          {batch
            ? batchOutput === 'workbook'
              ? '一次生成一个 Excel 文件，每个班级/教师一张工作表；仍使用选定模板的字体、边框与页面布局（自动调整为 1 页宽）。'
              : '每张课表生成一个独立的 Excel 文件，保存时选择一个文件夹统一写入；每份文件仍保留模板的字体、边框与页面布局（自动调整为 1 页宽）。'
            : '使用选定的纵向/横向课表模板导出，保留模板的字体、边框与页面布局（自动调整为 1 页宽）；不附加软件元数据。'}
        </p>

        {canBatch ? (
          <div className="export-mode-switch" role="group" aria-label="导出方式">
            {mode === 'export' ? <button type="button" className={batch ? '' : 'active'} onClick={() => switchBatch(false)} disabled={busy}>单个课表</button> : null}
            <button type="button" className={batch ? 'active' : ''} onClick={() => switchBatch(true)} disabled={busy}>批量导出</button>
          </div>
        ) : null}

        <div className="export-form">
          <label>学校名称<input value={settings.schoolName} onChange={(event) => setSettings({ ...settings, schoolName: event.target.value })} /></label>
          {batch ? null : <label>标题<input value={settings.title} onChange={(event) => setSettings({ ...settings, title: event.target.value })} /></label>}
          <label>版式
            <select value={settings.layout} onChange={(event) => setSettings({ ...settings, layout: event.target.value as 'vertical' | 'horizontal' })}>
              <option value="vertical">纵向（A4 纵向）</option>
              <option value="horizontal">横向（A4 横向）</option>
            </select>
          </label>
          {batch ? (
            <div className="export-batch-scope">
              <span>批量范围</span>
              <div className="export-batch-options">
                <label><input type="checkbox" checked={batchClasses} onChange={(event) => setBatchClasses(event.target.checked)} /> 班级课表 <b>{data.classes.length}</b></label>
                <label><input type="checkbox" checked={batchTeachers} onChange={(event) => setBatchTeachers(event.target.checked)} /> 教师课表 <b>{data.teachers.length}</b></label>
              </div>
              <span className="export-batch-output-label">输出方式</span>
              <div className="export-batch-options">
                <label><input type="radio" name="batch-output" checked={batchOutput === 'workbook'} onChange={() => setBatchOutput('workbook')} /> 一个文件（多个工作表）</label>
                <label><input type="radio" name="batch-output" checked={batchOutput === 'files'} onChange={() => setBatchOutput('files')} /> 多个文件（每张课表一个）</label>
              </div>
              <small>
                {batchCount
                  ? batchOutput === 'workbook'
                    ? '共 ' + batchCount + ' 张工作表，保存为一个 xlsx 文件'
                    : '共 ' + batchCount + ' 个文件，保存时选择目标文件夹'
                  : '请至少选择一种课表'}
              </small>
            </div>
          ) : (
            <>
              <label>范围
                <select
                  value={settings.scope}
                  onChange={(event) => setSettings({ ...settings, scope: event.target.value as 'single' | 'semester' })}
                >
                  <option value="single">单周/当前课表</option>
                  <option value="semester" disabled={weeks.length === 0}>整学期（相同周次合并）</option>
                </select>
              </label>
              <label>视图
                <select
                  value={settings.view}
                  onChange={(event) => {
                    const nextView = event.target.value as ExportView;
                    const nextOptions = nextView === 'teacher' ? data.teachers : nextView === 'room' ? data.rooms : data.classes;
                    setSettings({
                      ...settings,
                      view: nextView,
                      entityId: nextOptions[0]?.id ?? '',
                      title: VIEW_LABELS[nextView],
                    });
                  }}
                >
                  <option value="class">班级课表</option>
                  <option value="teacher">教师课表</option>
                  <option value="room">教室课表</option>
                </select>
              </label>
              <label>{entityLabel}
                <select value={settings.entityId} onChange={(event) => setSettings({ ...settings, entityId: event.target.value })}>
                  {entityOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            </>
          )}
          {settings.scope === 'single' ? (
            <>
              <label>周次
                <select value={settings.weeks} onChange={(event) => setSettings({ ...settings, weeks: event.target.value as TimetableExportSettings['weeks'] })}>
                  <option value="all">全周</option>
                  <option value="odd">单周</option>
                  <option value="even">双周</option>
                </select>
              </label>
              <label>具体周次
                <select
                  value={settings.weekNo ?? ''}
                  onChange={(event) => setSettings({ ...settings, weekNo: event.target.value ? Number(event.target.value) : null })}
                  title={weeks.length ? '可按学期周次导出某一周' : '先在“排课准备 → 学期周次”设置学期'}
                >
                  <option value="">不指定</option>
                  {weeks.map((week) => (
                    <option key={week.index} value={week.index}>{week.label}</option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
        </div>

        {batch ? (
          <p className="panel-note">
            {batchOutput === 'workbook'
              ? '批量导出按当前周次/单双周设置生成，每个班级/教师一张工作表；不支持整学期拆分。'
              : '批量导出按当前周次/单双周设置生成，每张课表单独保存；不支持整学期拆分。保存时会弹出文件夹选择窗口。'}
          </p>
        ) : settings.scope === 'semester' ? (
          <p className="panel-note">整学期导出会按实际课表去重：完全相同的周只生成一张工作表，有差异的周按周次标注。</p>
        ) : null}

        <div className="export-toggles">
          {batch || settings.view !== 'teacher' ? (
            <label><input type="checkbox" checked={settings.showTeacher} onChange={(event) => setSettings({ ...settings, showTeacher: event.target.checked })} /> 显示教师</label>
          ) : null}
          <label><input type="checkbox" checked={settings.showRoom} onChange={(event) => setSettings({ ...settings, showRoom: event.target.checked })} /> 显示教室</label>
          <label><input type="checkbox" checked={settings.showWeeks} onChange={(event) => setSettings({ ...settings, showWeeks: event.target.checked })} /> 单双周标记</label>
        </div>

        <div className="export-preview">
          {batch ? <p className="panel-note">下方为当前单个视图的样式预览；批量导出会按同一模板生成所有选中课表。</p> : null}
          {grid ? (
            <table className="export-preview-table">
              <tbody>
                {grid.rows.slice(0, Math.min(grid.rows.length, 5 + 4)).map((row, rowIndex) => (
                  <tr key={rowIndex} className={rowIndex < 3 ? 'is-title' : rowIndex === 4 ? 'is-head' : ''}>
                    {row.length === 0 ? <td colSpan={grid.days.length + 1} /> : row.map((cell, cellIndex) => <td key={cellIndex}>{String(cell)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="panel-note">当前设置无法生成预览。</p>}
        </div>

        {error ? <p className="inline-warning">{error}</p> : null}
        {busy ? (
          <div className="export-progress" role="status" aria-live="polite">
            <div className="export-progress-head">
              <b>
                {stage === 'writing'
                  ? batch && batchOutput === 'files'
                    ? '正在保存多个文件…'
                    : '正在写入文件…'
                  : batch
                    ? '正在生成批量课表…'
                    : '正在生成课表…'}
              </b>
              <span>
                {stage === 'writing'
                  ? batch && batchOutput === 'files'
                    ? '请在系统对话框中选择保存文件夹；保存完成前请勿关闭窗口。'
                    : '请等待保存完成后再打开文件，否则可能看到未写完的文件。'
                  : batch
                    ? batchProgress
                      ? '已生成 ' + batchProgress.done + '/' + batchProgress.total + (batchOutput === 'workbook' ? ' 张工作表。' : ' 个文件。')
                      : '正在按模板生成班级/教师课表…'
                    : '正在生成 Excel 网格与明细。'}
              </span>
            </div>
            <div className="export-progress-track">
              <span style={{ width: progressPercent + '%' }} />
            </div>
          </div>
        ) : null}
        <footer className="export-actions">
          <span>{batch && batchOutput === 'files' ? '建议文件夹：' : '文件名：'}{fileName}</span>
          <button type="button" className="ghost-button" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="action-button" onClick={() => void confirm()} disabled={busy || (batch && batchCount === 0)}>
            {busy
              ? '正在导出…'
              : batch
                ? '批量导出 ' + batchCount + (batchOutput === 'workbook' ? ' 张课表' : ' 个文件')
              : mode === 'publish'
                ? '导出批量课表并保存为正式版'
                  : '导出 Excel'} <span>↗</span>
          </button>
        </footer>
      </div>
    </div>
  );
}
