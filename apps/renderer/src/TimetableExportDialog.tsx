import React, { useMemo, useState } from 'react';
import type { SchoolData, SolverOutput } from './types';
import { SectionHeading } from './components';
import { buildTimetableGrid } from './timetableExport';
import type { TimetableExportSettings } from './timetableExport';
import { semesterWeeks } from '../../../packages/semester/src';

export function TimetableExportDialog({
  data,
  result,
  initialClassId,
  mode,
  onClose,
  onConfirm,
}: {
  data: SchoolData;
  result: SolverOutput;
  initialClassId: string;
  mode: 'export' | 'publish';
  onClose: () => void;
  onConfirm: (settings: TimetableExportSettings, onStage: (stage: 'generating' | 'writing') => void) => Promise<boolean>;
}) {
  const [settings, setSettings] = useState<TimetableExportSettings>({
    classId: initialClassId || data.classes[0]?.id || '',
    layout: 'vertical',
    schoolName: data.school.name,
    title: '班级课表',
    weeks: 'all',
    weekNo: null,
    showTeacher: true,
    showRoom: true,
    showWeeks: true,
  });
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'idle' | 'generating' | 'writing'>('idle');
  const [error, setError] = useState('');
  const weeks = semesterWeeks(data.semester);
  const grid = useMemo(() => {
    try {
      return buildTimetableGrid(data, result, settings);
    } catch {
      return null;
    }
  }, [data, result, settings]);

  const confirm = async () => {
    setBusy(true);
    setStage('generating');
    setError('');
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 40));
      const ok = await onConfirm(settings, (next) => setStage(next));
      if (ok) onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      setStage('idle');
    }
  };

  return (
    <div className="export-overlay" role="dialog" aria-modal="true" aria-label="导出课表">
      <div className="export-dialog">
        <header className="export-head">
          <SectionHeading english="EXPORT & LAYOUT" title={mode === 'publish' ? '导出并发布' : '导出课表'} />
          <button type="button" className="resource-workspace-close" onClick={onClose} aria-label="关闭">×</button>
        </header>
        <p className="panel-note">使用选定的纵向/横向课表模板导出，保留模板的字体、边框与页面布局（自动调整为 1 页宽）；不附加软件元数据。</p>

        <div className="export-form">
          <label>学校名称<input value={settings.schoolName} onChange={(event) => setSettings({ ...settings, schoolName: event.target.value })} /></label>
          <label>标题<input value={settings.title} onChange={(event) => setSettings({ ...settings, title: event.target.value })} /></label>
          <label>版式
            <select value={settings.layout} onChange={(event) => setSettings({ ...settings, layout: event.target.value as 'vertical' | 'horizontal' })}>
              <option value="vertical">纵向（A4 纵向）</option>
              <option value="horizontal">横向（A4 横向）</option>
            </select>
          </label>
          <label>班级
            <select value={settings.classId} onChange={(event) => setSettings({ ...settings, classId: event.target.value })}>
              {data.classes.map((klass) => <option key={klass.id} value={klass.id}>{klass.name}</option>)}
            </select>
          </label>
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
        </div>

        <div className="export-toggles">
          <label><input type="checkbox" checked={settings.showTeacher} onChange={(event) => setSettings({ ...settings, showTeacher: event.target.checked })} /> 显示教师</label>
          <label><input type="checkbox" checked={settings.showRoom} onChange={(event) => setSettings({ ...settings, showRoom: event.target.checked })} /> 显示教室</label>
          <label><input type="checkbox" checked={settings.showWeeks} onChange={(event) => setSettings({ ...settings, showWeeks: event.target.checked })} /> 单双周标记</label>
        </div>

        <div className="export-preview">
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
              <b>{stage === 'writing' ? '正在写入文件…' : '正在生成课表…'}</b>
              <span>
                {stage === 'writing'
                  ? '请等待保存完成后再打开文件，否则可能看到未写完的文件。'
                  : '正在生成 Excel 网格与明细。'}
              </span>
            </div>
            <div className="export-progress-track">
              <span style={{ width: stage === 'writing' ? '85%' : '40%' }} />
            </div>
          </div>
        ) : null}
        <footer className="export-actions">
          <span>
            文件名：{settings.schoolName || data.school.name}-
            {data.classes.find((klass) => klass.id === settings.classId)?.name ?? ''}-{settings.title || '课表'}
            {settings.weekNo ? '-第' + settings.weekNo + '周' : ''}-日期.xlsx
          </span>
          <button type="button" className="ghost-button" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="action-button" onClick={() => void confirm()} disabled={busy}>
            {busy ? '正在导出…' : mode === 'publish' ? '导出并保存为正式版' : '导出 Excel'} <span>↗</span>
          </button>
        </footer>
      </div>
    </div>
  );
}
