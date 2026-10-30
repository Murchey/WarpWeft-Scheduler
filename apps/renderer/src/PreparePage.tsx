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
import { useI18n } from './i18n';
import type { MessageKey } from './i18n';

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
  onLoadWorkspace,
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
  onLoadWorkspace: (next: SchoolData) => void;
}) {
  const { t } = useI18n();
  const [importOpen, setImportOpen] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const unavailableCount = data.teachers.filter((teacher) => (data.unavailableSlots ?? []).some((item) => item.teacherId === teacher.id)).length;
  const items: { id: PrepareSection; labelKey: MessageKey; count: string }[] = [
    { id: 'import', labelKey: 'prepare.section.import', count: 'Excel' },
    { id: 'classes', labelKey: 'prepare.section.classes', count: String(data.classes.length) },
    { id: 'teachers', labelKey: 'prepare.section.teachers', count: String(data.teachers.length) },
    { id: 'subjects', labelKey: 'prepare.section.subjects', count: String(data.subjects.length) },
    { id: 'rooms', labelKey: 'prepare.section.rooms', count: String(data.rooms.length) },
    { id: 'timeSlots', labelKey: 'prepare.section.timeSlots', count: String(data.timeSlots.length) },
    { id: 'semester', labelKey: 'prepare.section.semester', count: data.semester ? t('prepare.countConfigured') : t('prepare.countUnset') },
    { id: 'plans', labelKey: 'prepare.section.plans', count: String(data.coursePlans.length) },
    { id: 'electives', labelKey: 'prepare.section.electives', count: String((data.electiveGroups ?? []).length) },
    { id: 'availability', labelKey: 'prepare.section.availability', count: unavailableCount > 0 ? t('prepare.countPeople', { count: unavailableCount }) : t('prepare.countUnset') },
    { id: 'rules', labelKey: 'prepare.section.rules', count: (data.rules ?? []).length > 0 ? t('prepare.countRules', { count: (data.rules ?? []).length }) : t('prepare.countSystem') },
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
      const bytes = await buildImportTemplate({ ...data, schoolName: data.school.name });
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
      <aside className="prepare-nav" aria-label={t('prepare.subnavAria')}>
        <div className="prepare-nav-head">
          <strong>{t('prepare.navHead')}</strong>
          <small>{t('prepare.navHeadHint')}</small>
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
              <span><b>{t(item.labelKey)}</b></span>
              <small>{item.count}</small>
            </button>
          ))}
        </div>
        <div className={issues.length > 0 ? 'prepare-nav-check has-issues' : 'prepare-nav-check'}>
          <span>{issues.length > 0 ? t('prepare.checkPending', { count: issues.length }) : t('prepare.checkPassed')}</span>
          <small>{issues[0] ?? t('prepare.checkReady')}</small>
        </div>
      </aside>
      <div className="prepare-content">
        <div className="prepare-head">
          <div>
            <h2>{t('nav.prepare')}</h2>
            <p>{t('prepare.lead')}</p>
          </div>
          <div className="prepare-head-actions">
            <button type="button" className="ghost-button" onClick={() => void exportTemplate()} disabled={templateBusy}>
              {templateBusy ? t('prepare.exporting') : t('prepare.exportTemplate')}
            </button>
            <button type="button" className="action-button" onClick={() => setImportOpen(true)}>{t('prepare.importExcel')} <span>↗</span></button>
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
          <ResourcesPage data={data} commit={commit} setError={setError} setNotice={setNotice} onLoadWorkspace={onLoadWorkspace} kind={section as (typeof resourceKinds)[number]} />
        ) : null}
        <div className={issues.length > 0 ? 'prepare-readiness has-issues' : 'prepare-readiness'}>
          <div><span>{t('prepare.checkPassed')}</span><strong>{issues.length > 0 ? t('prepare.issuesPending', { count: issues.length }) : t('prepare.checkOk')}</strong><small>{issues[0] ?? t('prepare.checkOkHint')}</small></div>
          <button type="button" className="action-button" onClick={onGoRun}>{t('prepare.goRun')} <span>→</span></button>
        </div>
      </div>
      {importOpen ? (
        <div className="import-overlay" role="dialog" aria-modal="true">
          <div className="import-drawer">
            <div className="import-drawer-head"><div><h2>{t('prepare.importExcel')}</h2></div><button type="button" className="banner-close" onClick={() => setImportOpen(false)} aria-label={t('prepare.closeImport')}>×</button></div>
            <ResourcesPage data={data} commit={commit} setError={setError} setNotice={setNotice} onLoadWorkspace={onLoadWorkspace} kind="import" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export { PreparePage };




