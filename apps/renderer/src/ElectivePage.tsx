import type { Commit, ElectiveBlock, ElectiveGroup, SchoolData } from './types';
import { SectionHeading } from './components';
import { uid } from './utils';
import { confirmDialog } from './confirm';
import { electiveSlack } from './electiveSlack';

const ROOM_TYPES = ['普通教室', '实验室', '计算机房', '音乐教室', '美术教室', '体育馆'];

/**
 * 三种常见用法的快速预设。
 *
 * 三者底层都是同一个模型（一组并行班在同一时段上课），但用户的心智模型
 * 完全不同，此前界面只有「并行班」一个词，导致班会、合班、拆班都表达不出来。
 */
type PresetKind = 'meeting' | 'merge' | 'split';

const PRESETS: { kind: PresetKind; title: string; hint: string }[] = [
  {
    kind: 'meeting',
    title: '班会 / 年级会',
    hint: '多个班在同一节一起上，通常一位老师、一间教室',
  },
  {
    kind: 'merge',
    title: '合班上课',
    hint: '两个班合并成一节，共用一位老师和一间大教室',
  },
  {
    kind: 'split',
    title: '拆班上课',
    hint: '一个班分成两组（例如男女分组），两位老师同时上',
  },
];

export function ElectivePage({
  data,
  commit,
  setError,
}: {
  data: SchoolData;
  commit: Commit;
  setError: (value: string) => void;
}) {
  const groups = data.electiveGroups ?? [];
  const slack = electiveSlack(data);
  const write = (next: ElectiveGroup[]) => commit({ ...data, electiveGroups: next }, { invalidate: true });

  const makeBlock = (teacherId: string, name = '并行班'): ElectiveBlock => ({
    id: uid('block'),
    name,
    teacherId,
    roomType: '',
  });

  const addGroup = (kind: PresetKind = 'meeting') => {
    if (data.classes.length === 0 || data.teachers.length === 0 || data.subjects.length === 0) {
      setError('请先准备至少一个班级、一位教师和一个学科');
      return;
    }
    const teacherA = data.teachers[0].id;
    const teacherB = (data.teachers[1] ?? data.teachers[0]).id;
    const firstClass = data.classes[0].id;
    const secondClass = (data.classes[1] ?? data.classes[0]).id;
    const base = {
      id: uid('elective'),
      subjectId: data.subjects[0].id,
      weeklyPeriods: 1,
    };
    // 拆班 = 一个班 + 两个并行班；其余 = 多个班 + 一个并行班。
    const group: ElectiveGroup =
      kind === 'split'
        ? {
            ...base,
            name: '拆班 ' + (groups.length + 1),
            classIds: [firstClass],
            blocks: [makeBlock(teacherA, 'A 组'), makeBlock(teacherB, 'B 组')],
          }
        : {
            ...base,
            name: (kind === 'merge' ? '合班 ' : '班会 ') + (groups.length + 1),
            classIds: kind === 'merge' ? [firstClass, secondClass] : [firstClass],
            blocks: [makeBlock(teacherA, kind === 'merge' ? '合班' : '班会')],
          };
    write([...groups, group]);
  };

  const updateGroup = (id: string, patch: Partial<ElectiveGroup>) => {
    write(groups.map((group) => (group.id === id ? { ...group, ...patch } : group)));
  };

  const toggleClass = (group: ElectiveGroup, classId: string) => {
    const classIds = group.classIds.includes(classId)
      ? group.classIds.filter((item) => item !== classId)
      : [...group.classIds, classId];
    updateGroup(group.id, { classIds });
  };

  const updateBlock = (group: ElectiveGroup, blockId: string, patch: Partial<ElectiveBlock>) => {
    updateGroup(group.id, { blocks: group.blocks.map((block) => (block.id === blockId ? { ...block, ...patch } : block)) });
  };

  const removeGroup = async (group: ElectiveGroup) => {
    if (!(await confirmDialog({ tone: 'danger', title: '删除走班组', message: '删除走班组「' + group.name + '」？', detail: '相关候选课表会清空，需要重新排课。', confirmLabel: '删除走班组' }))) return;
    write(groups.filter((item) => item.id !== group.id));
  };

  // 每个班在单/双周各自还剩多少格，用于在卡片里直接提示"排得进吗"。
  const slackOfClass = (classId: string) => slack.rows.filter((row) => row.classId === classId);

  return (
    <section className="section-panel elective-panel">
      <div className="panel-head">
        <div>
          <SectionHeading english="ELECTIVE GROUPS" title="班会 / 合班 / 拆班" />
          <p className="panel-note">
            同一组的所有并行班占同一节：组内行政班在该节整体让出，不再排常规课。
            每个并行班需要一位教师，同一时段并行班不能共用教室。
          </p>
        </div>
      </div>

      <div className="elective-presets">
        {PRESETS.map((preset) => (
          <button key={preset.kind} type="button" className="elective-preset" onClick={() => addGroup(preset.kind)}>
            <b>+ {preset.title}</b>
            <small>{preset.hint}</small>
          </button>
        ))}
      </div>

      {slack.blocked.length > 0 ? (
        <div className="tt-warning is-danger elective-slack-warning">
          <b>这些班已经没有空位了</b>
          <span>
            {Array.from(new Set(slack.blocked.map((row) => row.className))).slice(0, 8).join('、')}
            {new Set(slack.blocked.map((row) => row.classId)).size > 8 ? ' 等' : ''}
            {' '}的单/双周课时已占满全部时间格，走班组排不进去。请减少教学计划课时、增加时间段，
            或给班会设置「固定时间」把它直接钉在某一格。
          </span>
        </div>
      ) : null}
      {slack.tight.length > 0 ? (
        <div className="tt-warning elective-slack-warning">
          <b>余量偏紧</b>
          <span>
            部分班级剩余时间格少于走班组所需格数，可能排不满：
            {Array.from(new Set(slack.tight.map((row) => row.className + ' ' + row.parity))).slice(0, 6).join('、')}
          </span>
        </div>
      ) : null}

      {groups.length === 0 ? (
        <p className="panel-note">还没有走班组。用上面的三个预设就能覆盖班会、合班与拆班；不设置则所有课程按行政班排课。</p>
      ) : (
        <div className="elective-list">
          {groups.map((group) => {
            const isSplit = group.classIds.length === 1 && group.blocks.length > 1;
            const classSlack = group.classIds.flatMap(slackOfClass);
            const tightRows = classSlack.filter((row) => row.slack < row.need);
            return (
              <article key={group.id} className="elective-card">
                <div className="elective-head">
                  <label>
                    名称
                    <input value={group.name} onChange={(event) => updateGroup(group.id, { name: event.target.value })} />
                  </label>
                  <label>
                    学科
                    <select value={group.subjectId} onChange={(event) => updateGroup(group.id, { subjectId: event.target.value })}>
                      {data.subjects.map((subject) => (
                        <option key={subject.id} value={subject.id}>{subject.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    每周节数
                    <input
                      type="number"
                      min={1}
                      value={group.weeklyPeriods}
                      onChange={(event) => updateGroup(group.id, { weeklyPeriods: Math.max(1, Number(event.target.value) || 1) })}
                    />
                  </label>
                  <button className="danger-link" onClick={() => removeGroup(group)}>删除走班组</button>
                </div>

                <p className="elective-shape">
                  {isSplit
                    ? '拆班：' + (data.classes.find((klass) => klass.id === group.classIds[0])?.name ?? '') + ' 分成 ' + group.blocks.length + ' 组，同时上课'
                    : group.classIds.length > 1
                      ? '合班：' + group.classIds.length + ' 个班一起上'
                      : '单班课：1 个班 ' + group.blocks.length + ' 位老师同时上'}
                </p>

                {tightRows.length > 0 ? (
                  <p className="elective-slack-note">
                    {tightRows.map((row) => row.className + ' ' + row.parity + ' 只剩 ' + row.slack + ' 格（需要 ' + row.need + ' 格）').join('；')}
                  </p>
                ) : null}

                <div className="elective-classes">
                  <span>{isSplit ? '拆班对象（1 个班）' : '参与班级（' + group.classIds.length + '）'}</span>
                  <div className="elective-class-options">
                    {data.classes.map((klass) => (
                      <button
                        key={klass.id}
                        type="button"
                        className={group.classIds.includes(klass.id) ? 'elective-class active' : 'elective-class'}
                        onClick={() => toggleClass(group, klass.id)}
                      >
                        {klass.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="elective-blocks">
                  <div className="elective-blocks-head">
                    <span>{isSplit ? '分组（' + group.blocks.length + '）' : '并行班（' + group.blocks.length + '）'}</span>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => updateGroup(group.id, { blocks: [...group.blocks, makeBlock(data.teachers[0]?.id ?? '')] })}
                    >
                      + {isSplit ? '分组' : '并行班'}
                    </button>
                  </div>
                  {group.blocks.map((block) => (
                    <div key={block.id} className="elective-block">
                      <input
                        value={block.name}
                        onChange={(event) => updateBlock(group, block.id, { name: event.target.value })}
                        placeholder={isSplit ? '分组名称' : '并行班名称'}
                        aria-label="并行班名称"
                      />
                      <select
                        value={block.teacherId}
                        onChange={(event) => updateBlock(group, block.id, { teacherId: event.target.value })}
                        aria-label="并行班教师"
                      >
                        {data.teachers.map((teacher) => (
                          <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
                        ))}
                      </select>
                      <select
                        value={block.roomType ?? ''}
                        onChange={(event) => updateBlock(group, block.id, { roomType: event.target.value })}
                        aria-label="并行班教室类型"
                      >
                        <option value="">教室类型不限</option>
                        {Array.from(new Set([...ROOM_TYPES, ...data.rooms.map((room) => room.type)])).filter(Boolean).map((type) => (
                          <option key={type} value={type}>{type}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="danger-link"
                        onClick={() => updateGroup(group.id, { blocks: group.blocks.filter((item) => item.id !== block.id) })}
                      >
                        移除
                      </button>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <p className="panel-note">
        提示：并行班数量不能超过可用教室数；同一教师只能带一个并行班。
        班会需要每班在该周至少空出 1 格，排在常规课时之外。
      </p>
    </section>
  );
}
