import type { ClassRoom, CoursePlan, SchoolData, Subject, Teacher, TimeSlot } from './types';
// 带扩展名：node --test 直接 import 本模块时无法解析无扩展名的相对路径
import { NEW_WORKSPACE_SOFT_CONSTRAINTS } from './softConstraints.ts';
import { uid } from './utils.ts';

/**
 * 一份可被服务端 validateData 完全接受的最小工作区。
 *
 * 校验要求：六个基础数组存在、元素 id 唯一非空、roomMode 合法、
 * softConstraints 合法。空数组天然满足引用完整性，因此这是最安全的空白起点。
 */
export function createEmptyWorkspace(name = '新工程'): SchoolData {
  return {
    school: { id: 'school-' + uid('w'), name: name.trim() || '未命名学校' },
    roomMode: 'simplified',
    classes: [],
    teachers: [],
    subjects: [],
    rooms: [],
    timeSlots: [],
    coursePlans: [],
    unavailableSlots: [],
    rules: [],
    adjustments: [],
    electiveGroups: [],
    lessonLogs: [],
    softConstraints: NEW_WORKSPACE_SOFT_CONSTRAINTS.map((item) => ({ ...item })),
    candidate: null,
    published: null,
    candidateVersion: null,
    publishedVersion: null,
    auditLog: [],
  };
}

/**
 * 工作区是否"实质上为空"（没有班级、教师与教学计划）。
 * 用于判断切换/新建工程时是否会丢弃用户数据，避免静默覆盖。
 */
export function isWorkspaceEmpty(
  data: Pick<SchoolData, 'classes' | 'teachers' | 'coursePlans'>,
): boolean {
  return data.classes.length === 0 && data.teachers.length === 0 && data.coursePlans.length === 0;
}

/**
 * 一份"开箱就能排一课"的示例数据：5 天 × 4 节、1 班 1 师 1 学科 1 条教学计划。
 * 用于新建工程后立即验证导入→排课→预览整条链路是否通畅。
 */
export function createSampleWorkspace(name = '示例工程'): SchoolData {
  const base = createEmptyWorkspace(name);
  const classId = 'class-' + uid('w');
  const teacherId = 'teacher-' + uid('w');
  const subjectId = 'subject-' + uid('w');
  const className = '一年级1班';
  const teacherName = '示例教师';

  const klass: ClassRoom = {
    id: classId,
    name: className,
    size: 40,
    grade: '一年级',
    homeroomTeacherId: teacherId,
  };
  const teacher: Teacher = {
    id: teacherId,
    name: teacherName,
    grade: '一年级',
    subject: '语文',
    classes: className,
  };
  const subject: Subject = { id: subjectId, name: '语文', preference: 'morning' };

  const dayNames = ['一', '二', '三', '四', '五'];
  const timeSlots: TimeSlot[] = [];
  for (let day = 1; day <= 5; day += 1) {
    for (let period = 1; period <= 4; period += 1) {
      timeSlots.push({
        id: 'slot-' + day + '-' + period,
        day,
        period,
        label: '周' + dayNames[day - 1] + ' 第' + period + '节',
        kind: 'regular',
      });
    }
  }

  const plan: CoursePlan = {
    id: 'plan-' + uid('w'),
    classId,
    subjectId,
    teacherId,
    weeklyPeriods: 1,
  };

  return {
    ...base,
    classes: [klass],
    teachers: [teacher],
    subjects: [subject],
    timeSlots,
    coursePlans: [plan],
  };
}
