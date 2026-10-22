#!/usr/bin/env node
// Solver benchmark: run the Java solver on synthetic datasets and report how
// many lessons it manages to place within the time limit.
//
//   node scripts/bench-solver.cjs --classes 24,48,96 --time-limit 30
//
// Exit code is 0 when every dataset completes (all lessons placed) and 2 when
// at least one dataset is incomplete. That makes it usable in a smoke test.

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildSyntheticInput } = require('./synthetic-data.cjs');

const root = path.resolve(__dirname, '..');
const jar = path.join(root, 'resources', 'solver', 'warpweft-solver.jar');
const java = process.env.JAVA_HOME
  ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  : 'java';

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

const args = parseArgs(process.argv.slice(2));
const classList = String(args.classes || '24,96')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => value > 0);
const lessonsPerClass = Number(args.lessons) || 0;
const timeLimit = Number(args['time-limit']) || 30;
const seed = Number(args.seed) || 1;

if (!require('node:fs').existsSync(jar)) {
  console.error('Java solver jar not built: ' + jar + '（先运行 npm run build:solver）');
  process.exit(1);
}

function run(input) {
  const started = Date.now();
  const result = spawnSync(java, ['-jar', jar], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: (input.timeLimitSeconds + 120) * 1000,
  });
  const wallMs = Date.now() - started;
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || '').trim() || 'solver exited with ' + result.status);
  }
  return { output: JSON.parse(result.stdout), wallMs, stderr: result.stderr || '' };
}

const rows = [];
for (const classCount of classList) {
  // Match the plan's reference sizes: 24 classes × 24 lessons and 96 × 30.
  const lessons = lessonsPerClass || (classCount >= 96 ? 30 : 24);
  const input = buildSyntheticInput({
    classes: classCount,
    lessons,
    timeLimitSeconds: timeLimit,
    seed,
    classBlock: Number(args['class-block']) || 4,
    roomShare: Number(args['room-share']) || 1,
    unavailable: Number(args.unavailable) || 0,
  });
  const total = input.coursePlans.reduce((sum, plan) => sum + plan.weeklyPeriods, 0);
  const { output, wallMs, stderr } = run(input);
  const placed = output.entries.length;
  rows.push({
    classes: classCount,
    rooms: input.rooms.length,
    lessons: total,
    placed,
    ratio: total > 0 ? placed / total : 1,
    status: output.status,
    feasible: !!output.hasFeasibleSolution,
    elapsedMs: output.elapsedMs,
    wallMs,
    stderr,
  });
  console.log(
    `${classCount} 班 / ${input.rooms.length} 教室 / ${total} 课时：已排 ${placed}/${total} (${((placed / total) * 100).toFixed(1)}%) · ` +
      `${output.status} · ${output.elapsedMs} ms`,
  );
}

require('node:fs').writeFileSync(
  path.join(root, 'data', 'bench-solver.json'),
  JSON.stringify({ at: new Date().toISOString(), timeLimit, seed, rows: rows.map(({ stderr, ...row }) => row) }, null, 2),
  'utf8',
);

process.exitCode = rows.every((row) => row.feasible) ? 0 : 2;
