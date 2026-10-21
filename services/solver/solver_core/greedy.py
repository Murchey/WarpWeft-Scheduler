import time
from .protocol import expand_tasks, SCORE_KEYS


def solve_greedy(payload):
    started = time.time()
    slots = payload['timeSlots']
    rooms = payload['rooms']
    classes = {x['id']: x for x in payload['classes']}
    unavailable = {
        (x['teacherId'], x['slotId'])
        for x in payload.get('unavailableSlots', [])
    }
    locked_by_plan = {}
    for entry in payload.get('lockedEntries', []):
        locked_by_plan.setdefault(entry['coursePlanId'], []).append(entry)

    entries = []
    violations = []
    used_class = set()
    used_teacher = set()
    used_room = set()

    # Reserve every locked entry before placing new lessons. Otherwise a new
    # lesson could take the same slot as a manually locked one.
    for locked in locked_by_plan.values():
        for entry in locked:
            keys = (
                (entry['classId'], entry['slotId'], used_class),
                (entry['teacherId'], entry['slotId'], used_teacher),
                (entry['roomId'], entry['slotId'], used_room),
            )
            if any((item[0], item[1]) in bag for item in keys for bag in [item[2]]):
                violations.append('锁定课程 %s 与其他锁定课程冲突' % entry.get('id'))
                continue
            entries.append(
                {
                    **entry,
                    'source': 'MANUAL',
                    'locked': True,
                }
            )
            used_class.add((entry['classId'], entry['slotId']))
            used_teacher.add((entry['teacherId'], entry['slotId']))
            used_room.add((entry['roomId'], entry['slotId']))

    tasks = sorted(
        expand_tasks(payload),
        key=lambda item: (
            item[0].get('fixedSlotId') is None,
            -item[0]['weeklyPeriods'],
        ),
    )
    for plan, occurrence in tasks:
        locked = locked_by_plan.get(plan['id'], [])
        if occurrence < len(locked):
            continue
        options = [
            slot
            for slot in slots
            if not plan.get('fixedSlotId') or slot['id'] == plan['fixedSlotId']
        ]
        placed = None
        for slot in options:
            if (plan['classId'], slot['id']) in used_class:
                continue
            if (plan['teacherId'], slot['id']) in used_teacher:
                continue
            if (plan['teacherId'], slot['id']) in unavailable:
                continue
            room = next(
                (
                    item
                    for item in rooms
                    if (not plan.get('roomType') or item['type'] == plan['roomType'])
                    and item['capacity'] >= classes[plan['classId']]['size']
                    and (item['id'], slot['id']) not in used_room
                ),
                None,
            )
            if room:
                placed = {
                    'id': 'entry-%s-%s' % (plan['id'], occurrence + 1),
                    'coursePlanId': plan['id'],
                    'classId': plan['classId'],
                    'teacherId': plan['teacherId'],
                    'roomId': room['id'],
                    'slotId': slot['id'],
                    'source': 'AUTO',
                    'locked': bool(plan.get('locked')),
                }
                break
        if not placed:
            violations.append(
                '课程计划 %s 第 %s 课时没有可用时间或教室'
                % (plan['id'], occurrence + 1)
            )
        else:
            entries.append(placed)
            used_class.add((placed['classId'], placed['slotId']))
            used_teacher.add((placed['teacherId'], placed['slotId']))
            used_room.add((placed['roomId'], placed['slotId']))

    return {
        'protocolVersion': payload.get('protocolVersion', 'unknown'),
        'status': 'COMPLETED' if not violations else 'FAILED',
        'entries': entries,
        'hardConstraintViolations': violations,
        'softScore': max(0, 100 - len(violations) * 10),
        'scoreBreakdown': {key: 0 for key in SCORE_KEYS},
        'unsatisfiedRules': [] if not violations else ['资源或时间不足'],
        'explanation': '已生成可行课表'
        if not violations
        else '存在无法安排的课程，请检查教师可用时间、教室容量或固定时间。',
        'elapsedMs': round((time.time() - started) * 1000),
        'hasFeasibleSolution': not violations,
    }
