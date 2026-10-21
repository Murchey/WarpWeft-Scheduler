const fs = require('node:fs');
const { solve } = require('../tests/java-solver-helper.cjs');
const input = JSON.parse(fs.readFileSync('database/seeds/demo.json', 'utf8'));
Object.assign(input, { protocolVersion: '1.0', dataSnapshotVersion: 'demo-v1', hardConstraints: [], softConstraints: [], unavailableSlots: [], lockedEntries: [], timeLimitSeconds: 30, randomSeed: 1 });
const result = solve(input);
console.log(result.stdout);
if (result.status !== 0) process.exit(result.status);
