import time
from .protocol import expand_tasks, SCORE_KEYS


def solve_cp_sat(payload, cp_model):
    started = time.time()
    model = cp_model.CpModel()
    slots = payload['timeSlots']
    rooms = payload['rooms']
    classes = {x['id']: x for x in payload['classes']}
    unavailable = {
        (x['teacherId'], x['slotId'])
        for x in payload.get('unavailableSlots', [])
    }
    tasks = expand_tasks(payload)
    choices = {}
    by_class = {}
    by_teacher = {}
    by_room = {}

    for ti, (plan, occurrence) in enumerate(tasks):
        variables = []
        for slot in [
            s
            for s in slots
            if not plan.get('fixedSlotId') or s['id'] == plan['fixedSlotId']
        ]:
            if (plan['teacherId'], slot['id']) in unavailable:
                continue
            for room in rooms:
                if plan.get('roomType') and room['type'] != plan['roomType']:
                    continue
                if room['capacity'] < classes[plan['classId']]['size']:
                    continue
                variable = model.NewBoolVar(
                    'x_%s_%s_%s' % (ti, slot['id'], room['id'])
                )
                variables.append((variable, slot, room))
                for group, key in (
                    (by_class, (plan['classId'], slot['id'])),
                    (by_teacher, (plan['teacherId'], slot['id'])),
                    (by_room, (room['id'], slot['id'])),
                ):
                    group.setdefault(key, []).append(variable)
        if not variables:
            raise ValueError(
                '课程计划 %s 第 %s 课时没有可行资源' % (plan['id'], occurrence + 1)
            )
        model.AddExactlyOne([variable for variable, _, _ in variables])
        choices[ti] = variables

    for group in (by_class, by_teacher, by_room):
        for variables in group.values():
            model.AddAtMostOne(variables)

    locked_entries = payload.get('lockedEntries', [])
    locked_set = {
        (entry.get('coursePlanId'), entry.get('slotId'), entry.get('roomId'))
        for entry in locked_entries
    }
    pinned = set()
    for entry in locked_entries:
        plan_id = entry.get('coursePlanId')
        for ti, (plan, _) in enumerate(tasks):
            if plan['id'] != plan_id or ti in pinned:
                continue
            matches = [
                variable
                for variable, slot, room in choices[ti]
                if slot['id'] == entry.get('slotId')
                and room['id'] == entry.get('roomId')
            ]
            if not matches:
                raise ValueError(
                    '锁定课程 %s 的教室或时间不可用' % plan_id
                )
            model.Add(matches[0] == 1)
            pinned.add(ti)
            break

    weights = {item.get('kind'): float(item.get('weight', 0)) for item in payload.get('softConstraints', [])}
    distribution_weight = weights.get('SUBJECT_DISTRIBUTION', 0)
    model.Maximize(sum(variable * (1 + slot['day'] % 2 + distribution_weight) for variables in choices.values() for variable, slot, _ in variables))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(
        payload.get('timeLimitSeconds', 30)
    )
    solver.parameters.random_seed = int(payload.get('randomSeed', 1))
    solver.parameters.num_search_workers = 1
    status = solver.Solve(model)
    feasible = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    entries = []
    if feasible:
        for ti, (plan, _) in enumerate(tasks):
            for variable, slot, room in choices[ti]:
                if solver.Value(variable):
                    locked = (
                        plan['id'],
                        slot['id'],
                        room['id'],
                    ) in locked_set
                    entries.append(
                        {
                            'id': 'entry-%s-%s' % (plan['id'], ti),
                            'coursePlanId': plan['id'],
                            'classId': plan['classId'],
                            'teacherId': plan['teacherId'],
                            'roomId': room['id'],
                            'slotId': slot['id'],
                            'source': 'MANUAL' if locked else 'AUTO',
                            'locked': locked,
                        }
                    )
                    break

    state = (
        'COMPLETED'
        if status == cp_model.OPTIMAL
        else (
            'FEASIBLE'
            if feasible
            else ('TIMEOUT' if status == cp_model.UNKNOWN else 'FAILED')
        )
    )
    return {
        'protocolVersion': payload.get('protocolVersion', 'unknown'),
        'status': state,
        'entries': entries,
        'hardConstraintViolations': []
        if feasible
        else ['Solver 没有找到满足硬约束的安排'],
        'softScore': round(solver.ObjectiveValue()) if feasible else 0,
        'scoreBreakdown': {**{key: 0 for key in SCORE_KEYS}, 'SUBJECT_DISTRIBUTION': round(distribution_weight) if feasible else 0},
        'unsatisfiedRules': [] if feasible else ['资源或时间不足'],
        'explanation': 'OR-Tools CP-SAT 已生成可行课表'
        if feasible
        else '请增加可用时间或教室资源。',
        'elapsedMs': round((time.time() - started) * 1000),
        'hasFeasibleSolution': feasible,
    }
