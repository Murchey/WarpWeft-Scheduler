package com.warpweft.solver.engine;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.warpweft.solver.model.Entry;
import com.warpweft.solver.model.Plan;
import com.warpweft.solver.model.Placement;
import com.warpweft.solver.model.Room;
import com.warpweft.solver.model.Slot;
import com.warpweft.solver.model.SolverData;
import com.warpweft.solver.model.Task;
import com.warpweft.solver.protocol.SolverProtocol;
import com.warpweft.solver.rules.RuleEvaluator;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.TreeSet;

public final class Scheduler {
    public static ObjectNode solve(SolverData data, int timeLimitSeconds, int randomSeed, long started) {
        long deadline = started + timeLimitSeconds * 1_000_000_000L;
        List<String> violations = new ArrayList<>(data.violations);
        State best = null;
        int bestUnplaced = Integer.MAX_VALUE;
        int bestScore = Integer.MIN_VALUE;
        Map<String, Integer> lockedByPlan = new HashMap<>();
        for (Entry entry : data.locked) lockedByPlan.merge(entry.coursePlanId(), 1, Integer::sum);
        for (Map.Entry<String, Integer> item : lockedByPlan.entrySet()) {
            Plan plan = data.plans.stream().filter(p -> p.id().equals(item.getKey())).findFirst().orElse(null);
            if (plan != null && item.getValue() > plan.weeklyPeriods()) violations.add("锁定课程数量超过计划课时：" + plan.id());
        }
        if (!violations.isEmpty()) {
            ObjectNode result = SolverProtocol.failure(data.protocolVersion, violations);
            result.put("elapsedMs", (System.nanoTime() - started) / 1_000_000);
            return result;
        }

        List<Plan> pairedPlans = new ArrayList<>();
        List<Task> tasks = new ArrayList<>();
        for (Plan plan : data.plans) {
            int locked = lockedByPlan.getOrDefault(plan.id(), 0);
            boolean isDouble = plan.weeklyPeriods() >= 2
                && data.rules.stream().anyMatch(rule -> "DOUBLE_PERIOD".equals(rule.kind()) && rule.matchesPlan(plan.teacherId(), plan.subjectId()));
            if (isDouble) {
                pairedPlans.add(plan);
                if ((plan.weeklyPeriods() - locked) % 2 == 1) tasks.add(new Task(plan, plan.weeklyPeriods() - 1));
            } else {
                for (int occurrence = locked; occurrence < plan.weeklyPeriods(); occurrence++) tasks.add(new Task(plan, occurrence));
            }
        }
        int pairedEntries = pairedPlans.stream().mapToInt(plan -> ((plan.weeklyPeriods() - lockedByPlan.getOrDefault(plan.id(), 0)) / 2) * 2).sum();
        int totalEntries = tasks.size() + pairedEntries + data.locked.size();

        // Keep starting fresh constructions until the deadline. The previous
        // fixed cap of 8 attempts made anything above ~8 seconds pointless: the
        // solver returned FAILED while most of the requested budget was unused.
        int attempts = Math.max(8, timeLimitSeconds * 4);
        System.err.println("[java] solve start: " + totalEntries + " entries, " + data.locked.size() + " locked, " + pairedPlans.size() + " paired plans");
        for (int attempt = 0; attempt < attempts && System.nanoTime() < deadline; attempt++) {
            Random random = new Random(randomSeed + attempt * 7919L);
            State state = new State(data.slots, data.rooms, data.classes, data.unavailable, data.rules);
            for (Plan plan : pairedPlans) state.pairedPlans.add(plan.id());
            List<String> attemptViolations = new ArrayList<>();
            for (Entry entry : data.locked) {
                Plan plan = data.plans.stream().filter(p -> p.id().equals(entry.coursePlanId())).findFirst().orElse(null);
                Slot slot = data.slots.get(entry.slotId());
                Room room = data.rooms.get(entry.roomId());
                if (plan == null || slot == null || room == null || !RuleEvaluator.canPlace(state, plan, slot, room)) {
                    attemptViolations.add("锁定课程冲突： " + entry.id());
                } else {
                    state.add(entry);
                }
            }
            if (!attemptViolations.isEmpty()) {
                if (best == null) {
                    best = state;
                    bestUnplaced = totalEntries;
                }
                violations = attemptViolations;
                continue;
            }
            int unplaced = 0;
            List<Plan> shuffledPlans = new ArrayList<>(pairedPlans);
            java.util.Collections.shuffle(shuffledPlans, random);

            for (Plan plan : shuffledPlans) {
                int pairs = (plan.weeklyPeriods() - lockedByPlan.getOrDefault(plan.id(), 0)) / 2;
                for (int pair = 0; pair < pairs; pair++) {
                    if (System.nanoTime() >= deadline || !placePair(state, plan, random, attempt, pair)) {
                        unplaced += 2;
                    }
                }
            }
            List<Task> shuffled = new ArrayList<>(tasks);
            java.util.Collections.shuffle(shuffled, random);
            shuffled.sort(Comparator
                .comparing((Task task) -> task.plan().fixedSlotId() == null)
                .thenComparing((Task task) -> -task.plan().weeklyPeriods()));
            for (Task task : shuffled) {
                if (System.nanoTime() >= deadline) {
                    unplaced += 1;
                    continue;
                }
                Placement bestPlacement = choosePlacement(state, task.plan(), random);
                if (bestPlacement == null) {
                    unplaced += 1;
                    continue;
                }
                state.add(new Entry(
                    "entry-" + task.plan().id() + "-" + task.occurrence() + "-" + attempt,
                    task.plan().id(), task.plan().classId(), task.plan().subjectId(), task.plan().teacherId(),
                    bestPlacement.room().id(), bestPlacement.slot().id(), "AUTO", false
                ));
            }
            int score = softScore(state).total();
            System.err.println("[java] attempt " + (attempt + 1) + ": placed " + (totalEntries - unplaced) + "/" + totalEntries + ", score " + score);
            if (unplaced < bestUnplaced || (unplaced == bestUnplaced && score > bestScore)) {
                best = state;
                bestUnplaced = unplaced;
                bestScore = score;
            }
            if (unplaced == 0) {
                localSearch(state, data, random, deadline);
                ObjectNode result = SolverProtocol.success(data.protocolVersion, state, started);
                System.err.println("[java] completed in " + result.get("elapsedMs").asLong() + " ms");
                return result;
            }
        }

        if (best != null && bestUnplaced == 0) {
            return SolverProtocol.success(data.protocolVersion, best, started);
        }
        List<String> messages = new ArrayList<>(violations);
        if (best == null || bestUnplaced > 0) {
            messages.add("无法在给定时间和资源下安排全部课程");
        }
        ObjectNode result = SolverProtocol.baseResult(data.protocolVersion, "FAILED", messages, best == null ? List.of() : best.entries);
        result.put("explanation", messages.isEmpty() ? "排课失败" : messages.get(0));
        result.put("elapsedMs", (System.nanoTime() - started) / 1_000_000);
        result.put("hasFeasibleSolution", false);
        return result;
    }

    private static boolean placePair(State state, Plan plan, Random random, int attempt, int pair) {
        List<Slot> slots = new ArrayList<>(state.slots.values());
        java.util.Collections.shuffle(slots, random);
        for (Slot first : slots) {
            for (Slot second : slots) {
                if (first.day() != second.day() || second.period() != first.period() + 1) continue;
                for (Room room : state.rooms.values()) {
                    if (!RuleEvaluator.canPlace(state, plan, first, room) || !RuleEvaluator.canPlace(state, plan, second, room)) continue;
                    Entry a = new Entry("entry-" + plan.id() + "-pair-" + pair + "-a-" + attempt, plan.id(), plan.classId(), plan.subjectId(), plan.teacherId(), room.id(), first.id(), "AUTO", false);
                    Entry b = new Entry("entry-" + plan.id() + "-pair-" + pair + "-b-" + attempt, plan.id(), plan.classId(), plan.subjectId(), plan.teacherId(), room.id(), second.id(), "AUTO", false);
                    state.add(a);
                    if (!RuleEvaluator.canPlace(state, plan, second, room)) {
                        state.remove(a);
                        continue;
                    }
                    state.add(b);
                    return true;
                }
            }
        }
        return false;
    }

    private static Placement choosePlacement(State state, Plan plan, Random random) {
        List<Slot> candidateSlots = new ArrayList<>();
        if (plan.fixedSlotId() != null && !plan.fixedSlotId().isBlank()) {
            Slot fixed = state.slots.get(plan.fixedSlotId());
            if (fixed != null) candidateSlots.add(fixed);
        } else {
            candidateSlots.addAll(state.slots.values());
        }
        Placement best = null;
        int bestScore = Integer.MAX_VALUE;
        for (Slot slot : candidateSlots) {
            for (Room room : state.rooms.values()) {
                if (!RuleEvaluator.canPlace(state, plan, slot, room)) continue;
                int score = state.classDayLoad(plan.classId(), slot.day()) * 4
                    + state.teacherDayLoad(plan.teacherId(), slot.day()) * 2
                    + state.subjectDayCount(plan.classId(), slot.day(), plan.subjectId()) * 10
                    + Math.max(0, room.capacity() - state.classes.get(plan.classId()).size()) / 10
                    + RuleEvaluator.rulePlacementPenalty(state, plan, slot)
                    + random.nextInt(3);
                if (score < bestScore) {
                    bestScore = score;
                    best = new Placement(slot, room);
                }
            }
        }
        return best;
    }

    private static void localSearch(State state, SolverData data, Random random, long deadline) {
        int iterations = Math.min(1500, 200 + state.entries.size() * 10);
        int currentScore = softScore(state).total();
        for (int i = 0; i < iterations && System.nanoTime() < deadline; i++) {
            List<Entry> movable = state.entries.stream().filter(entry -> !entry.locked() && !state.pairedPlans.contains(entry.coursePlanId())).toList();
            if (movable.isEmpty()) return;
            Entry entry = movable.get(random.nextInt(movable.size()));
            Plan plan = data.plans.stream().filter(item -> item.id().equals(entry.coursePlanId())).findFirst().orElse(null);
            if (plan == null) continue;
            List<Slot> slots = new ArrayList<>(state.slots.values());
            Slot target = slots.get(random.nextInt(slots.size()));
            if (target.id().equals(entry.slotId())) continue;
            state.remove(entry);
            Placement placement = choosePlacement(state, plan, random);
            if (placement == null) {
                state.add(entry);
                continue;
            }
            Entry moved = new Entry(entry.id(), entry.coursePlanId(), entry.classId(), entry.subjectId(), entry.teacherId(), placement.room().id(), placement.slot().id(), entry.source(), false);
            state.add(moved);
            int nextScore = softScore(state).total();
            if (nextScore < currentScore) {
                state.remove(moved);
                state.add(entry);
            } else {
                currentScore = nextScore;
            }
        }
    }

    public static Score softScore(State state) {
        int subject = 0;
        Map<String, Integer> classDaySubjects = new HashMap<>();
        Map<String, TreeSet<Integer>> teacherPeriods = new HashMap<>();
        Map<String, Integer> teacherLoads = new HashMap<>();
        for (Entry entry : state.entries) {
            Slot slot = state.slots.get(entry.slotId());
            String subjectKey = entry.classId() + "|" + slot.day() + "|" + entry.subjectId();
            classDaySubjects.merge(subjectKey, 1, Integer::sum);
            teacherPeriods.computeIfAbsent(entry.teacherId() + "|" + slot.day(), key -> new TreeSet<>()).add(slot.period());
            teacherLoads.merge(entry.teacherId(), 1, Integer::sum);
        }
        for (int count : classDaySubjects.values()) if (count > 1) subject += (count - 1) * 3;
        int gaps = 0;
        for (TreeSet<Integer> periods : teacherPeriods.values()) {
            if (periods.size() < 2) continue;
            Integer previous = null;
            for (Integer period : periods) {
                if (previous != null) gaps += Math.max(0, period - previous - 1);
                previous = period;
            }
        }
        double average = teacherLoads.values().stream().mapToInt(Integer::intValue).average().orElse(0);
        int balance = (int) Math.round(teacherLoads.values().stream().mapToDouble(load -> Math.abs(load - average)).average().orElse(0) * 2);
        int rulePenalty = RuleEvaluator.rulePenalty(state);
        int total = subject + gaps + balance + rulePenalty;
        return new Score(Math.max(0, 100 - total), subject, 0, gaps, balance, rulePenalty);
    }

    public record Score(int total, int subjectDistribution, int teacherContinuous, int teacherGaps, int teacherWorkloadBalance, int rulePenalty) {}
}
