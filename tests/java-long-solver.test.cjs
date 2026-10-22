const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { solve } = require('./java-solver-helper.cjs');

const demo = JSON.parse(fs.readFileSync('database/seeds/demo.json', 'utf8'));

function tempCheckpoint(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpweft-checkpoint-'));
  return { dir, file: path.join(dir, name) };
}

function baseInput(overrides = {}) {
  return {
    ...demo,
    protocolVersion: '1.0',
    dataSnapshotVersion: 'java-long-test',
    hardConstraints: [],
    softConstraints: [],
    unavailableSlots: [],
    lockedEntries: [],
    rules: [],
    timeLimitSeconds: 10,
    randomSeed: 1,
    ...overrides,
  };
}

test('solver writes a checkpoint and progress lines', () => {
  const { file } = tempCheckpoint('best.json');
  const result = solve(baseInput({ checkpointFile: file }));
  assert.equal(result.status, 0, result.stderr || 'Java solver process failed');
  const output = JSON.parse(result.stdout);
  assert.equal(output.hasFeasibleSolution, true);
  assert.match(result.stderr, /\[progress\]/);

  assert.ok(fs.existsSync(file), 'checkpoint file exists');
  const checkpoint = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(checkpoint.total, 21);
  assert.equal(checkpoint.placed, 21);
  assert.equal(checkpoint.unplaced, 0);
  assert.equal(checkpoint.entries.length, 21);
  assert.ok(checkpoint.entries.every((entry) => typeof entry.slotId === 'string'));
});

test('resuming from seed entries keeps them as the starting point', () => {
  const { file } = tempCheckpoint('resume.json');
  const first = JSON.parse(solve(baseInput({ checkpointFile: file })).stdout);
  const checkpoint = JSON.parse(fs.readFileSync(file, 'utf8'));

  const resumed = JSON.parse(
    solve(
      baseInput({
        checkpointFile: file,
        dataSnapshotVersion: 'resume',
        randomSeed: 9,
        seedEntries: checkpoint.entries,
        timeLimitSeconds: 10,
      }),
    ).stdout,
  );
  assert.equal(resumed.hasFeasibleSolution, true);
  assert.equal(resumed.entries.length, first.entries.length);
  // Seeds are movable, but a feasible resume must still cover every plan.
  const plans = new Set(resumed.entries.map((entry) => entry.coursePlanId));
  assert.equal(plans.size, demo.coursePlans.length);
});

test('stagnation stops an impossible run long before the deadline', () => {
  // Two plans share a fixed slot: unsolvable. Without stagnation this would
  // burn the whole 20 second limit.
  const coursePlans = demo.coursePlans.map((plan) => ({ ...plan }));
  coursePlans[0].fixedSlotId = 'mon-1';
  coursePlans[1].fixedSlotId = 'mon-1';
  const started = Date.now();
  const result = solve(
    baseInput({
      coursePlans,
      timeLimitSeconds: 20,
      stagnationSeconds: 1,
    }),
  );
  const wallMs = Date.now() - started;
  assert.equal(result.status, 0, result.stderr || 'Java solver process failed');
  const output = JSON.parse(result.stdout);
  assert.equal(output.hasFeasibleSolution, false);
  assert.ok(wallMs < 12000, 'stagnation should stop the run early, took ' + wallMs + 'ms');
  assert.match(result.stderr, /stagnation/);
});
