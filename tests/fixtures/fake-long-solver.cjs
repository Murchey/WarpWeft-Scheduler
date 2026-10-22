// Test-only stand-in for a long-running solve. It emits `[progress]` lines and
// writes the same checkpoint file the Java solver writes, so the server-side
// task registry can be tested without a JVM or a multi-hour wait.
//
//   input.fakeTotal      lessons to report (default: sum of weeklyPeriods)
//   input.fakeStepMs     delay between progress steps (default 80)
//   input.fakeFinish     exit with a feasible output once full
//   input.fakeHang       keep running after full (for pause/resume tests)
let chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', () => {
  let input = {};
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    input = {};
  }
  const plans = Array.isArray(input.coursePlans) ? input.coursePlans : [];
  const slots = Array.isArray(input.timeSlots) ? input.timeSlots : [];
  const rooms = Array.isArray(input.rooms) ? input.rooms : [];
  const total = Number(input.fakeTotal) || plans.reduce((sum, plan) => sum + (Number(plan.weeklyPeriods) || 0), 0) || 10;
  const step = Math.max(20, Number(input.fakeStepMs) || 80);

  const allEntries = [];
  for (let index = 0; index < total; index += 1) {
    const plan = plans[index % Math.max(1, plans.length)] || {};
    const slot = slots[index % Math.max(1, slots.length)] || {};
    const room = rooms[index % Math.max(1, rooms.length)] || {};
    allEntries.push({
      id: 'fake-entry-' + index,
      coursePlanId: plan.id || 'plan-' + index,
      classId: plan.classId || 'class-1',
      teacherId: plan.teacherId || 'teacher-1',
      roomId: room.id || 'room-1',
      slotId: slot.id || 'slot-1',
      source: 'AUTO',
      locked: false,
    });
  }

  function writeCheckpoint(placed) {
    if (!input.checkpointFile) return;
    const fs = require('node:fs');
    const path = require('node:path');
    const body = {
      placed,
      total,
      unplaced: Math.max(0, total - placed),
      score: 100 - placed,
      elapsedMs: placed * step,
      updatedAt: new Date().toISOString(),
      entries: allEntries.slice(0, placed),
    };
    try {
      fs.mkdirSync(path.dirname(input.checkpointFile), { recursive: true });
      fs.writeFileSync(input.checkpointFile, JSON.stringify(body), 'utf8');
    } catch {
      // ignore
    }
    process.stderr.write('[progress] ' + JSON.stringify({ placed, total, unplaced: total - placed, score: 100 - placed, elapsedMs: placed * step }) + '\n');
  }

  // Resuming starts from the checkpoint: it keeps making progress until the
  // total is reached, just like the Java solver.
  const resuming = Array.isArray(input.seedEntries) && input.seedEntries.length > 0;
  let placed = resuming ? Math.min(total, input.seedEntries.length) : 0;
  writeCheckpoint(placed);
  const timer = setInterval(() => {
    placed = Math.min(total, placed + 1);
    writeCheckpoint(placed);
    if (placed >= total && (!input.fakeHang || resuming)) {
      clearInterval(timer);
      process.stdout.write(JSON.stringify({
        protocolVersion: '1.0',
        status: 'COMPLETED',
        entries: allEntries.slice(0, placed),
        hardConstraintViolations: [],
        softScore: 0,
        scoreBreakdown: {},
        unsatisfiedRules: [],
        explanation: 'fake long solver',
        elapsedMs: placed * step,
        hasFeasibleSolution: placed >= total,
      }));
      process.exit(0);
    }
  }, step);
});
