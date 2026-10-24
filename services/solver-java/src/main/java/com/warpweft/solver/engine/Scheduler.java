package com.warpweft.solver.engine;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.warpweft.solver.model.ClassInfo;
import com.warpweft.solver.model.ElectiveBlock;
import com.warpweft.solver.model.ElectiveGroup;
import com.warpweft.solver.model.Entry;
import com.warpweft.solver.model.Plan;
import com.warpweft.solver.model.Placement;
import com.warpweft.solver.model.Room;
import com.warpweft.solver.model.Slot;
import com.warpweft.solver.model.SoftWeights;
import com.warpweft.solver.model.SolverData;
import com.warpweft.solver.model.Task;
import com.warpweft.solver.protocol.SolverProtocol;
import com.warpweft.solver.rules.RuleEvaluator;

import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.TreeSet;

public final class Scheduler {
    /** Unique id source for repair entries; a solver process handles one input. */
    private static long entrySequence = 0;
    private static final ObjectMapper JSON = new ObjectMapper();
    private static long lastCheckpointAt = 0;

    public static ObjectNode solve(SolverData data, int timeLimitSeconds, int randomSeed, long started, String checkpointFile, int stagnationSeconds) {
        long deadline = started + timeLimitSeconds * 1_000_000_000L;
        long stagnationNanos = stagnationSeconds > 0 ? stagnationSeconds * 1_000_000_000L : Long.MAX_VALUE;
        long lastImprovement = started;
        lastCheckpointAt = 0;
        List<String> violations = new ArrayList<>(data.violations);
        State best = null;
        int bestUnplaced = Integer.MAX_VALUE;
        int bestScore = Integer.MIN_VALUE;
        Map<String, Integer> lockedByPlan = new HashMap<>();
        for (Entry entry : data.locked) lockedByPlan.merge(entry.coursePlanId(), 1, Integer::sum);
        Map<String, Integer> seededByPlan = new HashMap<>();
        for (Entry entry : data.seed) seededByPlan.merge(entry.coursePlanId(), 1, Integer::sum);
        for (Map.Entry<String, Integer> item : lockedByPlan.entrySet()) {
            Plan plan = data.plans.stream().filter(p -> p.id().equals(item.getKey())).findFirst().orElse(null);
            int seeded = seededByPlan.getOrDefault(item.getKey(), 0);
            if (plan != null && item.getValue() + seeded > plan.weeklyPeriods()) violations.add("锁定课程数量超过计划课时：" + plan.id());
        }
        if (!violations.isEmpty()) {
            ObjectNode result = SolverProtocol.failure(data.protocolVersion, violations);
            result.put("elapsedMs", (System.nanoTime() - started) / 1_000_000);
            return result;
        }

        Map<String, List<Room>> roomsByPlan = new HashMap<>();
        Map<String, Plan> planById = new HashMap<>();
        for (Plan plan : data.plans) {
            planById.put(plan.id(), plan);
            roomsByPlan.put(plan.id(), eligibleRooms(data, plan));
        }
        Map<String, List<String>> groupClasses = new HashMap<>();
        for (ElectiveGroup group : data.groups) groupClasses.put(group.id(), group.classIds());

        List<Plan> pairedPlans = new ArrayList<>();
        List<Task> tasks = new ArrayList<>();
        for (Plan plan : data.plans) {
            int fixed = lockedByPlan.getOrDefault(plan.id(), 0) + seededByPlan.getOrDefault(plan.id(), 0);
            boolean isDouble = plan.weeklyPeriods() >= 2
                && data.rules.stream().anyMatch(rule -> "DOUBLE_PERIOD".equals(rule.kind()) && rule.matchesPlan(plan.teacherId(), plan.subjectId()));
            if (isDouble) {
                pairedPlans.add(plan);
                if ((plan.weeklyPeriods() - Math.min(fixed, plan.weeklyPeriods())) % 2 == 1) tasks.add(new Task(plan, plan.weeklyPeriods() - 1));
            } else {
                for (int occurrence = Math.min(fixed, plan.weeklyPeriods()); occurrence < plan.weeklyPeriods(); occurrence++) tasks.add(new Task(plan, occurrence));
            }
        }
        int pairedEntries = pairedPlans.stream()
            .mapToInt(plan -> ((plan.weeklyPeriods() - Math.min(plan.weeklyPeriods(), lockedByPlan.getOrDefault(plan.id(), 0) + seededByPlan.getOrDefault(plan.id(), 0))) / 2) * 2)
            .sum();
        int groupEntries = data.groups.stream()
            .mapToInt(group -> group.weeklyPeriods() * group.blocks().size())
            .sum();
        int totalEntries = tasks.size() + pairedEntries + data.locked.size() + data.seed.size() + groupEntries;
        if (totalEntries == 0) {
            State empty = new State(data.slots, data.rooms, data.classes, data.unavailable, data.rules, groupClasses);
            return SolverProtocol.success(data.protocolVersion, empty, started, data.softWeights);
        }

        Map<String, Double> pressure = pressureOf(data, roomsByPlan);
        // Keep starting fresh constructions until the deadline. The previous
        // fixed cap of 8 attempts made anything above ~8 seconds pointless: the
        // solver returned FAILED while most of the requested budget was unused.
        int attempts = Math.max(8, timeLimitSeconds * 4);
        System.err.println("[java] solve start: " + totalEntries + " entries, " + data.locked.size() + " locked, " + data.seed.size() + " seeded, "
            + pairedPlans.size() + " paired plans, " + data.slots.size() + " slots, " + data.rooms.size() + " rooms, limit " + timeLimitSeconds + "s"
            + (stagnationSeconds > 0 ? ", stagnation " + stagnationSeconds + "s" : ""));
        for (int attempt = 0; attempt < attempts && System.nanoTime() < deadline
            && System.nanoTime() - lastImprovement < stagnationNanos; attempt++) {
            Random random = new Random(randomSeed + attempt * 7919L);
            State state = new State(data.slots, data.rooms, data.classes, data.unavailable, data.rules, groupClasses);
            for (Plan plan : pairedPlans) state.pairedPlans.add(plan.id());
            List<String> attemptViolations = new ArrayList<>();
            for (Entry entry : data.locked) {
                Plan plan = planById.get(entry.coursePlanId());
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
            // A resume checkpoint is placed first; entries that no longer fit are
            // simply dropped and re-placed by the normal construction/repair pass.
            Map<String, Integer> seededCounts = new HashMap<>();
            for (Entry entry : data.seed) {
                Plan plan = planById.get(entry.coursePlanId());
                Slot slot = data.slots.get(entry.slotId());
                Room room = data.rooms.get(entry.roomId());
                if (plan == null || slot == null || room == null) continue;
                int already = seededCounts.getOrDefault(plan.id(), 0);
                if (already >= plan.weeklyPeriods() - lockedByPlan.getOrDefault(plan.id(), 0)) continue;
                if (!RuleEvaluator.canPlace(state, plan, slot, room)) continue;
                state.add(entry);
                seededCounts.merge(plan.id(), 1, Integer::sum);
            }
            List<Plan> shuffledPlans = new ArrayList<>(pairedPlans);
            Collections.shuffle(shuffledPlans, random);

            // Elective groups are rigid: every group lesson needs one slot where
            // all member classes are free and every block has a teacher + room.
            // Place them before individual lessons, which are easier to move.
            for (ElectiveGroup group : data.groups) {
                for (int lesson = 0; lesson < group.weeklyPeriods(); lesson++) {
                    if (System.nanoTime() >= deadline) break;
                    placeElectiveGroup(state, data, group, random);
                }
            }

            for (Plan plan : shuffledPlans) {
                int pairs = (plan.weeklyPeriods() - Math.min(plan.weeklyPeriods(), lockedByPlan.getOrDefault(plan.id(), 0) + seededCounts.getOrDefault(plan.id(), 0))) / 2;
                for (int pair = 0; pair < pairs; pair++) {
                    if (System.nanoTime() >= deadline || !placePair(state, plan, roomsByPlan.get(plan.id()), random, attempt, pair)) {
                        break;
                    }
                }
            }
            // Most-constrained-first: plans whose teacher is already heavily
            // loaded, or that have few rooms, are placed before the easy ones.
            List<Task> shuffled = orderTasks(tasks, pressure, random);
            for (Task task : shuffled) {
                if (System.nanoTime() >= deadline) {
                    continue;
                }
                Placement bestPlacement = choosePlacement(state, task.plan(), roomsByPlan.get(task.plan().id()), random, data.softWeights);
                if (bestPlacement == null) {
                    continue;
                }
                state.add(autoEntry(task.plan(), bestPlacement, attempt));
            }
            int unplaced = missingCount(state, data);
            if (unplaced > 0) {
                unplaced = repairMissing(state, data, planById, roomsByPlan, random, deadline);
            }
            int groupMissing = groupMissing(state, data);
            unplaced += groupMissing;
            int score = softScore(state, data.softWeights).total();
            System.err.println("[java] attempt " + (attempt + 1) + ": placed " + (totalEntries - unplaced) + "/" + totalEntries + ", score " + score);
            if (unplaced < bestUnplaced || (unplaced == bestUnplaced && score > bestScore)) {
                best = state;
                bestUnplaced = unplaced;
                bestScore = score;
                lastImprovement = System.nanoTime();
                publish(started, state, totalEntries, unplaced, score, checkpointFile, false);
            }
            if (unplaced == 0) {
                localSearch(state, data, planById, roomsByPlan, random, deadline);
                publish(started, state, totalEntries, 0, softScore(state, data.softWeights).total(), checkpointFile, true);
                ObjectNode result = SolverProtocol.success(data.protocolVersion, state, started, data.softWeights);
                System.err.println("[java] completed in " + result.get("elapsedMs").asLong() + " ms");
                return result;
            }
        }

        // Hot start: keep the best placement as the base, kick out a slice of
        // lessons and try to repair the holes. This is what lets a long run keep
        // improving instead of restarting from scratch every attempt.
        long repairRound = 0;
        while (best != null && bestUnplaced > 0 && System.nanoTime() < deadline
            && System.nanoTime() - lastImprovement < stagnationNanos) {
            repairRound += 1;
            Random random = new Random(randomSeed * 104729L + repairRound * 7919L);
            State candidate = best.copy();
            List<Entry> movable = new ArrayList<>();
            for (Entry entry : candidate.entries) if (!entry.locked() && entry.groupId() == null) movable.add(entry);
            if (movable.isEmpty()) break;
            int kick = Math.max(1, movable.size() / 20);
            for (int index = 0; index < kick; index++) {
                candidate.remove(movable.get(random.nextInt(movable.size())));
            }
            int unplaced = repairMissing(candidate, data, planById, roomsByPlan, random, deadline);
            unplaced += groupMissing(candidate, data);
            int score = softScore(candidate, data.softWeights).total();
            if (unplaced < bestUnplaced || (unplaced == bestUnplaced && score > bestScore)) {
                best = candidate;
                bestUnplaced = unplaced;
                bestScore = score;
                lastImprovement = System.nanoTime();
                System.err.println("[java] repair improved: placed " + (totalEntries - unplaced) + "/" + totalEntries + ", score " + score);
                publish(started, candidate, totalEntries, unplaced, score, checkpointFile, false);
            }
            if (unplaced == 0) break;
        }

        if (best != null && bestUnplaced == 0) {
            localSearch(best, data, planById, roomsByPlan, new Random(randomSeed), deadline);
            publish(started, best, totalEntries, 0, softScore(best, data.softWeights).total(), checkpointFile, true);
            return SolverProtocol.success(data.protocolVersion, best, started, data.softWeights);
        }
        if (best != null) {
            publish(started, best, totalEntries, bestUnplaced, bestScore, checkpointFile, true);
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

    /** Rooms that can ever host the plan (type + capacity), cheapest capacity first. */
    private static List<Room> eligibleRooms(SolverData data, Plan plan) {
        int classSize = data.classes.containsKey(plan.classId()) ? data.classes.get(plan.classId()).size() : 0;
        List<Room> rooms = new ArrayList<>();
        for (Room room : data.rooms.values()) {
            if (plan.roomType() != null && !plan.roomType().isBlank() && !plan.roomType().equals(room.type())) continue;
            if (room.capacity() < classSize) continue;
            rooms.add(room);
        }
        rooms.sort(Comparator.comparingInt(Room::capacity));
        return rooms;
    }

    /**
     * Static scarcity estimate: a plan is hard when it has few (slot × room)
     * combinations or when its teacher is close to their weekly limit.
     */
    private static Map<String, Double> pressureOf(SolverData data, Map<String, List<Room>> roomsByPlan) {
        Map<String, Integer> teacherWeekly = new HashMap<>();
        Map<String, Integer> classWeekly = new HashMap<>();
        Map<String, Integer> unavailableByTeacher = new HashMap<>();
        for (Plan plan : data.plans) {
            teacherWeekly.merge(plan.teacherId(), plan.weeklyPeriods(), Integer::sum);
            classWeekly.merge(plan.classId(), plan.weeklyPeriods(), Integer::sum);
        }
        for (String key : data.unavailable) {
            int split = key.indexOf('|');
            if (split > 0) unavailableByTeacher.merge(key.substring(0, split), 1, Integer::sum);
        }
        Map<String, Double> result = new HashMap<>();
        for (Plan plan : data.plans) {
            int slots = plan.fixedSlotId() != null && !plan.fixedSlotId().isBlank()
                ? 1
                : Math.max(1, data.slots.size() - unavailableByTeacher.getOrDefault(plan.teacherId(), 0));
            int rooms = Math.max(1, roomsByPlan.getOrDefault(plan.id(), List.of()).size());
            double teacherFill = teacherWeekly.getOrDefault(plan.teacherId(), 0) / (double) slots;
            double classFill = classWeekly.getOrDefault(plan.classId(), 0) / (double) Math.max(1, data.slots.size());
            // Lower candidate count → earlier. Higher teacher/class fill → earlier.
            result.put(plan.id(), 100.0 / (rooms * (double) slots) + teacherFill * 3 + classFill);
        }
        return result;
    }

    private static List<Task> orderTasks(List<Task> tasks, Map<String, Double> pressure, Random random) {
        List<Task> ordered = new ArrayList<>(tasks);
        Map<String, Double> jitter = new HashMap<>();
        for (Task task : ordered) {
            jitter.computeIfAbsent(task.plan().id(), key -> random.nextDouble() * 0.05);
        }
        // The jitter keeps equal-pressure plans from always claiming the same
        // slots on every restart, which is what made retries repeat failures.
        ordered.sort(Comparator.comparingDouble(task ->
            pressure.getOrDefault(task.plan().id(), 0.0) + jitter.getOrDefault(task.plan().id(), 0.0)));
        return ordered;
    }

    private static boolean placePair(State state, Plan plan, List<Room> rooms, Random random, int attempt, int pair) {
        List<Slot> slots = new ArrayList<>(state.slots.values());
        Collections.shuffle(slots, random);
        for (Slot first : slots) {
            for (Slot second : slots) {
                if (first.day() != second.day() || second.period() != first.period() + 1) continue;
                for (Room room : rooms) {
                    if (!RuleEvaluator.canPlace(state, plan, first, room) || !RuleEvaluator.canPlace(state, plan, second, room)) continue;
                    Entry a = new Entry("entry-" + plan.id() + "-pair-" + pair + "-a-" + attempt, plan.id(), plan.classId(), plan.subjectId(), plan.teacherId(), room.id(), first.id(), plan.weeks(), "AUTO", false);
                    Entry b = new Entry("entry-" + plan.id() + "-pair-" + pair + "-b-" + attempt, plan.id(), plan.classId(), plan.subjectId(), plan.teacherId(), room.id(), second.id(), plan.weeks(), "AUTO", false);
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

    /**
     * One elective lesson = every block in the same slot, with all member classes
     * released. Rooms are picked greedily and must be distinct inside the lesson.
     */
    private static boolean placeElectiveGroup(State state, SolverData data, ElectiveGroup group, Random random) {
        List<Slot> slots = new ArrayList<>(state.slots.values());
        Collections.shuffle(slots, random);
        int maxClassSize = 0;
        for (String classId : group.classIds()) {
            ClassInfo info = state.classes.get(classId);
            if (info != null) maxClassSize = Math.max(maxClassSize, info.size());
        }
        int mask = 3;
        for (Slot slot : slots) {
            boolean classesFree = true;
            for (String classId : group.classIds()) {
                if (!state.classSlotFree(classId, slot.id(), mask)) {
                    classesFree = false;
                    break;
                }
            }
            if (!classesFree) continue;
            List<Room> chosenRooms = new ArrayList<>();
            java.util.Set<String> lessonTeachers = new java.util.HashSet<>();
            boolean blocksOk = true;
            for (ElectiveBlock block : group.blocks()) {
                if (!lessonTeachers.add(block.teacherId())) {
                    blocksOk = false;
                    break;
                }
                if (state.unavailable.contains(block.teacherId() + "|" + slot.id())) {
                    blocksOk = false;
                    break;
                }
                if (!state.teacherSlotFree(block.teacherId(), slot.id(), mask)) {
                    blocksOk = false;
                    break;
                }
                Room pick = null;
                for (Room room : state.rooms.values()) {
                    if (block.roomType() != null && !block.roomType().isBlank() && !block.roomType().equals(room.type())) continue;
                    if (room.capacity() < maxClassSize) continue;
                    if (!state.roomSlotFree(room.id(), slot.id(), mask)) continue;
                    if (chosenRooms.contains(room)) continue;
                    pick = room;
                    break;
                }
                if (pick == null) {
                    blocksOk = false;
                    break;
                }
                chosenRooms.add(pick);
            }
            if (!blocksOk) continue;
            int index = 0;
            for (ElectiveBlock block : group.blocks()) {
                Room room = chosenRooms.get(index++);
                state.add(new Entry(
                    "entry-" + group.id() + "-" + block.id() + "-" + slot.id() + "-" + entrySequence++,
                    "elective:" + block.id(), group.id(), group.subjectId(),
                    block.teacherId(), room.id(), slot.id(), "all", group.id(), block.id(), "AUTO", false
                ));
            }
            return true;
        }
        return false;
    }

    /** Missing elective lessons, counted in entries (blocks per lesson). */
    private static int groupMissing(State state, SolverData data) {
        int missing = 0;
        for (ElectiveGroup group : data.groups) {
            int blocks = Math.max(1, group.blocks().size());
            int placedEntries = 0;
            for (Entry entry : state.entries) {
                if (group.id().equals(entry.groupId())) placedEntries += 1;
            }
            int placedLessons = placedEntries / blocks;
            missing += Math.max(0, group.weeklyPeriods() - placedLessons) * blocks;
        }
        return missing;
    }

    private static Placement choosePlacement(State state, Plan plan, List<Room> rooms, Random random, SoftWeights weights) {
        if (rooms == null || rooms.isEmpty()) return null;
        List<Slot> candidateSlots = new ArrayList<>();
        if (plan.fixedSlotId() != null && !plan.fixedSlotId().isBlank()) {
            Slot fixed = state.slots.get(plan.fixedSlotId());
            if (fixed != null) candidateSlots.add(fixed);
            if (candidateSlots.isEmpty()) return null;
        } else {
            candidateSlots.addAll(state.slots.values());
            Collections.shuffle(candidateSlots, random);
        }
        Placement best = null;
        int bestScore = Integer.MAX_VALUE;
        int classSize = state.classes.containsKey(plan.classId()) ? state.classes.get(plan.classId()).size() : 0;
        Map<Integer, TreeSet<Integer>> classPeriodsByDay = new HashMap<>();
        if (weights.classGaps() > 0) {
            for (Entry entry : state.entries) {
                Slot existing = state.slots.get(entry.slotId());
                if (existing == null || !isDaytimeKind(existing.kind())) continue;
                if (entry.groupId() != null) {
                    for (String classId : state.groupClasses.getOrDefault(entry.groupId(), List.of())) {
                        if (!classId.equals(plan.classId())) continue;
                        classPeriodsByDay.computeIfAbsent(existing.day(), key -> new TreeSet<>()).add(existing.period());
                    }
                } else if (entry.classId().equals(plan.classId())) {
                    classPeriodsByDay.computeIfAbsent(existing.day(), key -> new TreeSet<>()).add(existing.period());
                }
            }
        }
        for (Slot slot : candidateSlots) {
            for (Room room : rooms) {
                if (!RuleEvaluator.canPlace(state, plan, slot, room)) continue;
                int mask = State.weekMask(plan.weeks());
                int score = state.classDayLoad(plan.classId(), slot.day(), mask) * 4
                    + state.teacherDayLoad(plan.teacherId(), slot.day(), mask) * 2
                    + state.subjectDayCount(plan.classId(), slot.day(), plan.subjectId(), mask) * 10
                    + Math.max(0, room.capacity() - classSize) / 10
                    + (weights.classGaps() > 0 ? compactCost(classPeriodsByDay.get(slot.day()), slot.period()) * 4 : 0)
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

    /** Only the regular daytime block participates in class-gap scoring. */
    private static boolean isDaytimeKind(String kind) {
        return kind == null || "regular".equals(kind) || "study".equals(kind) || "aftercare".equals(kind);
    }

    /** Prefer a slot next to an existing lesson; filling an inner hole is best. */
    private static int compactCost(TreeSet<Integer> periods, int period) {
        if (periods == null || periods.isEmpty()) return 0;
        int nearest = Integer.MAX_VALUE;
        for (int existing : periods) nearest = Math.min(nearest, Math.abs(existing - period));
        int cost = Math.max(0, nearest - 1);
        Integer lower = periods.lower(period);
        Integer higher = periods.higher(period);
        if (lower != null && higher != null) cost = Math.max(0, cost - 1);
        return cost;
    }

    /**
     * Fill the lessons still missing from {@code state}. Direct placements are
     * tried first; the rest go through an ejection search that temporarily
     * removes one or two blocking lessons and re-places them elsewhere.
     */
    private static int repairMissing(State state, SolverData data, Map<String, Plan> planById, Map<String, List<Room>> roomsByPlan, Random random, long deadline) {
        List<Task> missing = missingTasks(state, data);
        int stillMissing = 0;
        int[] budget = { Math.max(200, missing.size() * 40) };
        for (Task task : missing) {
            if (System.nanoTime() >= deadline || budget[0] <= 0) {
                stillMissing += 1;
                continue;
            }
            Plan plan = task.plan();
            if (!placeWithEjection(state, data, plan, planById, roomsByPlan, random, deadline, 2, budget)) {
                stillMissing += 1;
            }
        }
        return stillMissing;
    }

    private static int missingCount(State state, SolverData data) {
        return missingTasks(state, data).size();
    }

    private static List<Task> missingTasks(State state, SolverData data) {
        Map<String, Integer> placed = new HashMap<>();
        for (Entry entry : state.entries) placed.merge(entry.coursePlanId(), 1, Integer::sum);
        List<Task> missing = new ArrayList<>();
        for (Plan plan : data.plans) {
            int gap = plan.weeklyPeriods() - placed.getOrDefault(plan.id(), 0);
            for (int occurrence = 0; occurrence < gap; occurrence++) missing.add(new Task(plan, occurrence));
        }
        return missing;
    }

    private static boolean placeWithEjection(State state, SolverData data, Plan plan, Map<String, Plan> planById, Map<String, List<Room>> roomsByPlan, Random random, long deadline, int depth, int[] budget) {
        if (System.nanoTime() >= deadline || budget[0] <= 0) return false;
        List<Room> rooms = roomsByPlan.get(plan.id());
        Placement direct = choosePlacement(state, plan, rooms, random, data.softWeights);
        if (direct != null) {
            state.add(autoEntry(plan, direct, -1));
            return true;
        }
        if (depth <= 0 || rooms == null || rooms.isEmpty()) return false;
        List<Slot> slots = new ArrayList<>();
        if (plan.fixedSlotId() != null && !plan.fixedSlotId().isBlank()) {
            // A fixed-time lesson may only ever move blockers out of its own
            // slot; it must never be ejected to a different time.
            Slot fixed = state.slots.get(plan.fixedSlotId());
            if (fixed == null) return false;
            slots.add(fixed);
        } else {
            slots.addAll(state.slots.values());
            Collections.shuffle(slots, random);
        }
        int classSize = state.classes.containsKey(plan.classId()) ? state.classes.get(plan.classId()).size() : 0;
        for (Slot slot : slots) {
            if (state.unavailable.contains(plan.teacherId() + "|" + slot.id())) continue;
            for (Room room : rooms) {
                if (room.capacity() < classSize) continue;
                List<Entry> blockers = blockingEntries(state, plan, slot, room);
                if (blockers.isEmpty() || blockers.size() > depth) continue;
                boolean hasLocked = false;
                for (Entry blocker : blockers) if (blocker.locked()) hasLocked = true;
                if (hasLocked) continue;
                budget[0] -= 1;
                State.Snapshot snapshot = state.snapshot();
                for (Entry blocker : blockers) state.remove(blocker);
                if (!RuleEvaluator.canPlace(state, plan, slot, room)) {
                    state.restore(snapshot);
                    continue;
                }
                state.add(autoEntry(plan, new Placement(slot, room), -1));
                boolean movedAll = true;
                for (Entry blocker : blockers) {
                    Plan blockerPlan = planById.get(blocker.coursePlanId());
                    if (blockerPlan == null || !placeWithEjection(state, data, blockerPlan, planById, roomsByPlan, random, deadline, depth - 1, budget)) {
                        movedAll = false;
                        break;
                    }
                }
                if (movedAll) return true;
                state.restore(snapshot);
                if (budget[0] <= 0) return false;
            }
        }
        return false;
    }

    private static List<Entry> blockingEntries(State state, Plan plan, Slot slot, Room room) {
        List<Entry> blockers = new ArrayList<>();
        for (Entry entry : state.entries) {
            if (!entry.slotId().equals(slot.id())) continue;
            if (entry.classId().equals(plan.classId()) || entry.teacherId().equals(plan.teacherId()) || entry.roomId().equals(room.id())) {
                blockers.add(entry);
            }
        }
        return blockers;
    }

    private static Entry autoEntry(Plan plan, Placement placement, int attempt) {
        entrySequence += 1;
        return new Entry(
            "entry-" + plan.id() + "-" + entrySequence,
            plan.id(), plan.classId(), plan.subjectId(), plan.teacherId(),
            placement.room().id(), placement.slot().id(), plan.weeks(), "AUTO", false
        );
    }

    private static void localSearch(State state, SolverData data, Map<String, Plan> planById, Map<String, List<Room>> roomsByPlan, Random random, long deadline) {
        if (!data.softWeights.anyEnabled()) return;
        int iterations = data.softWeights.classGaps() > 0
            ? Math.min(12000, 200 + state.entries.size() * 20)
            : Math.min(1500, 200 + state.entries.size() * 10);
        int currentScore = softScore(state, data.softWeights).total();
        for (int i = 0; i < iterations && System.nanoTime() < deadline; i++) {
            List<Entry> movable = new ArrayList<>();
            for (Entry entry : state.entries) {
                if (!entry.locked() && !state.pairedPlans.contains(entry.coursePlanId())) movable.add(entry);
            }
            if (movable.isEmpty()) return;
            Entry entry = movable.get(random.nextInt(movable.size()));
            Plan plan = planById.get(entry.coursePlanId());
            if (plan == null) continue;
            List<Slot> slots = new ArrayList<>(state.slots.values());
            Slot target = slots.get(random.nextInt(slots.size()));
            if (target.id().equals(entry.slotId())) continue;
            state.remove(entry);
            Placement placement = choosePlacement(state, plan, roomsByPlan.get(plan.id()), random, data.softWeights);
            if (placement == null) {
                state.add(entry);
                continue;
            }
            Entry moved = new Entry(entry.id(), entry.coursePlanId(), entry.classId(), entry.subjectId(), entry.teacherId(), placement.room().id(), placement.slot().id(), entry.weeks(), entry.source(), false);
            state.add(moved);
            int nextScore = softScore(state, data.softWeights).total();
            if (nextScore < currentScore) {
                state.remove(moved);
                state.add(entry);
            } else {
                currentScore = nextScore;
            }
        }
    }

    /**
     * One progress event per improvement. The checkpoint file is what lets the
     * desktop app show the best timetable during a multi-hour run and resume it
     * after a crash or a manual pause.
     */
    private static void publish(long started, State state, int total, int unplaced, int score, String checkpointFile, boolean force) {
        long now = System.nanoTime();
        long elapsedMs = (now - started) / 1_000_000;
        System.err.println("[progress] {\"placed\":" + (total - unplaced) + ",\"total\":" + total
            + ",\"unplaced\":" + unplaced + ",\"score\":" + score + ",\"elapsedMs\":" + elapsedMs + "}");
        if (checkpointFile == null || checkpointFile.isBlank()) return;
        if (!force && now - lastCheckpointAt < 1_500_000_000L) return;
        lastCheckpointAt = now;
        writeCheckpoint(checkpointFile, state, total, unplaced, score, elapsedMs);
    }

    private static void writeCheckpoint(String file, State state, int total, int unplaced, int score, long elapsedMs) {
        try {
            ObjectNode root = JSON.createObjectNode();
            root.put("placed", total - unplaced);
            root.put("total", total);
            root.put("unplaced", unplaced);
            root.put("score", score);
            root.put("elapsedMs", elapsedMs);
            root.put("updatedAt", Instant.now().toString());
            ArrayNode entries = root.putArray("entries");
            for (Entry entry : state.entries) {
                ObjectNode item = entries.addObject();
                item.put("id", entry.id());
                item.put("coursePlanId", entry.coursePlanId());
                item.put("classId", entry.classId());
                item.put("teacherId", entry.teacherId());
                item.put("roomId", entry.roomId());
                item.put("slotId", entry.slotId());
                item.put("weeks", entry.weeks());
                if (entry.groupId() != null) item.put("groupId", entry.groupId());
                if (entry.blockId() != null) item.put("blockId", entry.blockId());
                item.put("source", entry.source());
                item.put("locked", entry.locked());
            }
            Path target = Path.of(file);
            Path parent = target.toAbsolutePath().getParent();
            if (parent != null) Files.createDirectories(parent);
            Path temp = target.resolveSibling(target.getFileName() + ".tmp");
            Files.writeString(temp, JSON.writeValueAsString(root), StandardCharsets.UTF_8);
            try {
                Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException unsupported) {
                Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (Exception error) {
            System.err.println("[java] checkpoint failed: " + error.getMessage());
        }
    }

    public static Score softScore(State state, SoftWeights weights) {
        int subject = 0;
        Map<String, Integer> classDaySubjects = new HashMap<>();
        Map<String, TreeSet<Integer>> teacherPeriods = new HashMap<>();
        Map<String, TreeSet<Integer>> classPeriods = new HashMap<>();
        Map<String, Integer> teacherLoads = new HashMap<>();
        for (Entry entry : state.entries) {
            Slot slot = state.slots.get(entry.slotId());
            if (slot == null) continue;
            String subjectKey = entry.classId() + "|" + slot.day() + "|" + entry.subjectId();
            classDaySubjects.merge(subjectKey, 1, Integer::sum);
            teacherPeriods.computeIfAbsent(entry.teacherId() + "|" + slot.day(), key -> new TreeSet<>()).add(slot.period());
            teacherLoads.merge(entry.teacherId(), 1, Integer::sum);
            if (isDaytimeKind(slot.kind())) {
                if (entry.groupId() != null) {
                    for (String classId : state.groupClasses.getOrDefault(entry.groupId(), List.of())) {
                        classPeriods.computeIfAbsent(classId + "|" + slot.day(), key -> new TreeSet<>()).add(slot.period());
                    }
                } else {
                    classPeriods.computeIfAbsent(entry.classId() + "|" + slot.day(), key -> new TreeSet<>()).add(slot.period());
                }
            }
        }
        for (int count : classDaySubjects.values()) if (count > 1) subject += (count - 1);
        int teacherGapCount = 0;
        for (TreeSet<Integer> periods : teacherPeriods.values()) {
            if (periods.size() < 2) continue;
            Integer previous = null;
            for (Integer period : periods) {
                if (previous != null) teacherGapCount += Math.max(0, period - previous - 1);
                previous = period;
            }
        }
        int classGapCount = 0;
        for (TreeSet<Integer> periods : classPeriods.values()) {
            if (periods.size() < 2) continue;
            Integer previous = null;
            for (Integer period : periods) {
                if (previous != null) classGapCount += Math.max(0, period - previous - 1);
                previous = period;
            }
        }
        double average = teacherLoads.values().stream().mapToInt(Integer::intValue).average().orElse(0);
        int balance = (int) Math.round(teacherLoads.values().stream().mapToDouble(load -> Math.abs(load - average)).average().orElse(0)
            * weights.teacherWorkloadBalance());
        int subjectPenalty = subject * weights.subjectDistribution();
        int teacherGapPenalty = teacherGapCount * weights.teacherGaps();
        int classGapPenalty = classGapCount * weights.classGaps();
        int rulePenalty = RuleEvaluator.rulePenalty(state);
        int total = subjectPenalty + teacherGapPenalty + balance + classGapPenalty + rulePenalty;
        return new Score(Math.max(0, 100 - total), subjectPenalty, 0, teacherGapPenalty, balance, classGapPenalty, rulePenalty);
    }

    public record Score(int total, int subjectDistribution, int teacherContinuous, int teacherGaps, int teacherWorkloadBalance, int classGaps, int rulePenalty) {}
}



