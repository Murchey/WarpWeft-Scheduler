import type { Commit, ElectiveBlock, ElectiveGroup, SchoolData } from './types';
import { SectionHeading } from './components';
import { uid } from './utils';

const ROOM_TYPES = ['普通教室', '实验室', '计算机房', '音乐教室', '美术教室', '体育馆'];

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
  const write = (next: ElectiveGroup[]) => commit({ ...data, electiveGroups: next }, { invalidate: true });

  const addGroup = () => {
    if (data.classes.length === 0 || data.teachers.length === 0 || data.subjects.length === 0) {
      setError('请先准备至少一个班级、一位教师和一个学科');
      return;
    }
    const group: ElectiveGroup = {
      id: uid('elective'),
      name: '走班组 ' + (groups.length + 1),
      subjectId: data.subjects[0].id,
      weeklyPeriods: 1,
      classIds: [data.classes[0].id],
      blocks: [makeBlock(data.teachers[0].id)],
    };
    write([...groups, group]);
  };

  const makeBlock = (teacherId: string): ElectiveBlock => ({
    id: uid('block'),
    name: '并行班',
    teacherId,
    roomType: '',
  });

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

  const removeGroup = (group: ElectiveGroup) => {
    if (!window.confirm('删除走班组「' + group.name + '」？相关候选课表会清空。')) return;
    write(groups.filter((item) => item.id !== group.id));
  };

  return (
    <section className="section-panel elective-panel">
      <div className="panel-head">
        <div>
          <SectionHeading english="ELECTIVE GROUPS" title="走班组" />
          <p className="panel-note">
            走班组按「组」占用时段：同一组的并行班必须同时上课，组内所有行政班在该时段整体让出，不再排常规课。
            每个并行班需要一位教师；教室按类型和容量自动匹配，同一时段并行班不能共用教室。
          </p>
        </div>
        <button className="mini-button" onClick={addGroup}>+ 新增走班组</button>
      </div>

      {groups.length === 0 ? (
        <p className="panel-note">还没有走班组。适用于分层教学、选课走班；不设置则所有课程按行政班排课。</p>
      ) : (
        <div className="elective-list">
          {groups.map((group) => (
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

              <div className="elective-classes">
                <span>参与班级（{group.classIds.length}）</span>
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
                  <span>并行班（{group.blocks.length}）</span>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => updateGroup(group.id, { blocks: [...group.blocks, makeBlock(data.teachers[0]?.id ?? '')] })}
                  >
                    + 并行班
                  </button>
                </div>
                {group.blocks.map((block) => (
                  <div key={block.id} className="elective-block">
                    <input
                      value={block.name}
                      onChange={(event) => updateBlock(group, block.id, { name: event.target.value })}
                      placeholder="并行班名称"
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
          ))}
        </div>
      )}

      <p className="panel-note">
        提示：走班的并行班数量不能超过可用教室数；同一教师只能带一个并行班。保存后运行排课，组内班级会在同一时段整体让出。
      </p>
    </section>
  );
}
