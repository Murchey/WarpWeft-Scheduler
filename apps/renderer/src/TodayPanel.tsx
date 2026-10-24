import { useMemo } from 'react';
import {
  currentSlot,
  effectiveAdjustments,
  effectiveEntries,
  formatClock,
  minutesOfDay,
  slotWindow,
  weekdayOf,
} from '../../../packages/adjustments/src';
import type { AdjustmentEntry } from '../../../packages/adjustments/src';
import { KIND_LABELS } from '../../../packages/inspection/src';
import type { SchoolData } from './types';
import { SectionHeading } from './components';
import { findClass, findRoom, findTeacher, planSubjectName } from './selectors';
import { todayLocal } from './utils';

const DAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function TodayPanel({
  data,
  now,
  onAdjust,
  onTimetable,
}: {
  data: SchoolData;
  now: Date;
  onAdjust: () => void;
  onTimetable: () => void;
}) {
  const date = todayLocal();
  const weekday = weekdayOf(date);
  const slots = useMemo(
    () => data.timeSlots.filter((slot) => slot.day === weekday).slice().sort((a, b) => a.period - b.period),
    [data.timeSlots, weekday],
  );
  const candidate = data.candidate ?? data.published ?? null;
  const planOfEntry = (entry: AdjustmentEntry) => data.coursePlans.find((plan) => plan.id === entry.coursePlanId);
  const entries: AdjustmentEntry[] = candidate
    ? effectiveEntries({ ...data, entries: candidate.entries as AdjustmentEntry[] }, date, data.adjustments ?? [])
    : [];
  const dayAdjustments = effectiveAdjustments(data.adjustments, date);
  const timeline = useMemo(
    () =>
      slots
        .map((slot) => ({ slot, window: slotWindow(slot), lessons: entries.filter((entry) => entry.slotId === slot.id) }))
        .filter((item) => item.lessons.length > 0 || item.window !== null),
    [entries, slots],
  );
  const timed = slots.some((slot) => slotWindow(slot) !== null);
  const minutes = minutesOfDay(now);
  const current = timed ? currentSlot(slots, weekday, minutes) : null;
  const currentLessons = current ? entries.filter((entry) => entry.slotId === current.id) : [];
  const currentWindow = current ? slotWindow(current) : null;
  const nextSlot = timed
    ? slots
        .map((slot) => ({ slot, window: slotWindow(slot) }))
        .filter((item): item is { slot: typeof slots[number]; window: { start: number; end: number } } => item.window !== null && item.window.start > minutes)
        .sort((a, b) => a.window.start - b.window.start)[0] ?? null
    : null;

  return (
    <section className="section-panel today-panel">
      <div className="panel-head">
        <div>
          <SectionHeading english="TODAY" title="今日课表" />
          <p className="panel-note">
            {date} · {DAY_NAMES[weekday] ?? '未知星期'}
            {dayAdjustments.length > 0 ? ' · 已叠加 ' + dayAdjustments.length + ' 条调代课' : ''}
            {timed ? '' : ' · 时间段还没填开始时间，无法判断当前节次'}
          </p>
        </div>
        <div className="today-actions">
          <button className="ghost-button" onClick={onAdjust}>去调代课</button>
          <button className="ghost-button" onClick={onTimetable}>完整课表</button>
        </div>
      </div>

      {!candidate ? (
        <p className="panel-note">还没有候选课表；排课完成后这里会显示今天各班的课。</p>
      ) : (
        <>
          {current && currentWindow ? (
            <div className="today-now">
              <span className="today-now-badge">现在</span>
              <div className="today-now-copy">
                <b>
                  第{current.period}节 · {current.label} · {formatClock(currentWindow.start)}–{formatClock(currentWindow.end)}
                </b>
                <small>{KIND_LABELS[current.kind ?? 'regular'] ?? '常规'}时段</small>
              </div>
              <div className="today-now-list">
                {currentLessons.length === 0 ? (
                  <span className="today-empty">这一节没有课</span>
                ) : (
                  currentLessons.map((entry) => {
                    const plan = planOfEntry(entry);
                    return (
                      <span key={entry.id} className="today-lesson">
                        <b>{findClass(data, entry.classId)?.name ?? entry.classId}</b>
                        <small>
                          {planSubjectName(data, plan)} · {findTeacher(data, entry.teacherId)?.name ?? entry.teacherId}
                        </small>
                      </span>
                    );
                  })
                )}
              </div>
            </div>
          ) : timed ? (
            <div className="today-now is-idle">
              <span className="today-now-badge">当前无课</span>
              <div className="today-now-copy">
                <b>{nextSlot ? '下一节：第' + nextSlot.slot.period + '节 ' + formatClock(nextSlot.window.start) : '今天没有更多课程'}</b>
                <small>按时间段的开始时间判断</small>
              </div>
            </div>
          ) : null}

          {timeline.length === 0 ? (
            <p className="panel-note">今天没有排课。</p>
          ) : (
            <ol className="today-timeline">
              {timeline.map((item) => {
                const window = item.window;
                const isNow = current?.id === item.slot.id;
                return (
                  <li key={item.slot.id} className={isNow ? 'is-now' : ''}>
                    <span className="today-time">
                      <b>第{item.slot.period}节</b>
                      <small>{window ? formatClock(window.start) + '–' + formatClock(window.end) : item.slot.label}</small>
                    </span>
                    <span className={'today-kind is-' + (item.slot.kind ?? 'regular')}>
                      {KIND_LABELS[item.slot.kind ?? 'regular'] ?? '常规'}
                    </span>
                    <span className="today-lessons">
                      {item.lessons.length === 0 ? (
                        <em>无课</em>
                      ) : (
                        item.lessons.map((entry) => {
                          const base = candidate.entries.find((candidateEntry) => candidateEntry.id === entry.id);
                          const plan = planOfEntry(entry);
                          return (
                            <span key={entry.id}>
                              {findClass(data, entry.classId)?.name ?? entry.classId} {planSubjectName(data, plan)} ·{' '}
                              {findTeacher(data, entry.teacherId)?.name ?? entry.teacherId}
                              {base && base.teacherId !== entry.teacherId ? '（代课）' : ''}
                              {findRoom(data, entry.roomId)?.name ? ' · ' + findRoom(data, entry.roomId)?.name : ''}
                            </span>
                          );
                        })
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

