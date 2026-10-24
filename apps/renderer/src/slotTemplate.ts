import type { TimeSlot } from './types';

const WEEKDAY_LABELS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const WEEKDAY_CHARS = ['', '一', '二', '三', '四', '五', '六', '日'];

export type DayTemplateMode = 'skip' | 'overwrite';

export interface DayTemplatePlan {
  sourceSlots: TimeSlot[];
  targetDays: number[];
  additions: number;
  overwrites: number;
  skips: number;
}

export interface DayTemplateResult extends DayTemplatePlan {
  slots: TimeSlot[];
}

function dayAliases(day: number): string[] {
  const char = WEEKDAY_CHARS[day] ?? '';
  if (!char) return [];
  const aliases = ['周' + char, '星期' + char];
  if (day === 7) aliases.push('周天', '星期天');
  return aliases;
}

export function weekdayLabel(day: number): string {
  return WEEKDAY_LABELS[day] ?? '未知星期';
}

/** Keep a custom label, but rewrite a leading weekday such as 周一/星期一. */
export function relabelForDay(label: string, sourceDay: number, targetDay: number, period: number): string {
  const fallback = weekdayLabel(targetDay) + ' 第' + period + '节';
  const text = String(label ?? '').trim();
  if (!text) return fallback;
  if (sourceDay === targetDay) return text;
  const targetChar = WEEKDAY_CHARS[targetDay] ?? '';
  for (const alias of dayAliases(sourceDay)) {
    if (!text.includes(alias)) continue;
    const replacement = alias.startsWith('星期') ? '星期' + targetChar : '周' + targetChar;
    return text.split(alias).join(replacement);
  }
  return text;
}

function sortSlots(slots: TimeSlot[]): TimeSlot[] {
  return slots.slice().sort((left, right) => left.period - right.period || left.day - right.day);
}

/**
 * Work out what "apply one day to other weekdays" will do before committing it.
 * Target days never include the source day. Extra periods on a target day are kept.
 */
export function planDayTemplate(
  slots: TimeSlot[],
  sourceDay: number,
  targetDays: number[],
  mode: DayTemplateMode,
): DayTemplatePlan {
  const sourceSlots = sortSlots(slots.filter((slot) => slot.day === sourceDay))
    .filter((slot, index, list) => index === 0 || slot.period !== list[index - 1].period);
  const targets = Array.from(new Set(targetDays))
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7 && day !== sourceDay)
    .sort((left, right) => left - right);
  const existing = new Set(slots.map((slot) => slot.day + '|' + slot.period));
  let additions = 0;
  let overwrites = 0;
  let skips = 0;
  for (const day of targets) {
    for (const slot of sourceSlots) {
      if (!existing.has(day + '|' + slot.period)) additions += 1;
      else if (mode === 'overwrite') overwrites += 1;
      else skips += 1;
    }
  }
  return { sourceSlots, targetDays: targets, additions, overwrites, skips };
}

/**
 * Copy every time slot on one day to the chosen weekdays. In overwrite mode the
 * existing slot keeps its id, so fixed-slot references remain valid.
 */
export function applyDayTemplate(
  slots: TimeSlot[],
  sourceDay: number,
  targetDays: number[],
  mode: DayTemplateMode,
  createId: () => string,
): DayTemplateResult {
  const plan = planDayTemplate(slots, sourceDay, targetDays, mode);
  if (plan.additions + plan.overwrites === 0) return { ...plan, slots };
  const next = slots.map((slot) => ({ ...slot }));
  const indexByKey = new Map(next.map((slot, index) => [slot.day + '|' + slot.period, index]));
  for (const day of plan.targetDays) {
    for (const source of plan.sourceSlots) {
      const key = day + '|' + source.period;
      const index = indexByKey.get(key);
      const label = relabelForDay(source.label, sourceDay, day, source.period);
      if (index === undefined) {
        const copy: TimeSlot = { id: createId(), day, period: source.period, label };
        if (source.kind !== undefined) copy.kind = source.kind;
        if (source.start !== undefined) copy.start = source.start;
        if (source.duration !== undefined) copy.duration = source.duration;
        indexByKey.set(key, next.length);
        next.push(copy);
      } else if (mode === 'overwrite') {
        const current = next[index];
        next[index] = {
          ...current,
          label,
          kind: source.kind,
          start: source.start,
          duration: source.duration,
        };
      }
    }
  }
  return { ...plan, slots: next };
}
