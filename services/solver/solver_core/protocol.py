from typing import Any

SCORE_KEYS = ('subjectDistribution', 'teacherContinuous', 'teacherGaps', 'teacherWorkloadBalance')

def empty_result(protocol_version: str = 'unknown') -> dict[str, Any]:
    return {'protocolVersion': protocol_version, 'status': 'FAILED', 'entries': [], 'hardConstraintViolations': [], 'softScore': 0, 'scoreBreakdown': {key: 0 for key in SCORE_KEYS}, 'unsatisfiedRules': [], 'explanation': '', 'elapsedMs': 0, 'hasFeasibleSolution': False}

def expand_tasks(payload: dict[str, Any]) -> list[tuple[dict[str, Any], int]]:
    return [(plan, occurrence) for plan in payload.get('coursePlans', []) for occurrence in range(int(plan.get('weeklyPeriods', 0)))]
