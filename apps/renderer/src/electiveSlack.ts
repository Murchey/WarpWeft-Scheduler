import type { SchoolData } from './types';

/**
 * 走班组（班会 / 合班 / 拆班）的时段余量检查。
 *
 * 为什么需要单独一条：走班组必须**先于**常规课占用整格（班会时全班让出，
 * 合班时多个班同时让出，拆班时一个班分两组同时占用）。因此一个班在该周的
 * 常规课时一旦等于时间格总数，它就没有任何空位可供走班组插入；求解器只能
 * 返回「未排满」，而用户看不出这是零余量造成的。
 *
 * 这里只做算术，不碰求解器：算清楚每个班在单/双周还剩几格、需要几格。
 */
export interface ElectiveSlackRow {
  classId: string;
  className: string;
  parity: '单周' | '双周';
  /** 该周剩余空格数（可能为负，表示常规课时已超排）。 */
  slack: number;
  /** 该周需要留给走班组的格数。 */
  need: number;
}

export interface ElectiveSlackReport {
  rows: ElectiveSlackRow[];
  /** slack === 0：没有任何空位，走班组必然排不进。 */
  blocked: ElectiveSlackRow[];
  /** 0 < slack < need：有空位但不够，可能排不满。 */
  tight: ElectiveSlackRow[];
}

function loadInWeek(plans: SchoolData['coursePlans'], parity: 'odd' | 'even'): number {
  return plans.reduce((sum, plan) => {
    const weeks = plan.weeks ?? 'all';
    if (weeks !== 'all' && weeks !== parity) return sum;
    return sum + Number(plan.weeklyPeriods || 0);
  }, 0);
}

export function electiveSlack(data: SchoolData): ElectiveSlackReport {
  const slotCount = data.timeSlots.length;
  const groups = data.electiveGroups ?? [];
  const rows: ElectiveSlackRow[] = [];
  if (groups.length === 0 || slotCount === 0) return { rows, blocked: [], tight: [] };

  for (const klass of data.classes) {
    const needed = groups
      .filter((group) => group.classIds.includes(klass.id))
      .reduce((sum, group) => sum + Number(group.weeklyPeriods || 0), 0);
    if (needed === 0) continue;
    const plans = data.coursePlans.filter((plan) => plan.classId === klass.id);
    for (const [parity, flag] of [['单周', 'odd'], ['双周', 'even']] as const) {
      const load = loadInWeek(plans, flag);
      rows.push({
        classId: klass.id,
        className: klass.name,
        parity,
        slack: slotCount - load,
        need: needed,
      });
    }
  }

  // 常规课时已超排时由既有的"周课时超过可用时间格"负责报错，这里不重复。
  const blocked = rows.filter((row) => row.slack === 0);
  const tight = rows.filter((row) => row.slack > 0 && row.slack < row.need);
  return { rows, blocked, tight };
}

/** 把报告转成可以直接展示给用户的中文提示；无问题时返回空数组。 */
export function electiveSlackMessages(data: SchoolData): string[] {
  const { blocked, tight } = electiveSlack(data);
  const messages: string[] = [];
  const brief = (rows: ElectiveSlackRow[]) =>
    Array.from(new Set(rows.map((row) => row.className + ' ' + row.parity))).slice(0, 3).join('、');
  if (blocked.length > 0) {
    const classes = Array.from(new Set(blocked.map((row) => row.className)));
    messages.push(
      classes.slice(0, 3).join('、') +
        (classes.length > 3 ? ' 等 ' + classes.length + ' 个班' : '') +
        ' 的单/双周课时已经占满全部时间格，没有空位排班会/合班/拆班这类走班组。' +
        '请减少这些班的教学计划课时、增加时间段，或改用「固定时间」把班会直接钉在某一格。',
    );
  } else if (tight.length > 0) {
    messages.push('走班组余量偏紧：' + brief(tight) + ' 的剩余时间格少于走班组所需格数，可能排不满。');
  }
  return messages;
}
