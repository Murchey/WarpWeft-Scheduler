import React, { useCallback, useRef, useState } from 'react';
import type { RunMode, SchoolData, SolverInput, SolverOutput } from './types';
import type { RunProgress, ShortRunRecord } from './runConfig';
import { RUN_MODE_OPTIONS, runResultText, runStatusText } from './runConfig';
import { SectionHeading } from './components';
import { EmptyState, MissingReasons, RunProgressView } from './runViews';
import { missingPlans } from './selectors';
import { activeRules, describeRule } from './rules';
import { LongRunPanel } from './LongRunPanel';
import { ShortRunDialog } from './ShortRunDialog';
import type { LongJob, LongJobDetail } from './api';

export function RunsPage({
  data, result, issues, running, progress, timeLimit, setTimeLimit, onRun, onRepair, onTimetable, onClear, runMode, shortRuns, onDeleteShortRun, inputFactory, onApplyLongResult, onNotice, onError,
}: {
  data: SchoolData; result: SolverOutput | null; issues: string[]; running: boolean; progress: RunProgress;
  timeLimit: number; setTimeLimit: (value: number) => void; onRun: () => void;
  onRepair: (scope: 'class' | 'teacher' | 'rule', id: string) => Promise<void>;
  onTimetable: () => void; onClear: () => void; runMode?: RunMode | null;
  shortRuns: ShortRunRecord[];
  onDeleteShortRun: (id: string) => void;
  inputFactory: (seconds: number) => SolverInput;
  onApplyLongResult: (job: LongJobDetail) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const expected = data.coursePlans.reduce((sum, plan) => sum + Number(plan.weeklyPeriods || 0), 0);
  const availableTotal = data.classes.length * data.timeSlots.length;
  const missing = result ? missingPlans(data, result) : [];
  const [repairScope, setRepairScope] = useState<'class' | 'teacher' | 'rule'>('class');
  const [repairId, setRepairId] = useState(data.classes[0]?.id ?? '');
  const [computeMode, setComputeMode] = useState<'short' | 'long'>('short');
  const [longSeconds, setLongSeconds] = useState(3600);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [longActive, setLongActive] = useState(false);
  const [longJobs, setLongJobs] = useState<LongJob[]>([]);
  const [viewingShortRun, setViewingShortRun] = useState<ShortRunRecord | null>(null);
  const longStartRef = useRef<() => Promise<void>>(async () => {});
  const registerLongStart = useCallback((start: () => Promise<void>) => {
    longStartRef.current = start;
  }, []);
  const startSelected = () => {
    if (computeMode === 'long') {
      void longStartRef.current();
      return;
    }
    onRun();
  };
  const repairEntities = repairScope === 'class'
    ? data.classes
    : repairScope === 'teacher'
      ? data.teachers
      : (data.rules ?? []).map((rule) => ({ id: rule.id, name: describeRule(rule, data) }));
  const currentRepairId = repairEntities.some((item) => item.id === repairId) ? repairId : (repairEntities[0]?.id ?? '');
  const checked = issues.length === 0;
  const canConfigure = checked && !running;
  const lockedCount = data.candidate?.entries.filter((entry) => entry.locked).length ?? 0;
  const modeLabel = RUN_MODE_OPTIONS.find((item) => item.value === runMode)?.title ?? '当前模式';
  const removeShortRun = (run: ShortRunRecord) => {
    if (!window.confirm('删除这条短时计算记录？仅移除本次会话的历史记录，不影响当前候选课表、正式版课表或长时任务。')) return;
    onDeleteShortRun(run.id);
    setViewingShortRun((current) => (current?.id === run.id ? null : current));
  };
  const recentTasks: {
    key: string;
    kind: string;
    at: string;
    title: string;
    detail: string;
    ok: boolean;
    run: ShortRunRecord | null;
  }[] = [
    ...shortRuns.map((run) => ({
      key: 'short-' + run.id,
      kind: '短时',
      at: run.createdAt,
      title: (run.mode === 'repair' ? '局部重排 · ' : '短时计算 · ') + runResultText(run.status, run.result.outcome),
      detail: run.entries + ' 条 · ' + run.elapsedMs + ' ms · 时限 ' + run.timeLimitSeconds + ' 秒',
      ok: run.feasible,
      run,
    })),
    ...longJobs.map((item) => ({
      key: 'long-' + item.id,
      kind: '长时',
      at: item.createdAt,
      title: '长时任务 · ' + runStatusText(item.status),
      detail: item.placed + '/' + item.total + ' 课时 · ' + item.id,
      ok: item.status === 'completed',
      run: null,
    })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 3);

  return (
    <div className="runs-wizard">
      <section className="section-panel wizard-intro">
        <SectionHeading english="SCHEDULE RUN" title="排课向导" />
        <p className="panel-note">按 01 → 02 → 03 → 04 完成配置。数据检查未通过时，后续步骤会锁定。</p>
        <div className="wizard-stepper">
          {['数据检查', '排课规则', '计算设置', '开始排课'].map((label, index) => (
            <div key={label} className={'wizard-stepper-item ' + (index === 0 && checked || index > 0 && canConfigure ? 'done' : '')}>
              <b>0{index + 1}</b><span>{label}</span>
            </div>
          ))}
        </div>
        {progress.phase !== 'idle' ? <RunProgressView progress={progress} /> : null}
      </section>

      <div className="wizard-grid">
        <section className="section-panel wizard-card">
          <div className="wizard-card-head">
            <span className="wizard-number">01</span>
            <div><span className="kicker">PREFLIGHT</span><h2>数据检查</h2></div>
            <span className={issues.length ? 'status-tag danger' : 'status-tag'}>{issues.length ? issues.length + ' 项待处理' : '通过'}</span>
          </div>
          {issues.length ? <ul className="issue-list">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : (
            <>
              <p className="panel-note success-note">检查通过：{expected} 周课时、{data.timeSlots.length} 个可用时间格。</p>
              {availableTotal > expected ? (
                <p className="panel-note">
                  按当前计划平均每班 {(expected / Math.max(1, data.classes.length)).toFixed(1)} 节，可用 {data.timeSlots.length} 格，剩余 {availableTotal - expected} 格属于结构性空余。
                  如需填满，可增加教学计划（例如自习、课后服务）或减少每天节数。
                </p>
              ) : null}
            </>
          )}
          <div className="hero-actions"><button className="ghost-button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>回到顶部查看状态</button></div>
        </section>

        <section className={'section-panel wizard-card ' + (!checked ? 'wizard-locked' : '')}>
          <div className="wizard-card-head"><span className="wizard-number">02</span><div><span className="kicker">BUILT-IN RULES</span><h2>排课规则</h2></div><span className="status-tag">{checked ? '自动保证' : '待检查'}</span></div>
          {!checked ? <p className="panel-note">请先修复第 01 步的问题。</p> : (
            <>
              <div className="rule-summary">
                {[
                  ['01', '班级不撞课', '同一班级同一时间只安排一门课'],
                  ['02', '教师不撞课', '同一教师同一时间只安排一门课'],
                  ['03', '教室匹配', '教室类型和容量必须满足班级'],
                  ['04', '固定约束', '固定时间和教师不可用时间自动生效'],
                ].map(([number, title, description]) => (
                  <div className="rule-item" key={number}><span>{number}</span><div><b>{title}</b><small>{description}</small></div><em>自动</em></div>
                ))}
              </div>
              <p className="panel-note">这些是硬性规则，不需要手动配置；求解器会优先保证。当前已启用 <b>{activeRules(data).length}</b> 条自定义偏好规则。</p>
            </>
          )}
        </section>

        <section className={'section-panel wizard-card ' + (!checked ? 'wizard-locked' : '')}>
          <div className="wizard-card-head"><span className="wizard-number">03</span><div><span className="kicker">SOLVER SETTINGS</span><h2>计算设置</h2></div><span className="status-tag">{!checked ? '待检查' : computeMode === 'long' ? '长时任务' : '已就绪'}</span></div>
          {!checked ? <p className="panel-note">完成数据检查后配置计算方式。</p> : (
            <>
              <div className="compute-mode" role="group" aria-label="运行方式">
                <button type="button" className={computeMode === 'short' ? 'active' : ''} onClick={() => setComputeMode('short')} aria-pressed={computeMode === 'short'}>短时计算</button>
                <button type="button" className={computeMode === 'long' ? 'active' : ''} onClick={() => setComputeMode('long')} aria-pressed={computeMode === 'long'}>长时任务</button>
              </div>
              {computeMode === 'short' ? (
                <>
                  <div className="run-controls"><label>计算时限<select value={timeLimit} disabled={!canConfigure} onChange={(event) => setTimeLimit(Number(event.target.value))}><option value={10}>10 秒</option><option value={30}>30 秒</option><option value={60}>60 秒</option><option value={120}>120 秒</option></select></label></div>
                  {expected > 400 ? <p className="panel-note">本次 {expected} 课时，建议选 60–120 秒。增加时限可以尝试更多随机起点；未排满还可能与固定时间、教师时间或规则组合有关，请先检查未排项再决定是否放宽规则。</p> : null}
                  <div className="config-summary"><span>运行模式<strong>{modeLabel}</strong></span><span>锁定课程<strong>{lockedCount}</strong></span><span>可用时间格<strong>{data.timeSlots.length}</strong></span></div>
                </>
              ) : (
                <>
                  <div className="run-controls"><label>任务时限<select value={longSeconds} disabled={!canConfigure} onChange={(event) => setLongSeconds(Number(event.target.value))}><option value={1800}>30 分钟</option><option value={3600}>1 小时</option><option value={7200}>2 小时</option><option value={21600}>6 小时（上限）</option></select></label></div>
                  <p className="panel-note">长时任务在后台持续优化，可暂停/继续；检查点会写入服务端。启动入口统一在第 04 步，任务状态和历史在下方“任务与历史”面板展开查看。</p>
                  <div className="config-summary"><span>运行模式<strong>{modeLabel}</strong></span><span>锁定课程<strong>{lockedCount}</strong></span><span>可用时间格<strong>{data.timeSlots.length}</strong></span></div>
                </>
              )}
            </>
          )}
        </section>

        <section className={'section-panel wizard-card wizard-final ' + (!checked ? 'wizard-locked' : '')}>
          <div className="wizard-card-head"><span className="wizard-number">04</span><div><span className="kicker">RUN SCHEDULE</span><h2>开始排课</h2></div><span className={computeMode === 'long' ? 'status-tag' : result?.hasFeasibleSolution ? 'status-tag' : 'status-tag muted'}>{computeMode === 'long' ? '长时任务' : result ? result.status : '尚未运行'}</span></div>
          {computeMode === 'long' ? (
            <p className="panel-note">点击下方按钮会按当前工作区数据启动一个新的长时任务；暂停、继续、载入最佳课表和历史任务都在下方“任务与历史”面板中。</p>
          ) : result && lockedCount > 0 ? (
            <p className="panel-note">本次重新排课将保留 {lockedCount} 条锁定课程的位置。</p>
          ) : (
            <p className="panel-note">确认前面三步后，开始生成候选课表。</p>
          )}
          <button className="action-button wizard-run-button" onClick={startSelected} disabled={!checked || running || (computeMode === 'long' && longActive)}>
            {computeMode === 'long'
              ? longActive ? '长时任务进行中…' : '确认配置并启动长时任务'
              : running ? '正在计算…' : result ? '确认配置并重新排课' : '确认配置并开始排课'} <span>↗</span>
          </button>
        </section>
      </div>

      <section className="section-panel task-history-panel">
        <div className="panel-head">
          <div>
            <SectionHeading english="TASK HISTORY" title="任务与历史" />
            <p className="panel-note">短时计算保留本次会话记录；长时任务保留服务端检查点，可暂停、继续或载入最佳课表。</p>
          </div>
          <button type="button" className="ghost-button" onClick={() => setHistoryOpen((open) => !open)}>
            {historyOpen ? '收起全部历史' : '展开查看全部历史'}
          </button>
        </div>
        <div className="task-history-summary">
          <span>本次短时计算 <b>{shortRuns.length}</b> 条</span>
          <span>长时任务 <b>{longJobs.length}</b> 条</span>
          <span>默认显示最近 3 条</span>
        </div>
        <div className="task-history-preview">
          <h4>最近任务</h4>
          {recentTasks.length === 0 ? <p className="panel-note">还没有任务记录。</p> : recentTasks.map((item) => (
            <div className="short-history-row" key={item.key}>
              <div className="short-history-copy"><b>{item.title}</b><small>{new Date(item.at).toLocaleString('zh-CN')} · {item.detail}</small></div>
              <span className={item.ok ? 'status-tag' : 'status-tag danger'}>{item.kind}</span>
              {item.run ? (
                <div className="short-history-actions">
                  <button type="button" className="history-action" aria-label={'查看 ' + item.title} onClick={() => { if (item.run) setViewingShortRun(item.run); }}>查看</button>
                  <button type="button" className="history-action is-danger" aria-label={'删除 ' + item.title} onClick={() => { if (item.run) removeShortRun(item.run); }}>删除</button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="task-history-body" style={{ display: historyOpen ? 'block' : 'none' }}>
          <div className="short-history">
            <h4>短时计算记录</h4>
            {shortRuns.length === 0 ? <p className="panel-note">本次会话还没有短时计算记录。</p> : shortRuns.map((run) => (
              <div className="short-history-row" key={run.id}>
                <div className="short-history-copy">
                  <b>{run.mode === 'repair' ? '局部重排' : '短时计算'} · {runResultText(run.status, run.result.outcome)}</b>
                  <small>{new Date(run.createdAt).toLocaleString('zh-CN')} · {run.entries} 条 · {run.elapsedMs} ms · 时限 {run.timeLimitSeconds} 秒</small>
                </div>
                <span className={run.feasible ? 'status-tag' : 'status-tag danger'}>{run.feasible ? '可行' : '未排满'}</span>
                <div className="short-history-actions">
                  <button type="button" className="history-action" aria-label={'查看 ' + new Date(run.createdAt).toLocaleString('zh-CN') + ' 的短时记录'} onClick={() => setViewingShortRun(run)}>查看</button>
                  <button type="button" className="history-action is-danger" aria-label={'删除 ' + new Date(run.createdAt).toLocaleString('zh-CN') + ' 的短时记录'} onClick={() => removeShortRun(run)}>删除</button>
                </div>
              </div>
            ))}
          </div>
          <LongRunPanel
            inputFactory={inputFactory}
            onApplyResult={onApplyLongResult}
            onNotice={onNotice}
            onError={onError}
            disabled={!checked || running}
            seconds={longSeconds}
            onSecondsChange={setLongSeconds}
            showStartControls={false}
            onRegisterStart={registerLongStart}
            onActiveChange={setLongActive}
            onJobsChange={setLongJobs}
            open={historyOpen}
          />
        </div>
      </section>

      <section className="section-panel candidate-panel">
        <div className="panel-head"><SectionHeading english="CURRENT CANDIDATE" title="当前候选" /><span className={result?.hasFeasibleSolution ? 'status-tag' : 'status-tag muted'}>{result ? runResultText(result.status, result.outcome) : '尚未生成'}</span></div>
        {result ? (
          <div className="result-summary">
            <div className="summary-grid">
              <div><span>已排课时</span><b>{result.entries.length}</b></div>
              <div><span>计划课时</span><b>{expected}</b></div>
              <div><span>未排课时</span><b>{Math.max(0, expected - result.entries.length)}</b></div>
              <div><span>耗时</span><b>{result.elapsedMs} ms</b></div>
            </div>
            <p className="panel-note">{result.explanation || '求解器没有返回说明。'}</p>
            {result.outcome === 'partial' || result.outcome === 'timeout' ? (
              <div className="run-next-action">
                <b>{result.outcome === 'partial' ? '下一步：先处理未排课时，再继续计算' : '下一步：检查数据与硬约束，再提高时限重试'}</b>
                <span>当前结果来自启发式搜索，未找到完整课表不等于数学无解。</span>
                <button type="button" className="ghost-button" onClick={onRun} disabled={running}>
                  {running ? '计算中…' : '按当前配置重新计算'}
                </button>
              </div>
            ) : null}
            {result.hardConstraintViolations.length ? <ul className="issue-list">{result.hardConstraintViolations.map((item) => <li key={item}>{item}</li>)}</ul> : null}
            {missing.length ? <MissingReasons data={data} missing={missing} /> : null}
            {result.entries.length > 0 ? (
              <div className="repair-controls">
                <div><span className="kicker">// LOCAL REPAIR</span><b>局部重排</b><small>只重排所选范围，其他课程保持当前位置。</small></div>
                <div className="repair-actions">
                  <select value={repairScope} onChange={(event) => { const next = event.target.value as 'class' | 'teacher' | 'rule'; setRepairScope(next); const options = next === 'class' ? data.classes : next === 'teacher' ? data.teachers : (data.rules ?? []); setRepairId(options[0]?.id ?? ''); }}>
                    <option value="class">按班级</option><option value="teacher">按教师</option><option value="rule">按规则</option>
                  </select>
                  <select value={currentRepairId} onChange={(event) => setRepairId(event.target.value)}>
                    {repairEntities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  <button type="button" className="ghost-button" disabled={running || !currentRepairId} onClick={() => void onRepair(repairScope, currentRepairId)}>{running ? '重排中…' : '开始局部重排'}</button>
                </div>
              </div>
            ) : null}
            <div className="hero-actions"><button className="action-button" onClick={onTimetable}>查看并调整课表 <span>→</span></button><button className="ghost-button" onClick={onClear}>清空候选</button></div>
          </div>
        ) : <EmptyState title="尚未生成候选课表" message="完成向导后，候选课表会显示在这里。" />}
      </section>

      {viewingShortRun ? (
        <ShortRunDialog
          data={data}
          run={viewingShortRun}
          onClose={() => setViewingShortRun(null)}
          onDelete={() => { if (viewingShortRun) removeShortRun(viewingShortRun); }}
        />
      ) : null}
    </div>
  );
}
