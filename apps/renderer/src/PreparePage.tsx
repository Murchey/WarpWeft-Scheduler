import React, { useState } from 'react';
import type { Commit, RuleInstance, SchoolData } from './types';
import { AvailabilityEditor } from './AvailabilityEditor';
import { PlansPage } from './PlansPage';
import { ElectivePage } from './ElectivePage';
import { ResourcesPage } from './ResourcesPage';
import { RulesPage } from './RulesPage';
import { SemesterPage } from './SemesterPage';
import { buildImportTemplate } from '../../../packages/import-export/src';
import { download, exportMessage } from './download';

export type PrepareSection = 'import' | 'classes' | 'teachers' | 'subjects' | 'rooms' | 'timeSlots' | 'semester' | 'plans' | 'electives' | 'availability' | 'rules';

function PreparePage({
  data,
  commit,
  issues,
  section,
  setSection,
  setError,
  setNotice,
  onGoRun,
  onSimulate,
}: {
  data: SchoolData;
  commit: Commit;
  issues: string[];
  section: PrepareSection;
  setSection: (value: PrepareSection) => void;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
  onGoRun: () => void;
  onSimulate: (rule: RuleInstance) => Promise<{ entries: number; total: number; before: number; feasible: boolean; elapsedMs: number } | null>;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const unavailableCount = data.teachers.filter((teacher) => (data.unavailableSlots ?? []).some((item) => item.teacherId === teacher.id)).length;
  const items: { id: PrepareSection; label: string; english: string; count: string }[] = [
    { id: 'import', label: '数据导入', english: 'IMPORT', count: 'Excel' },
    { id: 'classes', label: '班级', english: 'CLASSES', count: String(data.classes.length) },
    { id: 'teachers', label: '教师', english: 'TEACHERS', count: String(data.teachers.length) },
    { id: 'subjects', label: '学科', english: 'SUBJECTS', count: String(data.subjects.length) },
    { id: 'rooms', label: '教室', english: 'ROOMS', count: String(data.rooms.length) },
    { id: 'timeSlots', label: '时间段', english: 'TIME SLOTS', count: String(data.timeSlots.length) },
    { id: 'semester', label: '学期周次', english: 'SEMESTER', count: data.semester ? '已设置' : '未设置' },
    { id: 'plans', label: '教学计划', english: 'COURSE PLANS', count: String(data.coursePlans.length) },
    { id: 'electives', label: '走班组', english: 'ELECTIVES', count: String((data.electiveGroups ?? []).length) },
    { id: 'availability', label: '教师时间', english: 'AVAILABILITY', count: unavailableCount > 0 ? unavailableCount + ' 人' : '未设置' },
    { id: 'rules', label: '排课规则', english: 'RULES', count: (data.rules ?? []).length > 0 ? (data.rules ?? []).length + ' 条' : '系统保证' },
  ];
  const selectSection = (next: PrepareSection) => {
    setSection(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', '排课准备');
    url.searchParams.set('section', next);
    window.history.replaceState(null, '', url);
  };
  const exportTemplate = async () => {
    if (templateBusy) return;
    setTemplateBusy(true);
    setError('');
    try {
      const bytes = buildImportTemplate({ ...data, schoolName: data.school.name });
      const result = await download(
        bytes,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'warpweft-data-' + new Date().toISOString().slice(0, 10) + '.xlsx',
      );
      const message = exportMessage(result, '数据模板');
      if (!message) return;
      if (message.tone === 'error') setError(message.text);
      else setNotice(message.text);
    } catch (cause) {
      setError('导出数据模板失败：' + (cause instanceof Error ? cause.message : String(cause)));
    } finally {
      setTemplateBusy(false);
    }
  };
  const resourceKinds = ['import', 'classes', 'teachers', 'subjects', 'rooms', 'timeSlots'] as const;
  const isResource = resourceKinds.includes(section as (typeof resourceKinds)[number]);
  return (
    <div className="prepare-layout">
      <aside className="prepare-nav" aria-label="排课准备子导航">
        <div className="prepare-nav-head">
          <span className="kicker">// PREPARE</span>
          <strong>数据与规则</strong>
          <small>所有排课前的资料集中在这里，不再来回切换页面。</small>
        </div>
        <div className="prepare-nav-list">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={'prepare-nav-item' + (section === item.id ? ' active' : '')}
              onClick={() => item.id === 'import' ? setImportOpen(true) : selectSection(item.id)}
              aria-current={section === item.id ? 'page' : undefined}
            >
              <span><b>{item.label}</b><em>{item.english}</em></span>
              <small>{item.count}</small>
            </button>
          ))}
        </div>
        <div className={issues.length > 0 ? 'prepare-nav-check has-issues' : 'prepare-nav-check'}>
          <span>{issues.length > 0 ? '还有 ' + issues.length + ' 项待处理' : '数据检查通过'}</span>
          <small>{issues[0] ?? '可以进入排课任务'}</small>
        </div>
      </aside>
      <div className="prepare-content">
        <div className="prepare-head">
          <div>
            <span className="kicker">// PREPARE WORKSPACE</span>
            <h2>排课准备</h2>
            <p>导入、基础资料、教学计划、教师时间和规则都在同一个工作区；左侧切换不会丢失数据。</p>
          </div>
          <div className="prepare-head-actions">
            <button type="button" className="ghost-button" onClick={() => void exportTemplate()} disabled={templateBusy}>
              {templateBusy ? '正在导出模板…' : '导出当前数据模板'}
            </button>
            <button type="button" className="action-button" onClick={() => setImportOpen(true)}>导入 Excel <span>↗</span></button>
          </div>
        </div>
        {section === 'semester' ? (
          <SemesterPage data={data} commit={commit} />
        ) : section === 'plans' ? (
          <PlansPage data={data} commit={commit} setError={setError} setNotice={setNotice} />
        ) : section === 'electives' ? (
          <ElectivePage data={data} commit={commit} setError={setError} />
        ) : section === 'availability' ? (
          <AvailabilityEditor data={data} commit={commit} />
        ) : section === 'rules' ? (
          <RulesPage data={data} commit={commit} setError={setError} onSimulate={onSimulate} />
        ) : isResource ? (
          <ResourcesPage data={data} commit={commit} setError={setError} setNotice={setNotice} kind={section as (typeof resourceKinds)[number]} />
        ) : null}
        <div className={issues.length > 0 ? 'prepare-readiness has-issues' : 'prepare-readiness'}>
          <div><span>数据检查</span><strong>{issues.length > 0 ? issues.length + ' 项待处理' : '通过'}</strong><small>{issues[0] ?? '基础资料和教学计划已就绪'}</small></div>
          <button type="button" className="action-button" onClick={onGoRun}>去排课任务 <span>→</span></button>
        </div>
      </div>
      {importOpen ? (
        <div className="import-overlay" role="dialog" aria-modal="true">
          <div className="import-drawer">
            <div className="import-drawer-head"><div><span className="kicker">// IMPORT</span><h2>导入 Excel</h2></div><button type="button" className="banner-close" onClick={() => setImportOpen(false)} aria-label="关闭导入">×</button></div>
            <ResourcesPage data={data} commit={commit} setError={setError} setNotice={setNotice} kind="import" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export { PreparePage };




