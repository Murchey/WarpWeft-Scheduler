import React, { useMemo, useState } from 'react';
import type { RuleImportance, RuleInstance, RuleKind, RuleScope, RuleTime, SchoolData } from './types';
import {
  IMPORTANCE_LABELS,
  RULE_DEFINITIONS,
  SYSTEM_RULES,
  createRule,
  definitionOf,
  describeRule,
  findRuleConflicts,
  ruleImpact,
  ruleWarnings,
  scopeLabel,
  timeLabel,
} from './rules';
import { SoftConstraintPanel } from './SoftConstraintPanel';

function RulesPage({
  data,
  commit,
  setError,
  onSimulate,
}: {
  data: SchoolData;
  commit: (next: SchoolData, options?: { invalidate?: boolean; immediate?: boolean }) => void;
  setError: (value: string) => void;
  onSimulate: (rule: RuleInstance) => Promise<{ entries: number; total: number; before: number; feasible: boolean; elapsedMs: number } | null>;
}) {
  const rules = data.rules ?? [];
  const [filter, setFilter] = useState<'all' | 'teacher' | 'subject' | 'structure'>('all');
  const [draft, setDraft] = useState<RuleInstance | null>(null);
  const [simulating, setSimulating] = useState('');
  const [simulations, setSimulations] = useState<Record<string, string>>({});
  const saveRules = (next: RuleInstance[]) => {
    if (data.candidate && !window.confirm('应用规则修改将清除当前候选课表，包括锁定课程和手动调整，需重新排课。正式版保留。确认应用？取消会保留当前编辑内容。')) return false;
    commit({ ...data, rules: next }, { invalidate: true });
    setSimulations({});
    return true;
  };
  const visible = rules.filter((rule) => filter === 'all' || definitionOf(rule.kind).category === filter);
  const enabled = rules.filter((rule) => rule.enabled).length;
  const warned = rules.filter((rule) => rule.enabled && ruleWarnings(rule, data, rules).some((warning) => !warning.startsWith('设为“必须”'))).length;
  const conflicts = findRuleConflicts(data);
  const openNew = (kind: RuleKind) => {
    if (!data.teachers.length && definitionOf(kind).scopeType === 'teacher') {
      setError('请先在排课准备中添加教师');
      return;
    }
    if (!data.subjects.length && definitionOf(kind).scopeType === 'subject') {
      setError('请先在排课准备中添加学科');
      return;
    }
    setError('');
    setDraft(createRule(data, kind));
  };
  const saveDraft = (next: RuleInstance) => {
    const exists = rules.some((rule) => rule.id === next.id);
    if (exists) {
      if (!saveRules(rules.map((rule) => rule.id === next.id ? next : rule))) return;
    } else {
      if (!saveRules([...rules, next])) return;
    }
    setDraft(null);
  };
  const simulate = async (rule: RuleInstance) => {
    setSimulating(rule.id);
    const result = await onSimulate(rule);
    setSimulating('');
    if (!result) return;
    const delta = result.before > 0 ? result.entries - result.before : 0;
    const text = result.feasible
      ? '放宽后可排 ' + result.entries + '/' + result.total + ' 课时' + (delta > 0 ? '，预计多排 ' + delta + ' 课时' : '')
      : '放宽后仍缺 ' + Math.max(0, result.total - result.entries) + ' 课时，可继续检查其他规则';
    setSimulations((current) => ({ ...current, [rule.id]: text + '（' + result.elapsedMs + ' ms）' }));
  };
  const removeRule = (rule: RuleInstance) => {
    if (!window.confirm('删除这条规则？已生成的候选课表会失效。')) return;
    saveRules(rules.filter((item) => item.id !== rule.id));
  };
  const toggleRule = (rule: RuleInstance) => {
    saveRules(rules.map((item) => item.id === rule.id ? { ...item, enabled: !item.enabled } : item));
  };
  const availableKinds = RULE_DEFINITIONS.filter((definition) => definition.available);
  return (
    <div className="rules-page">
      <section className="section-panel rules-panel">
        <div className="rules-head">
          <div>
            <span className="kicker">// SCHEDULE POLICIES</span>
            <h2>排课规则</h2>
            <p>用“必须 / 尽量 / 避免”表达学校政策；系统硬规则由求解器自动保证。</p>
          </div>
          <div className="rules-head-meta">
            <span><b>{enabled}</b> 条启用</span>
            <span><b>{rules.length}</b> 条自定义</span>
            <span className={warned > 0 ? 'rules-warn-count' : ''}><b>{warned}</b> 条提醒</span>
            <span><b>{SYSTEM_RULES.length}</b> 条系统保证</span>
          </div>
        </div>
        <div className="rules-toolbar">
          <div className="rules-filter" role="tablist" aria-label="规则分类">
            {[
              ['all', '全部'],
              ['teacher', '教师'],
              ['subject', '课程'],
              ['structure', '结构'],
            ].map(([value, label]) => (
              <button key={value} type="button" className={filter === value ? 'rules-filter-item active' : 'rules-filter-item'} onClick={() => setFilter(value as typeof filter)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="section-panel rules-soft-panel">
        <SoftConstraintPanel data={data} commit={commit} />
      </section>

      {conflicts.length > 0 ? (
        <section className="section-panel rule-conflicts">
          <div className="rule-conflicts-head"><div><span className="kicker">// CONFLICT CHECK</span><h3>规则冲突与提醒</h3></div><span className="status-tag danger">{conflicts.length} 项</span></div>
          {conflicts.map((conflict) => {
            const titles = conflict.ruleIds.map((id) => rules.find((rule) => rule.id === id)).filter(Boolean).map((rule) => describeRule(rule!, data)).join(' / ');
            return <div className="rule-conflict" key={conflict.ruleIds.join('-') + conflict.message}><b>{titles || '规则'}</b><p>{conflict.message}</p></div>;
          })}
          <p className="panel-note">这是基于规则参数和教学计划的近似检测，不是求解器的完整不可行证明。</p>
        </section>
      ) : null}

      <section className="section-panel rules-create">
        <div className="rules-create-head">
          <div>
            <span className="kicker">// CREATE RULE</span>
            <h3>新建规则</h3>
            <p>先选规则类型，再设置对象、条件和“必须 / 尽量 / 避免”。系统硬规则已由求解器自动保证。</p>
          </div>
          <span className="status-tag">{availableKinds.length} 种可用</span>
        </div>
        <div className="rules-create-grid">
          {availableKinds.map((definition) => (
            <button key={definition.kind} type="button" className="rules-create-card" onClick={() => openNew(definition.kind)}>
              <span className="rules-create-cat">
                {definition.category === 'teacher' ? '教师' : definition.category === 'subject' ? '课程' : '结构'}
              </span>
              <b>{definition.label}</b>
              <small>{definition.description}</small>
              <em>+ 新建</em>
            </button>
          ))}
        </div>
      </section>

      {visible.length === 0 ? (
        <section className="section-panel rules-empty">
          <span className="kicker">// NO CUSTOM RULES</span>
          <h3>还没有自定义规则</h3>
          <p>先从“学科每日上限”或“学科时间偏好”开始；系统硬规则已经自动保证。</p>
        </section>
      ) : (
        <div className="rules-list">
          {visible.map((rule) => {
            const definition = definitionOf(rule.kind);
            const impact = ruleImpact(rule, data);
            const warnings = ruleWarnings(rule, data, rules);
            return (
              <article className={rule.enabled ? 'section-panel rule-card' : 'section-panel rule-card is-disabled'} key={rule.id}>
                <div className="rule-card-head">
                  <div>
                    <div className="rule-card-kicker"><span>{definition.category === 'teacher' ? '教师' : definition.category === 'subject' ? '课程' : '结构'}</span><span className="rule-kind">{definition.label}</span></div>
                    <h3>{describeRule(rule, data)}</h3>
                  </div>
                  <span className={rule.enabled ? 'status-tag' : 'status-tag muted'}>{rule.enabled ? '已启用' : '已停用'}</span>
                </div>
                <div className="rule-card-facts">
                  <span><b>范围</b>{scopeLabel(rule, data)}</span>
                  <span><b>时间</b>{timeLabel(rule)}</span>
                  <span><b>{rule.kind === 'SUBJECT_AVOID_FIRST_LAST' ? '倾向' : '程度'}</b>{IMPORTANCE_LABELS[rule.importance]}</span>
                  <span><b>影响</b>{impact.classes} 班 / {impact.lessons} 课时</span>
                </div>
                {warnings.length > 0 ? (
                  <div className="rule-warnings">
                    {warnings.map((warning) => <p key={warning}>{warning}</p>)}
                  </div>
                ) : null}
                {simulations[rule.id] ? <p className="rule-simulation">{simulations[rule.id]}</p> : null}
                <div className="rule-card-actions">
                  <button type="button" className="mini-button" onClick={() => setDraft({ ...rule })}>编辑</button>
                  {rule.enabled && definition.available ? <button type="button" className="ghost-button rule-toggle" onClick={() => void simulate(rule)} disabled={simulating === rule.id}>{simulating === rule.id ? '模拟中…' : '模拟放宽'}</button> : null}
                  <button type="button" className="ghost-button rule-toggle" onClick={() => toggleRule(rule)}>{rule.enabled ? '停用' : '启用'}</button>
                  <button type="button" className="danger-link" onClick={() => removeRule(rule)}>删除</button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <details className="section-panel rules-system">
        <summary><span>系统保证（{SYSTEM_RULES.length}）</span><small>由求解器自动满足，不需要配置</small></summary>
        <div className="rules-system-grid">
          {SYSTEM_RULES.map(([title, detail]) => (
            <div className="rules-system-item" key={title}><span>✓</span><div><b>{title}</b><small>{detail}</small></div></div>
          ))}
        </div>
      </details>

      <div className="rules-note">
        <span className="status-dot" />
        <p>“尽量 / 避免”是偏好，允许求解器在不违反系统硬规则的前提下权衡；“必须”若造成无解，会在排课任务中提示。</p>
      </div>

      {draft ? (
        <RuleBuilder
          data={data}
          draft={draft}
          allRules={rules}
          onClose={() => setDraft(null)}
          onSave={saveDraft}
        />
      ) : null}
    </div>
  );
}

function RuleBuilder({
  data,
  draft,
  allRules,
  onClose,
  onSave,
}: {
  data: SchoolData;
  draft: RuleInstance;
  allRules: RuleInstance[];
  onClose: () => void;
  onSave: (rule: RuleInstance) => void;
}) {
  const [rule, setRule] = useState<RuleInstance>(draft);
  const [formError, setFormError] = useState('');
  const definition = definitionOf(rule.kind);
  const warnings = useMemo(() => ruleWarnings({ ...rule, id: draft.id, enabled: true }, data, allRules), [rule, data, allRules, draft.id]);
  const impact = ruleImpact(rule, data);
  const update = (patch: Partial<RuleInstance>) => setRule((current) => ({ ...current, ...patch }));
  const updateParam = (key: string, value: string | number) => setRule((current) => ({ ...current, params: { ...current.params, [key]: value } }));
  const scopeChoices = definition.scopeType === 'teacher' ? data.teachers : data.subjects;
  const updateScope = (id: string) => {
    const scope: RuleScope = definition.scopeType === 'teacher'
      ? { type: 'teacher', teacherId: id }
      : { type: 'subject', subjectId: id };
    update({ scope });
  };
  const updateTime = (type: 'all' | 'weekday') => {
    const time: RuleTime = type === 'all' ? { type: 'all' } : { type: 'weekday', days: [1, 2, 3, 4, 5] };
    update({ time });
  };
  const toggleDay = (day: number) => {
    if (rule.time.type !== 'weekday') return;
    const days = rule.time.days.includes(day) ? rule.time.days.filter((item) => item !== day) : [...rule.time.days, day];
    update({ time: { type: 'weekday', days } });
  };
  const save = () => {
    setFormError('');
    if (scopeChoices.length === 0) {
      setFormError('请先选择' + (definition.scopeType === 'teacher' ? '教师' : '学科'));
      return;
    }
    if (rule.time.type === 'weekday' && rule.time.days.length === 0) {
      setFormError('请至少选择一个适用星期');
      return;
    }
    if (definition.paramFields.some((field) => field.type === 'number' && Number(rule.params[field.key]) < (field.min ?? 1))) {
      setFormError('数值必须大于等于 ' + (definition.paramFields.find((field) => field.type === 'number')?.min ?? 1));
      return;
    }
    onSave({ ...rule, source: rule.source === 'migration' ? 'migration' : 'manual' });
  };
  return (
    <div className="rule-overlay" role="dialog" aria-modal="true">
      <div className="rule-dialog">
        <div className="rule-dialog-head">
          <div><span className="kicker">// RULE BUILDER</span><h2>{draft.id && allRules.some((item) => item.id === draft.id) ? '编辑规则' : '新建规则'}</h2><p>用一句话描述政策，系统会把它翻译成求解条件。</p></div>
          <button type="button" className="banner-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="rule-dialog-body">
          <div className="rule-sentence">
            <label>对象
              <select value={definition.scopeType === 'teacher' ? (rule.scope.type === 'teacher' ? rule.scope.teacherId : '') : (rule.scope.type === 'subject' ? rule.scope.subjectId : '')} onChange={(event) => updateScope(event.target.value)}>
                <option value="">选择{definition.scopeType === 'teacher' ? '教师' : '学科'}</option>
                {scopeChoices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>时间
              <select value={rule.time.type} onChange={(event) => updateTime(event.target.value as 'all' | 'weekday')}>
                <option value="all">全周</option>
                <option value="weekday">指定星期</option>
              </select>
            </label>
            <label>{definition.importanceOptions.length === 1 && definition.importanceOptions[0] === 'avoid' ? '倾向' : '程度'}
              <select value={rule.importance} onChange={(event) => update({ importance: event.target.value as RuleImportance })}>
                {definition.importanceOptions.map((value) => <option key={value} value={value}>{IMPORTANCE_LABELS[value]}</option>)}
                {!definition.importanceOptions.includes(rule.importance) ? (
                  <option value={rule.importance}>{IMPORTANCE_LABELS[rule.importance]}（旧规则）</option>
                ) : null}
              </select>
            </label>
          </div>
          {rule.time.type === 'weekday' ? (
            <div className="rule-days">
              <span>适用星期</span>
              {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((label, index) => (
                <button key={label} type="button" className={rule.time.type === 'weekday' && rule.time.days.includes(index + 1) ? 'rule-day active' : 'rule-day'} onClick={() => toggleDay(index + 1)}>{label}</button>
              ))}
            </div>
          ) : null}
          <div className="rule-params">
            {definition.paramFields.map((field) => (
              <label key={field.key}>{field.label}
                {field.type === 'number' ? (
                  <input type="number" min={field.min} max={field.max} value={Number(rule.params[field.key] ?? field.min ?? 1)} onChange={(event) => updateParam(field.key, Number(event.target.value))} />
                ) : (
                  <select value={String(rule.params[field.key] ?? '')} onChange={(event) => updateParam(field.key, event.target.value)}>
                    {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                )}
              </label>
            ))}
          </div>
          <div className="rule-preview">
            <span>预览</span>
            <strong>{describeRule(rule, data)}</strong>
            <small>{impact.classes} 个班 · {impact.teachers} 位教师 · {impact.lessons} 课时</small>
          </div>
          {!definition.available ? <div className="rule-warnings"><p>{definition.supportNote ?? '当前版本暂未接入这条规则。'}</p></div> : null}
          {formError ? <div className="rule-warnings"><p>{formError}</p></div> : null}
          {warnings.length > 0 ? <div className="rule-warnings">{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}
          <label className="rule-note">备注<input value={rule.note ?? ''} onChange={(event) => update({ note: event.target.value })} placeholder="可选：说明这条规则的背景" /></label>
        </div>
        <div className="rule-dialog-actions">
          <button type="button" className="ghost-button" onClick={onClose}>取消</button>
          <button type="button" className="action-button" onClick={save} disabled={scopeChoices.length === 0}>保存规则</button>
        </div>
      </div>
    </div>
  );
}

export { RulesPage };

