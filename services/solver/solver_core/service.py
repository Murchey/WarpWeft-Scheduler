import json
from .greedy import solve_greedy
from .protocol import empty_result

try:
    from ortools.sat.python import cp_model
except ImportError:
    cp_model=None

def solve(payload):
    if cp_model is None: return solve_greedy(payload)
    from .cp_sat import solve_cp_sat
    return solve_cp_sat(payload, cp_model)

def solve_json(raw):
    try: return json.dumps(solve(json.loads(raw)), ensure_ascii=False)
    except Exception as exc:
        result=empty_result(); result['hardConstraintViolations']=[str(exc)]; result['explanation']='Solver 输入无效'; return json.dumps(result, ensure_ascii=False)
