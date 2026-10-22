import type { Commit, SchoolData } from './types';
import { SectionHeading } from './components';
import { isValidSemester, semesterWeeks } from '../../../packages/semester/src';

export function SemesterPage({ data, commit }: { data: SchoolData; commit: Commit }) {
  const semester = data.semester ?? { startDate: '', endDate: '' };
  const weeks = semesterWeeks(semester);
  const valid = isValidSemester(semester);
  const update = (patch: Partial<{ startDate: string; endDate: string }>) => {
    commit({ ...data, semester: { ...semester, ...patch } });
  };
  const odd = weeks.filter((week) => week.parity === 'odd').length;
  const even = weeks.length - odd;

  return (
    <section className="section-panel semester-panel">
      <div className="panel-head">
        <div>
          <SectionHeading english="SEMESTER & WEEKS" title="学期周次" />
          <p className="panel-note">
            指定学期开始与结束日期，系统按 7 天一周自动划分；第 1 周为单周，单双周课程和课表周次筛选都以它为准。
          </p>
        </div>
        <span className={valid ? 'status-tag' : 'status-tag muted'}>{valid ? weeks.length + ' 周' : '未设置'}</span>
      </div>

      <div className="semester-form">
        <label>
          开始日期
          <input type="date" value={semester.startDate} onChange={(event) => update({ startDate: event.target.value })} />
        </label>
        <label>
          结束日期
          <input type="date" value={semester.endDate} onChange={(event) => update({ endDate: event.target.value })} />
        </label>
      </div>

      {!valid ? (
        <p className="inline-warning">请填写有效的开始和结束日期；结束日期不能早于开始日期。单双周与周次筛选在设置前不可用。</p>
      ) : (
        <>
          <div className="semester-summary">
            <div><span>总周数</span><b>{weeks.length}</b></div>
            <div><span>单周</span><b>{odd}</b></div>
            <div><span>双周</span><b>{even}</b></div>
            <div><span>起止</span><b>{semester.startDate} ~ {semester.endDate}</b></div>
          </div>
          <div className="semester-weeks">
            {weeks.map((week) => (
              <span key={week.index} className={week.parity === 'odd' ? 'semester-week is-odd' : 'semester-week is-even'}>
                第{week.index}周 · {week.startDate.slice(5)}~{week.endDate.slice(5)}
              </span>
            ))}
          </div>
          <p className="panel-note">
            按 7 天连续划分，最后一周会截到结束日期；如果学校按周一开学，请把开始日期选在周一。修改学期不会清空候选课表。
          </p>
        </>
      )}
    </section>
  );
}
