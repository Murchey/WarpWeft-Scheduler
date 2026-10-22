import React, { useState } from 'react';
import { buildImportTemplate, readWorkbook } from '../../../packages/import-export/src';
import type { ClassRoom, Commit, CoursePlan, Room, SchoolData, SlotKind, Subject, Teacher, TimeSlot } from './types';
import { DAYS, EditableTable, SectionHeading } from './components';
import { download } from './download';
import { messageOf, uid } from './utils';

const SLOT_KIND_MAP: Record<string, SlotKind> = {
  早读: 'morning', morning: 'morning',
  常规: 'regular', 普通: 'regular', regular: 'regular',
  晚自习: 'evening', 晚修: 'evening', evening: 'evening',
  补课: 'makeup', makeup: 'makeup',
};
const SLOT_KIND_OPTIONS = [
  { value: 'morning', label: '早读' },
  { value: 'regular', label: '常规' },
  { value: 'evening', label: '晚自习' },
  { value: 'makeup', label: '补课' },
];

function ResourcesPage({
  data,
  commit,
  setError,
  setNotice,
  kind = 'import',
}: {
  data: SchoolData;
  commit: Commit;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
  kind?: 'import' | 'classes' | 'teachers' | 'subjects' | 'rooms' | 'timeSlots';
}) {
  const days = DAYS.slice(1).map((label, index) => ({ value: String(index + 1), label }));
  const [replaceOnImport, setReplaceOnImport] = useState(false);
  const [batchDays, setBatchDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [batchFrom, setBatchFrom] = useState(1);
  const [batchTo, setBatchTo] = useState(2);
  const update = (
    collection: 'classes' | 'teachers' | 'subjects' | 'rooms' | 'timeSlots',
    id: string,
    key: string,
    value: string | number,
  ) => {
    const rows = (data[collection] as unknown as Array<Record<string, unknown> & { id: string }>).map((row) =>
      row.id === id ? { ...row, [key]: value } : row,
    );
    const invalidate = collection === 'timeSlots' && (key === 'day' || key === 'period' || key === 'kind');
    commit({ ...data, [collection]: rows } as unknown as SchoolData, { invalidate });
  };
  const remove = (
    collection: 'classes' | 'teachers' | 'subjects' | 'rooms' | 'timeSlots',
    id: string,
  ) => {
    if (collection === 'classes' && data.coursePlans.some((plan) => plan.classId === id)) {
      setError('该班级仍被教学计划引用，请先删除相关教学计划');
      return;
    }
    if (collection === 'teachers' && data.coursePlans.some((plan) => plan.teacherId === id)) {
      setError('该教师仍被教学计划引用，请先删除相关教学计划');
      return;
    }
    if (collection === 'subjects' && data.coursePlans.some((plan) => plan.subjectId === id)) {
      setError('该学科仍被教学计划引用，请先删除相关教学计划');
      return;
    }
    if (collection === 'rooms' && data.rooms.length <= 1) {
      setError('至少需要保留一间教室');
      return;
    }
    if (!window.confirm('确定删除这条记录？')) return;
    const rows = (data[collection] as Array<{ id: string }>).filter((row) => row.id !== id);
    commit({ ...data, [collection]: rows } as unknown as SchoolData, { invalidate: true });
  };
  const add = (collection: 'classes' | 'teachers' | 'subjects' | 'rooms' | 'timeSlots') => {
    let row: Record<string, unknown>;
    if (collection === 'classes') row = { id: uid('class'), name: '新班级', grade: '未设置', size: 40 };
    else if (collection === 'teachers') row = { id: uid('teacher'), name: '新教师' };
    else if (collection === 'subjects') row = { id: uid('subject'), name: '新学科' };
    else if (collection === 'rooms') row = { id: uid('room'), name: '新教室', capacity: 40, type: '普通教室' };
    else {
      const periods = data.timeSlots.filter((slot) => slot.day === 1).map((slot) => slot.period);
      const period = (periods.length ? Math.max(...periods) : 0) + 1;
      row = { id: uid('slot'), day: 1, period, label: '周一 第' + period + '节', kind: 'regular' };
    }
    commit({ ...data, [collection]: [...(data[collection] as unknown as Array<Record<string, unknown>>), row] } as unknown as SchoolData, {
      invalidate: true,
    });
  };

  const addBatchSlots = () => {
    const from = Math.max(1, Math.floor(Number(batchFrom) || 1));
    const to = Math.max(from, Math.floor(Number(batchTo) || from));
    if (batchDays.length === 0) {
      setError('请至少选择一个星期');
      return;
    }
    const existing = new Set(data.timeSlots.map((slot) => slot.day + '|' + slot.period));
    const additions: TimeSlot[] = [];
    for (const day of [...batchDays].sort((a, b) => a - b)) {
      for (let period = from; period <= to; period += 1) {
        if (existing.has(day + '|' + period)) continue;
        additions.push({ id: uid('slot'), day, period, label: DAYS[day] + ' 第' + period + '节', kind: 'regular' });
      }
    }
    if (additions.length === 0) {
      setNotice('这些时间段已经存在，没有新增。');
      return;
    }
    commit({ ...data, timeSlots: [...data.timeSlots, ...additions] }, { invalidate: true });
    setNotice('已批量新增 ' + additions.length + ' 个时间段。');
  };

  const importWorkbookFile = async (file: File) => {
    try {
      if (replaceOnImport && !window.confirm('导入前将清空当前工作区的基础资料、时间段和教学计划，确定继续？')) return;
      const rows = readWorkbook(await file.arrayBuffer());
      if (rows.length === 0) {
        setError('Excel 文件为空，请先下载模板并按表头填写。');
        return;
      }
      const text = (value: unknown) => String(value ?? '').trim();
      const numeric = (value: unknown, fallback = 0) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
      };
      const dayMap: Record<string, number> = {
        周一: 1, 星期一: 1, 一: 1, '1': 1,
        周二: 2, 星期二: 2, 二: 2, '2': 2,
        周三: 3, 星期三: 3, 三: 3, '3': 3,
        周四: 4, 星期四: 4, 四: 4, '4': 4,
        周五: 5, 星期五: 5, 五: 5, '5': 5,
        周六: 6, 星期六: 6, 六: 6, '6': 6,
        周日: 7, 星期日: 7, 日: 7, '7': 7,
      };
      const issues: string[] = [];
      const grouped = new Map<string, typeof rows>();
      for (const row of rows) {
        const key = text(row.sheet).toLowerCase();
        const list = grouped.get(key) ?? [];
        list.push(row);
        grouped.set(key, list);
      }
      const takeRows = (tokens: string[]) => {
        const result: typeof rows = [];
        for (const [sheet, sheetRows] of grouped) {
          if (tokens.some((token) => sheet.includes(token))) result.push(...sheetRows);
        }
        return result;
      };
      const schoolRows = takeRows(['学校', 'school']);
      const classRows = takeRows(['班级', 'class']);
      const teacherRows = takeRows(['教师', 'teacher']);
      const subjectRows = takeRows(['学科', 'subject']);
      const roomRows = takeRows(['教室', 'room']);
      const slotRows = takeRows(['时间段', 'slot']);
      const planRows = takeRows(['教学计划', 'plan']);
      const planSheetFound = [...grouped.keys()].some((sheet) => sheet.includes('教学计划') || sheet.includes('plan'));
      if (![...schoolRows, ...classRows, ...teacherRows, ...subjectRows, ...roomRows, ...slotRows, ...planRows].length) {
        setError('未识别到可导入的工作表。请使用模板中的“班级/教师/学科/教室/时间段/教学计划”表头。');
        return;
      }
      const next: SchoolData = {
        ...data,
        classes: data.classes.map((item) => ({ ...item })),
        teachers: data.teachers.map((item) => ({ ...item })),
        subjects: data.subjects.map((item) => ({ ...item })),
        rooms: data.rooms.map((item) => ({ ...item })),
        timeSlots: data.timeSlots.map((item) => ({ ...item })),
        coursePlans: data.coursePlans.map((item) => ({ ...item })),
      };
      const schoolRow = schoolRows.find((row) => text(row.values['名称'] ?? row.values['学校名称'] ?? row.values['name']));
      if (schoolRow) {
        const schoolName = text(schoolRow.values['名称'] ?? schoolRow.values['学校名称'] ?? schoolRow.values['name']);
        if (schoolName) next.school = { ...next.school, name: schoolName };
      }
      if (replaceOnImport) {
        next.rules = [];
        next.unavailableSlots = [];
        next.classes = [];
        next.teachers = [];
        next.subjects = [];
        next.rooms = [];
        next.timeSlots = [];
        next.coursePlans = [];
      }
      const classNames = new Set<string>();
      for (const row of classRows) {
        const v = row.values;
        const name = text(v['名称'] ?? v['班级名称'] ?? v['name']);
        if (!name) {
          issues.push('班级 第' + row.row + '行缺少名称');
          continue;
        }
        const key = name.toLowerCase();
        if (classNames.has(key)) {
          issues.push('班级 第' + row.row + '行名称重复：' + name);
          continue;
        }
        classNames.add(key);
        const size = numeric(v['人数'] ?? v['size'], 40);
        if (!Number.isInteger(size) || size <= 0) {
          issues.push('班级 第' + row.row + '行人数必须为正整数');
          continue;
        }
        const grade = text(v['年级'] ?? v['grade']);
        const existing = next.classes.find((item) => item.name.trim().toLowerCase() === key);
        if (existing) {
          existing.grade = grade || existing.grade;
          existing.size = size;
        } else {
          next.classes.push({ id: uid('class'), name, grade, size });
        }
      }
      const teacherNames = new Set<string>();
      for (const row of teacherRows) {
        const v = row.values;
        const name = text(v['名称'] ?? v['教师名称'] ?? v['name']);
        if (!name) {
          issues.push('教师 第' + row.row + '行缺少名称');
          continue;
        }
        const key = name.toLowerCase();
        if (teacherNames.has(key)) {
          issues.push('教师 第' + row.row + '行名称重复：' + name);
          continue;
        }
        teacherNames.add(key);
        if (!next.teachers.some((item) => item.name.trim().toLowerCase() === key)) {
          next.teachers.push({ id: uid('teacher'), name });
        }
      }
      const subjectNames = new Set<string>();
      for (const row of subjectRows) {
        const v = row.values;
        const name = text(v['名称'] ?? v['学科名称'] ?? v['name']);
        if (!name) {
          issues.push('学科 第' + row.row + '行缺少名称');
          continue;
        }
        const key = name.toLowerCase();
        if (subjectNames.has(key)) {
          issues.push('学科 第' + row.row + '行名称重复：' + name);
          continue;
        }
        subjectNames.add(key);
        if (!next.subjects.some((item) => item.name.trim().toLowerCase() === key)) {
          next.subjects.push({ id: uid('subject'), name });
        }
      }
      const roomNames = new Set<string>();
      for (const row of roomRows) {
        const v = row.values;
        const name = text(v['名称'] ?? v['教室名称'] ?? v['name']);
        if (!name) {
          issues.push('教室 第' + row.row + '行缺少名称');
          continue;
        }
        const key = name.toLowerCase();
        if (roomNames.has(key)) {
          issues.push('教室 第' + row.row + '行名称重复：' + name);
          continue;
        }
        roomNames.add(key);
        const capacity = numeric(v['容量'] ?? v['capacity'], 40);
        if (!Number.isInteger(capacity) || capacity <= 0) {
          issues.push('教室 第' + row.row + '行容量必须为正整数');
          continue;
        }
        const type = text(v['类型'] ?? v['type']) || '普通教室';
        const existing = next.rooms.find((item) => item.name.trim().toLowerCase() === key);
        if (existing) {
          existing.capacity = capacity;
          existing.type = type;
        } else {
          next.rooms.push({ id: uid('room'), name, capacity, type });
        }
      }
      const slotKeys = new Set<string>();
      for (const row of slotRows) {
        const v = row.values;
        const day = dayMap[text(v['星期'] ?? v['day'])];
        const period = numeric(v['节次'] ?? v['period']);
        if (!day || !Number.isInteger(period) || period <= 0) {
          issues.push('时间段 第' + row.row + '行缺少有效星期或节次');
          continue;
        }
        const key = day + '-' + period;
        if (slotKeys.has(key)) {
          issues.push('时间段 第' + row.row + '行重复：' + day + '-' + period);
          continue;
        }
        slotKeys.add(key);
        const label = text(v['名称'] ?? v['label']) || DAYS[day] + ' 第' + period + '节';
        const kindText = text(v['类型'] ?? v['时段类型'] ?? v['kind']);
        const kind = kindText ? SLOT_KIND_MAP[kindText] : 'regular';
        if (kindText && !kind) {
          issues.push('时间段 第' + row.row + '行时段类型无法识别：' + kindText + '（可填 早读/常规/晚自习/补课）');
          continue;
        }
        const start = text(v['开始时间'] ?? v['开始'] ?? v['start']);
        if (start && !/^\d{1,2}:\d{2}$/.test(start)) {
          issues.push('时间段 第' + row.row + '行开始时间格式应为 HH:MM');
          continue;
        }
        const duration = numeric(v['时长'] ?? v['duration'], 0);
        const existing = next.timeSlots.find((item) => item.day === day && item.period === period);
        if (existing) {
          existing.label = label;
          existing.kind = kind;
          existing.start = start || undefined;
          existing.duration = duration > 0 ? duration : undefined;
        } else {
          next.timeSlots.push({
            id: uid('slot'),
            day,
            period,
            label,
            kind,
            start: start || undefined,
            duration: duration > 0 ? duration : undefined,
          });
        }
      }
      const classByName = new Map(next.classes.map((item) => [item.name.trim().toLowerCase(), item]));
      const subjectByName = new Map(next.subjects.map((item) => [item.name.trim().toLowerCase(), item]));
      const teacherByName = new Map(next.teachers.map((item) => [item.name.trim().toLowerCase(), item]));
      const slotByLabel = new Map(next.timeSlots.map((item) => [item.label.trim(), item]));
      const slotById = new Map(next.timeSlots.map((item) => [item.id, item]));
      if (planSheetFound) {
        const plans: CoursePlan[] = [];
        const planKeys = new Set<string>();
        for (const row of planRows) {
          const v = row.values;
          if (!Object.values(v).some((value) => text(value) !== '')) continue;
          const className = text(v['班级'] ?? v['班级名称'] ?? v['class']);
          const subjectName = text(v['学科'] ?? v['学科名称'] ?? v['subject']);
          const teacherName = text(v['教师'] ?? v['教师姓名'] ?? v['teacher']);
          const classItem = classByName.get(className.toLowerCase());
          const subjectItem = subjectByName.get(subjectName.toLowerCase());
          const teacherItem = teacherByName.get(teacherName.toLowerCase());
          if (!classItem || !subjectItem || !teacherItem) {
            issues.push('教学计划 第' + row.row + '行引用了不存在的班级、学科或教师');
            continue;
          }
          const weeklyPeriods = numeric(v['周课时'] ?? v['课时'] ?? v['weeklyPeriods']);
          if (!Number.isInteger(weeklyPeriods) || weeklyPeriods <= 0) {
            issues.push('教学计划 第' + row.row + '行周课时必须为正整数');
            continue;
          }
          const roomType = text(v['教室类型'] ?? v['roomType']);
          if (roomType && !next.rooms.some((room) => room.type === roomType)) {
            issues.push('教学计划 第' + row.row + '行教室类型不存在：' + roomType);
            continue;
          }
          const fixedText = text(v['固定时间'] ?? v['fixedSlot'] ?? v['fixed']);
          let fixedSlotId = '';
          if (fixedText) {
            const fixed = slotByLabel.get(fixedText) ?? slotById.get(fixedText);
            if (!fixed) {
              issues.push('教学计划 第' + row.row + '行固定时间不存在：' + fixedText);
              continue;
            }
            fixedSlotId = fixed.id;
          }
          const weekText = text(v['周次'] ?? v['单双周'] ?? v['weeks']).trim().toLowerCase();
          let weeks: 'all' | 'odd' | 'even' = 'all';
          if (weekText) {
            if (['单周', '单', 'odd'].includes(weekText)) weeks = 'odd';
            else if (['双周', '双', 'even'].includes(weekText)) weeks = 'even';
            else if (['每周', '全', 'all'].includes(weekText)) weeks = 'all';
            else {
              issues.push('教学计划 第' + row.row + '行周次无法识别：' + weekText + '（可填 每周/单周/双周）');
              continue;
            }
          }
          const kindText = text(v['时段类型'] ?? v['类型'] ?? v['kind']).trim();
          const planKind: SlotKind = kindText ? SLOT_KIND_MAP[kindText] : 'regular';
          if (kindText && !SLOT_KIND_MAP[kindText]) {
            issues.push('教学计划 第' + row.row + '行时段类型无法识别：' + kindText + '（可填 早读/常规/晚自习/补课）');
            continue;
          }
          const key = classItem.id + '|' + subjectItem.id + '|' + teacherItem.id + '|' + weeks;
          if (planKeys.has(key)) {
            issues.push('教学计划 第' + row.row + '行重复：' + className + ' / ' + subjectName);
            continue;
          }
          planKeys.add(key);
          plans.push({ id: uid('plan'), classId: classItem.id, subjectId: subjectItem.id, teacherId: teacherItem.id, weeklyPeriods, roomType, fixedSlotId, weeks, kind: planKind });
        }
        next.coursePlans = plans;
      }
      if (issues.length) {
        setError('导入校验未通过（未写入数据）：\n' + issues.join('\n'));
        return;
      }
      commit(next, { invalidate: true, immediate: true });
      setError('');
      setNotice((replaceOnImport ? '已清空并导入：' : 'Excel 导入完成：') + '班级 ' + next.classes.length + '，教师 ' + next.teachers.length + '，学科 ' + next.subjects.length + '，教室 ' + next.rooms.length + '，时间段 ' + next.timeSlots.length + '，教学计划 ' + next.coursePlans.length);
    } catch (cause) {
      setError('Excel 导入失败：' + messageOf(cause));
    }
  };

  const downloadTemplate = async () => {
    try {
      const bytes = buildImportTemplate();
      const savedPath = await download(
        new Blob([bytes.buffer as ArrayBuffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'warpweft-import-template.xlsx',
      );
      setNotice(savedPath ? '模板已保存到 ' + savedPath : '模板已开始下载，请查看系统下载目录');
    } catch (cause) {
      setError('下载模板失败：' + messageOf(cause));
    }
  };

  if (kind === 'import') {
    return (
      <div className="resource-single">
        <section className="section-panel resource-panel import-panel">
          <div className="panel-head"><SectionHeading english="IMPORT / VALIDATE" title="Excel 导入" /></div>
          <p className="panel-note">支持学校、班级、教师、学科、教室、时间段和教学计划。建议先下载模板；基础资料按名称复用，教学计划会整体替换，导入后自动清空候选课表。</p>
          <div className="import-actions">
            <label className="file-button file-button-primary">
              <span>选择 Excel 文件</span>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importWorkbookFile(file);
                  event.currentTarget.value = '';
                }}
              />
            </label>
            <button type="button" className="file-button" onClick={() => void downloadTemplate()}>
              下载模板
            </button>
          </div>
          <label className="import-replace">
            <input type="checkbox" checked={replaceOnImport} onChange={(event) => setReplaceOnImport(event.target.checked)} />
            <span>导入前清空当前工作区</span>
          </label>
          <p className="panel-note">仅支持 Excel（.xlsx/.xls）；模板包含“说明、学校、班级、教师、学科、教室、时间段、教学计划”工作表。测试完整数据集时建议勾选上方清空选项。</p>
        </section>
      </div>
    );
  }

  if (kind === 'classes') {
    return (
      <div className="resource-single">
        <EditableTable<ClassRoom>
          title="班级"
          english="CLASS REGISTER"
          rows={data.classes}
          columns={[
            { key: 'name', label: '班级名称', width: '38%' },
            { key: 'grade', label: '年级', width: '30%' },
            { key: 'size', label: '人数', type: 'number', width: '22%' },
          ]}
          onChange={(id, key, value) => update('classes', id, key, value)}
          onAdd={() => add('classes')}
          onRemove={(id) => remove('classes', id)}
          addLabel="新增班级"
          note="班级人数会影响教室容量校验；被教学计划引用的班级不能删除。"
        />
      </div>
    );
  }

  if (kind === 'teachers') {
    return (
      <div className="resource-single">
        <EditableTable<Teacher>
          title="教师"
          english="TEACHER REGISTER"
          rows={data.teachers}
          columns={[{ key: 'name', label: '教师姓名', width: '78%' }]}
          onChange={(id, key, value) => update('teachers', id, key, value)}
          onAdd={() => add('teachers')}
          onRemove={(id) => remove('teachers', id)}
          addLabel="新增教师"
          note="教师不能在同一时间上两门课；被教学计划引用的教师不能删除。"
        />
      </div>
    );
  }

  if (kind === 'subjects') {
    return (
      <div className="resource-single">
        <EditableTable<Subject>
          title="学科"
          english="SUBJECT REGISTER"
          rows={data.subjects}
          columns={[{ key: 'name', label: '学科名称', width: '78%' }]}
          onChange={(id, key, value) => update('subjects', id, key, value)}
          onAdd={() => add('subjects')}
          onRemove={(id) => remove('subjects', id)}
          addLabel="新增学科"
          note="教学计划通过学科引用课程名称。"
        />
      </div>
    );
  }

  if (kind === 'rooms') {
    return (
      <div className="resource-single">
        <EditableTable<Room>
          title="教室"
          english="ROOM REGISTER"
          rows={data.rooms}
          columns={[
            { key: 'name', label: '教室名称', width: '38%' },
            { key: 'capacity', label: '容量', type: 'number', width: '22%' },
            { key: 'type', label: '类型', width: '34%' },
          ]}
          onChange={(id, key, value) => update('rooms', id, key, value)}
          onAdd={() => add('rooms')}
          onRemove={(id) => remove('rooms', id)}
          addLabel="新增教室"
          note="教室类型会与教学计划的教室类型要求匹配；容量必须大于等于班级人数。"
        />
      </div>
    );
  }

  if (kind === 'timeSlots') {
    return (
      <div className="resource-single resource-stack">
        <section className="section-panel slot-batch">
          <div className="panel-head"><SectionHeading english="BATCH TIME SLOTS" title="批量生成时间段" /><span className="status-tag muted">多选</span></div>
          <p className="panel-note">勾选星期并设置节次范围，一次生成整周时间段；已存在的节次会自动跳过。</p>
          <div className="slot-batch-form">
            <div className="slot-day-picker">
              {DAYS.slice(1).map((label, index) => {
                const day = index + 1;
                return (
                  <label key={day} className={batchDays.includes(day) ? 'slot-day active' : 'slot-day'}>
                    <input
                      type="checkbox"
                      checked={batchDays.includes(day)}
                      onChange={() => setBatchDays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day])}
                    />
                    {label}
                  </label>
                );
              })}
            </div>
            <label className="slot-range">起始节次<input type="number" min={1} max={12} value={batchFrom} onChange={(event) => setBatchFrom(Number(event.target.value))} /></label>
            <label className="slot-range">结束节次<input type="number" min={1} max={12} value={batchTo} onChange={(event) => setBatchTo(Number(event.target.value))} /></label>
            <button type="button" className="mini-button" onClick={addBatchSlots}>生成时间段</button>
          </div>
        </section>
        <EditableTable<TimeSlot>
          title="时间段"
          english="TIME SLOTS"
          rows={data.timeSlots}
          columns={[
            { key: 'day', label: '星期', type: 'select', options: days, width: '14%' },
            { key: 'period', label: '节次', type: 'number', width: '10%' },
            { key: 'kind', label: '时段类型', type: 'select', options: SLOT_KIND_OPTIONS, width: '18%', defaultValue: 'regular' },
            { key: 'start', label: '开始', width: '12%' },
            { key: 'duration', label: '分钟', type: 'number', width: '10%' },
            { key: 'label', label: '显示名称', width: '30%' },
          ]}
          onChange={(id, key, value) => update('timeSlots', id, key, value)}
          onAdd={() => add('timeSlots')}
          onRemove={(id) => remove('timeSlots', id)}
          addLabel="新增时间段"
          note="修改星期或节次会清空候选课表；请先确认课表结构。"
        />
      </div>
    );
  }

  return null;
}

export { ResourcesPage };


