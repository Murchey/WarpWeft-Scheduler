import { useMemo } from 'react';
import {
  LESSON_STATUS_LABELS,
  buildActualStats,
  buildDayLogs,
  mergeDayLogs,
} from '../../../packages/adjustments/src';
import type { AdjustmentEntry, LessonLog, LessonStatus } from '../../../packages/adjustments/src';
import type { Commit, SchoolData } from './types';
import { SectionHeading } from './components';
import { download, exportMessage } from './download';
import { exportCsv } from '../../../packages/import-export/src';
import { messageOf } from './utils';
import { findSubject, findTeacher } from './selectors';

const STATUS_OPTIONS: LessonStatus[] = ['normal', 'substituted', 'moved', 'cancelled'];

export function LessonLogPanel({
  data,
  commit,
  date,
  operator,
  setError,
  setNotice,
}: {
  data: SchoolData;
  commit: Commit;
  date: string;
  operator: string;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
}) {
  const logs = useMemo(() => (data.lessonLogs ?? []).filter((log) => log.date === date), [data.lessonLogs, date]);
  const stats = useMemo(() => buildActualStats(logs, data.teachers, date), [date, data.teachers, logs]);
  const candidate = data.candidate ?? data.published ?? null;
  const slotLabel = (slotId: string) => data.timeSlots.find((slot) => slot.id === slotId)?.label ?? slotId;
  const subjectOf = (log: LessonLog) => findSubject(data, log.subjectId)?.name ?? log.subjectId;

  const write = (next: LessonLog[]) => {
    commit(
      { ...data, lessonLogs: [...(data.lessonLogs ?? []).filter((log) => log.date !== date), ...next] },
      { immediate: true },
    );
  };

  const generate = () => {
    if (!candidate) {
      setError('还没有候选课表，无法生成上课记录');
      return;
    }
    try {
      const generated = buildDayLogs(
        { ...data, entries: candidate.entries as AdjustmentEntry[] },
        date,
        new Date().toISOString(),
      );
      const merged = mergeDayLogs(data.lessonLogs ?? [], generated, date);
      write(merged);
      setNotice('已从课表生成 ' + merged.length + ' 条上课记录（已有记录的手工修改会保留）');
    } catch (cause) {
      setError('生成上课记录失败：' + messageOf(cause));
    }
  };

  const update = (log: LessonLog, patch: Partial<LessonLog>) => {
    write(
      logs.map((item) =>
        item.id === log.id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item,
      ),
    );
  };

  const exportLogs = async () => {
    if (logs.length === 0) return;
    try {
      const rows = logs.map((log) => ({
        日期: log.date,
        时间: slotLabel(log.slotId),
        班级: data.classes.find((klass) => klass.id === log.classId)?.name ?? log.classId,
        学科: subjectOf(log),
        实际教师: findTeacher(data, log.teacherId)?.name ?? log.teacherId,
        原任课教师: findTeacher(data, log.originalTeacherId)?.name ?? log.originalTeacherId,
        状态: LESSON_STATUS_LABELS[log.status],
        确认: log.confirmed ? '是' : '否',
        备注: log.note ?? '',
      }));
      const csv = exportCsv(rows);
      const result = await download(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), 'text/csv', 'warpweft-lessons-' + date + '.csv');
      const message = exportMessage(result, '上课记录');
      if (!message) return;
      if (message.tone === 'error') setError(message.text);
      else setNotice(message.text);
    } catch (cause) {
      setError('导出上课记录失败：' + messageOf(cause));
    }
  };

  return (
    <section className="section-panel lesson-log">
      <div className="panel-head">
        <div>
          <SectionHeading english="ACTUAL LESSONS" title="实际上课记录" />
          <p className="panel-note">
            从「周课表 + 当天调代课」生成，可人工确认或改状态/备注；统计按实际授课教师计算，代课与停课单列。
          </p>
        </div>
        <div className="lesson-log-actions">
          <button className="ghost-button" onClick={generate} disabled={!candidate}>
            从课表生成当天记录
          </button>
          <button className="ghost-button" onClick={() => void exportLogs()} disabled={logs.length === 0}>
            导出记录
          </button>
        </div>
      </div>

      {logs.length === 0 ? (
        <p className="panel-note">这一天还没有上课记录。点击「从课表生成当天记录」开始。</p>
      ) : (
        <>
          <div className="lesson-stats">
            <span>记录 <b>{stats.total}</b></span>
            <span>正常 <b>{stats.normal}</b></span>
            <span>代课 <b>{stats.substituted}</b></span>
            <span>调课 <b>{stats.moved}</b></span>
            <span>停课 <b>{stats.cancelled}</b></span>
            <span>已确认 <b>{stats.confirmed}</b></span>
            {stats.teachers
              .filter((row) => row.taught > 0 || row.cancelled > 0)
              .slice(0, 6)
              .map((row) => (
                <span key={row.teacherId} className="lesson-teacher">
                  {row.name} 实际 <b>{row.taught}</b>
                  {row.substitute > 0 ? '（代课 ' + row.substitute + '）' : ''}
                  {row.cancelled > 0 ? ' · 停课 ' + row.cancelled : ''}
                </span>
              ))}
          </div>
          <div className="table-scroll lesson-table-scroll">
            <table className="data-table lesson-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>班级</th>
                  <th>学科</th>
                  <th>实际教师</th>
                  <th>状态</th>
                  <th>备注</th>
                  <th className="lesson-confirm-head">确认</th>
                </tr>
              </thead>
              <tbody>
                {logs
                  .slice()
                  .sort((a, b) => slotLabel(a.slotId).localeCompare(slotLabel(b.slotId), 'zh-CN'))
                  .map((log) => (
                    <tr key={log.id} className={log.status === 'cancelled' ? 'is-cancelled' : ''}>
                      <td>{slotLabel(log.slotId)}</td>
                      <td>{data.classes.find((klass) => klass.id === log.classId)?.name ?? log.classId}</td>
                      <td>{subjectOf(log)}</td>
                      <td>
                        {findTeacher(data, log.teacherId)?.name ?? log.teacherId}
                        {log.status === 'substituted' ? (
                          <small className="lesson-note">代 {findTeacher(data, log.originalTeacherId)?.name ?? log.originalTeacherId}</small>
                        ) : null}
                      </td>
                      <td>
                        <select value={log.status} onChange={(event) => update(log, { status: event.target.value as LessonStatus })}>
                          {STATUS_OPTIONS.map((status) => (
                            <option key={status} value={status}>
                              {LESSON_STATUS_LABELS[status]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          value={log.note ?? ''}
                          placeholder="如：按调课单执行"
                          onChange={(event) => update(log, { note: event.target.value })}
                        />
                      </td>
                      <td className="lesson-confirm-cell">
                        <input
                          type="checkbox"
                          checked={Boolean(log.confirmed)}
                          onChange={(event) => update(log, { confirmed: event.target.checked })}
                          aria-label="确认这条记录"
                        />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}


