const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { solve } = require('./java-solver-helper.cjs');

test('demo data produces a feasible schedule', () => {
  const input = JSON.parse(fs.readFileSync('database/seeds/demo.json', 'utf8'));
  Object.assign(input, {
    protocolVersion: '1.0',
    dataSnapshotVersion: 'test',
    hardConstraints: [],
    softConstraints: [],
    unavailableSlots: [],
    lockedEntries: [],
    timeLimitSeconds: 30,
    randomSeed: 1,
  });
  const process = solve(input);
  assert.equal(process.status, 0, process.stderr || 'Java solver process failed');
  const out = JSON.parse(process.stdout);
  assert.equal(out.status, 'COMPLETED');
  assert.equal(out.hasFeasibleSolution, true);
  assert.equal(out.entries.length, 21);
});
