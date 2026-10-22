#!/usr/bin/env node
// Synthetic school data for solver benchmarks and tests.
//
//   node scripts/synthetic-data.cjs --classes 24 --lessons 24 --out data/synthetic-24.json
//
// The shape matches `SolverInput`, so the output can be piped straight into the
// Java solver. The generator is deterministic: the same options always produce
// the same dataset, which keeps benchmark numbers comparable between runs.
//
// Topology (deliberately solvable):
//   - every class owns one homeroom (capacity 50), so rooms never bottleneck;
//   - each subject has one teacher per group of `classBlock` classes, so a
//     teacher's weekly load stays far below the slot count;
//   - no unavailable slots and no extra rules: any failure is the solver's.

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    result[key] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return result;
}

function seededRandom(seed) {
  let state = (Number(seed) || 1) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * @param {object} [options]
 * @param {number} [options.classes]      number of classes (default 24)
 * @param {number} [options.lessons]      weekly lessons per class (default 24)
 * @param {number} [options.days]         teaching days (default 5)
 * @param {number} [options.periods]      periods per day (default 8)
 * @param {number} [options.subjects]     subjects per class (default 6)
 * @param {number} [options.classBlock]   classes sharing one subject teacher (default 4)
 * @param {number} [options.roomShare]    classes per homeroom (default 1; >1 tightens rooms)
 * @param {number} [options.unavailable]  unavailable slots per teacher (default 0)
 * @param {number} [options.size]         class size (default 40)
 * @param {number} [options.timeLimitSeconds]
 * @param {number} [options.seed]
 */
function buildSyntheticInput(options = {}) {
  const classCount = Math.max(1, Number(options.classes) || 24);
  const lessonsPerClass = Math.max(1, Number(options.lessons) || 24);
  const days = Math.max(1, Number(options.days) || 5);
  const periods = Math.max(1, Number(options.periods) || 8);
  const subjectCount = Math.max(1, Number(options.subjects) || 6);
  const classBlock = Math.max(1, Number(options.classBlock) || 4);
  const classSize = Math.max(1, Number(options.size) || 40);
  const roomShare = Math.max(1, Number(options.roomShare) || 1);
  const unavailablePerTeacher = Math.max(0, Number(options.unavailable) || 0);
  const seed = Number(options.seed) || 1;
  const random = seededRandom(seed);

  const timeSlots = [];
  for (let day = 1; day <= days; day += 1) {
    for (let period = 1; period <= periods; period += 1) {
      timeSlots.push({
        id: `d${day}-p${period}`,
        day,
        period,
        label: `第${day}天 第${period}节`,
      });
    }
  }

  const classes = [];
  const rooms = [];
  for (let index = 1; index <= classCount; index += 1) {
    const grade = Math.ceil(index / 10);
    classes.push({ id: `class-${index}`, name: `${grade}年级${((index - 1) % 10) + 1}班`, size: classSize, grade: `${grade}年级` });
  }
  const roomCount = Math.max(1, Math.ceil(classCount / roomShare));
  for (let index = 1; index <= roomCount; index += 1) {
    rooms.push({ id: `room-${index}`, name: `教室${index}`, capacity: classSize + 10, type: '普通教室' });
  }

  const subjects = [];
  for (let index = 1; index <= subjectCount; index += 1) {
    subjects.push({ id: `subject-${index}`, name: `学科${index}` });
  }

  const teachers = [];
  const teacherIdOf = (subjectIndex, blockIndex) => `teacher-${subjectIndex + 1}-${blockIndex + 1}`;
  for (let subjectIndex = 0; subjectIndex < subjectCount; subjectIndex += 1) {
    for (let blockIndex = 0; blockIndex < Math.ceil(classCount / classBlock); blockIndex += 1) {
      teachers.push({ id: teacherIdOf(subjectIndex, blockIndex), name: `教师${subjectIndex + 1}-${blockIndex + 1}` });
    }
  }

  const perSubject = splitLessons(lessonsPerClass, subjectCount, seededRandom(seed));
  const unavailableSlots = [];
  if (unavailablePerTeacher > 0) {
    for (const teacher of teachers) {
      for (let count = 0; count < unavailablePerTeacher; count += 1) {
        const slot = timeSlots[Math.floor(random() * timeSlots.length)];
        const exists = unavailableSlots.some((item) => item.teacherId === teacher.id && item.slotId === slot.id);
        if (!exists) unavailableSlots.push({ teacherId: teacher.id, slotId: slot.id });
      }
    }
  }
  const coursePlans = [];
  let planSequence = 0;
  for (let classIndex = 0; classIndex < classCount; classIndex += 1) {
    for (let subjectIndex = 0; subjectIndex < subjectCount; subjectIndex += 1) {
      const weekly = perSubject[subjectIndex];
      if (weekly <= 0) continue;
      planSequence += 1;
      coursePlans.push({
        id: `plan-${planSequence}`,
        classId: `class-${classIndex + 1}`,
        subjectId: `subject-${subjectIndex + 1}`,
        teacherId: teacherIdOf(subjectIndex, Math.floor(classIndex / classBlock)),
        weeklyPeriods: weekly,
      });
    }
  }

  return {
    protocolVersion: '1.0',
    dataSnapshotVersion: `synthetic-${classCount}x${lessonsPerClass}-${seed}`,
    school: { id: 'school-synthetic', name: `合成数据 ${classCount} 班` },
    timeSlots,
    classes,
    teachers,
    subjects,
    rooms,
    coursePlans,
    unavailableSlots,
    lockedEntries: [],
    hardConstraints: ['NO_CLASS_CONFLICT', 'NO_TEACHER_CONFLICT', 'ROOM_CAPACITY'],
    rules: [],
    softConstraints: [
      { kind: 'SUBJECT_DISTRIBUTION', weight: 3 },
      { kind: 'TEACHER_CONTINUOUS', weight: 2 },
      { kind: 'TEACHER_GAPS', weight: 1 },
      { kind: 'TEACHER_WORKLOAD_BALANCE', weight: 2 },
    ],
    timeLimitSeconds: Number(options.timeLimitSeconds) || 30,
    randomSeed: seed,
  };
}

/** Split `total` lessons over `parts` subjects with no zero-sized subject. */
function splitLessons(total, parts, random) {
  if (parts >= total) return Array.from({ length: parts }, (_, index) => (index < total ? 1 : 0));
  const base = Math.floor(total / parts);
  const result = Array.from({ length: parts }, () => base);
  let remainder = total - base * parts;
  while (remainder > 0) {
    result[Math.floor(random() * parts)] += 1;
    remainder -= 1;
  }
  return result;
}

module.exports = { buildSyntheticInput };

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const input = buildSyntheticInput({
    classes: Number(args.classes) || 24,
    lessons: Number(args.lessons) || 24,
    days: Number(args.days) || 5,
    periods: Number(args.periods) || 8,
    subjects: Number(args.subjects) || 6,
    classBlock: Number(args['class-block']) || 4,
    roomShare: Number(args['room-share']) || 1,
    unavailable: Number(args.unavailable) || 0,
    seed: Number(args.seed) || 1,
    timeLimitSeconds: Number(args['time-limit']) || 30,
  });
  if (args.out) {
    require('node:fs').writeFileSync(args.out, JSON.stringify(input, null, 2), 'utf8');
    console.log(`synthetic data: ${input.classes.length} classes, ${input.coursePlans.reduce((sum, plan) => sum + plan.weeklyPeriods, 0)} lessons -> ${args.out}`);
  } else {
    process.stdout.write(JSON.stringify(input));
  }
}
