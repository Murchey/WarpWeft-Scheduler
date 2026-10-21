// Test-only solver stand-in: reads solver input from stdin, waits a configurable
// amount of time, then prints a valid SolverOutput. Used by the server queue
// tests so they never depend on a JVM or on Java being installed.
let chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', () => {
  let input = {};
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    input = {};
  }
  const delay = Number(input.fakeSolveMs) || Number(process.env.FAKE_SOLVE_MS) || 120;
  setTimeout(() => {
    process.stdout.write(
      JSON.stringify({
        protocolVersion: '1.0',
        status: input.fakeStatus || 'COMPLETED',
        entries: [],
        hardConstraintViolations: [],
        softScore: 0,
        scoreBreakdown: {},
        unsatisfiedRules: [],
        explanation: 'fake solver',
        elapsedMs: delay,
        hasFeasibleSolution: input.fakeFeasible !== false,
      }),
    );
  }, delay);
});
