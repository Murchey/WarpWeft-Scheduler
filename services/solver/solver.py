#!/usr/bin/env python3
"""Small, dependency-light greedy solver for the MVP protocol.

If OR-Tools is installed it can be used as a future adapter; the baseline solver
is intentionally deterministic and handles the MVP hard constraints locally.
"""
import json, sys, time

try:
    from ortools.sat.python import cp_model
except ImportError:
    cp_model = None

def solve_cp_sat(inp):
    started = time.time(); model = cp_model.CpModel(); slots = inp['timeSlots']; rooms = inp['rooms']; classes = {x['id']:x for x in inp['classes']}
    unavailable = {(x['teacherId'], x['slotId']) for x in inp.get('unavailableSlots', [])}; tasks=[]
    for plan in inp['coursePlans']:
        for occurrence in range(plan['weeklyPeriods']): tasks.append((plan, occurrence))
    choices = {}; by_class={}; by_teacher={}; by_room={}
    for ti, (plan, occurrence) in enumerate(tasks):
        allowed_slots=[s for s in slots if not plan.get('fixedSlotId') or s['id']==plan['fixedSlotId']]
        vars=[]
        for slot in allowed_slots:
            if (plan['teacherId'],slot['id']) in unavailable: continue
            for room in rooms:
                if plan.get('roomType') and room['type'] != plan['roomType']: continue
                if room['capacity'] < classes[plan['classId']]['size']: continue
                v=model.NewBoolVar(f'x_{ti}_{slot["id"]}_{room["id"]}'); vars.append((v,slot,room))
                for group,key in ((by_class,(plan['classId'],slot['id'])),(by_teacher,(plan['teacherId'],slot['id'])),(by_room,(room['id'],slot['id']))): group.setdefault(key,[]).append(v)
        if not vars: raise ValueError(f"课程计划 {plan['id']} 第 {occurrence+1} 课时没有可行资源")
        model.AddExactlyOne([v for v,_,_ in vars]); choices[ti]=vars
    for group in (by_class,by_teacher,by_room):
        for vars in group.values(): model.AddAtMostOne(vars)
    # Prefer spreading each plan across different days while keeping the objective readable.
    model.Maximize(sum(v * (1 + (slot['day'] % 2)) for vars in choices.values() for v,slot,_ in vars))
    solver=cp_model.CpSolver(); solver.parameters.max_time_in_seconds=float(inp.get('timeLimitSeconds',30)); solver.parameters.random_seed=int(inp.get('randomSeed',1)); solver.parameters.num_search_workers=1
    status=solver.Solve(model); feasible=status in (cp_model.OPTIMAL,cp_model.FEASIBLE)
    entries=[]
    if feasible:
        for ti,(plan,_) in enumerate(tasks):
            for v,slot,room in choices[ti]:
                if solver.Value(v): entries.append({'id':f"entry-{plan['id']}-{ti}",'coursePlanId':plan['id'],'classId':plan['classId'],'teacherId':plan['teacherId'],'roomId':room['id'],'slotId':slot['id'],'source':'AUTO','locked':bool(plan.get('locked'))}); break
    state='COMPLETED' if status==cp_model.OPTIMAL else ('FEASIBLE' if feasible else ('TIMEOUT' if status==cp_model.UNKNOWN else 'FAILED'))
    return {'protocolVersion':inp['protocolVersion'],'status':state,'entries':entries,'hardConstraintViolations':[] if feasible else ['Solver 没有找到满足硬约束的安排'],'softScore':round(solver.ObjectiveValue()) if feasible else 0,'scoreBreakdown':{'subjectDistribution':0,'teacherContinuous':0,'teacherGaps':0,'teacherWorkloadBalance':0},'unsatisfiedRules':[] if feasible else ['资源或时间不足'],'explanation':'OR-Tools CP-SAT 已生成可行课表' if feasible else '请增加可用时间或教室资源。','elapsedMs':round((time.time()-started)*1000),'hasFeasibleSolution':feasible}

def solve(inp):
    started = time.time(); slots = inp['timeSlots']; rooms = inp['rooms']; classes = {x['id']:x for x in inp['classes']}
    unavailable = {(x['teacherId'], x['slotId']) for x in inp.get('unavailableSlots', [])}
    used_class, used_teacher, used_room = set(), set(), set(); entries=[]; violations=[]
    locked = {x['coursePlanId']: x for x in inp.get('lockedEntries', [])}
    subject_load = {}
    expanded=[]
    for plan in inp['coursePlans']:
        for n in range(plan['weeklyPeriods']): expanded.append((plan, n))
    expanded.sort(key=lambda x: (x[0].get('fixedSlotId') is None, -x[0]['weeklyPeriods']))
    for plan, occurrence in expanded:
        options=[]
        if plan.get('fixedSlotId'): options=[x for x in slots if x['id']==plan['fixedSlotId']]
        else: options=slots
        placed=None
        if plan['id'] in locked and occurrence == 0: placed=locked[plan['id']]
        if placed:
            entries.append(placed); used_class.add((placed['classId'],placed['slotId'])); used_teacher.add((placed['teacherId'],placed['slotId'])); used_room.add((placed['roomId'],placed['slotId'])); continue
        for slot in options:
            if (plan['classId'],slot['id']) in used_class or (plan['teacherId'],slot['id']) in used_teacher or (plan['teacherId'],slot['id']) in unavailable: continue
            room = next((r for r in rooms if (not plan.get('roomType') or r['type']==plan['roomType']) and r['capacity']>=classes[plan['classId']]['size'] and (r['id'],slot['id']) not in used_room), None)
            if room: placed={'id':f"entry-{plan['id']}-{occurrence+1}",'coursePlanId':plan['id'],'classId':plan['classId'],'teacherId':plan['teacherId'],'roomId':room['id'],'slotId':slot['id'],'source':'AUTO','locked':bool(plan.get('locked'))}; break
        if not placed:
            violations.append(f"课程计划 {plan['id']} 第 {occurrence+1} 课时没有可用时间或教室")
        else:
            entries.append(placed); used_class.add((placed['classId'],placed['slotId'])); used_teacher.add((placed['teacherId'],placed['slotId'])); used_room.add((placed['roomId'],placed['slotId']))
    status='COMPLETED' if not violations else 'FAILED'; elapsed=round((time.time()-started)*1000)
    return {'protocolVersion':inp['protocolVersion'],'status':status,'entries':entries,'hardConstraintViolations':violations,'softScore':max(0,100-len(entries)),'scoreBreakdown':{'subjectDistribution':0,'teacherContinuous':0,'teacherGaps':0,'teacherWorkloadBalance':0},'unsatisfiedRules':[] if not violations else ['资源或时间不足'],'explanation':'已生成可行课表' if not violations else '存在无法安排的课程，请检查教师可用时间、教室容量或固定时间。','elapsedMs':elapsed,'hasFeasibleSolution':not violations}

if __name__ == '__main__':
    try:
        payload=json.load(sys.stdin)
        print(json.dumps(solve_cp_sat(payload) if cp_model else solve(payload), ensure_ascii=False))
    except Exception as exc: print(json.dumps({'protocolVersion':'unknown','status':'FAILED','entries':[],'hardConstraintViolations':[str(exc)],'softScore':0,'scoreBreakdown':{},'unsatisfiedRules':[],'explanation':'Solver 输入无效','elapsedMs':0,'hasFeasibleSolution':False}, ensure_ascii=False)); sys.exit(1)
