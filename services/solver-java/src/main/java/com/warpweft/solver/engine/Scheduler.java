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
import com.warpweft.solver.rules.Rule;
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
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
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
        Map<String, Integer> runLengths = runLengthsOf(data);
        Map<String, List<Plan>> pairGroups = new LinkedHashMap<>();
        for (Plan plan : data.plans) {
            if (plan.paired()) pairGroups.computeIfAbsent(plan.pairId(), key -> new ArrayList<>()).add(plan);
        }
        Map<String, Slot> slotByDayPeriod = new HashMap<>();
        for (Slot slot : data.slots.values()) slotByDayPeriod.put(slot.day() + "|" + slot.period(), slot);

        int groupEntries = data.groups.stream()
            .mapToInt(group -> group.weeklyPeriods() * group.blocks().size())
            .sum();
        int totalEntries = data.plans.stream().mapToInt(Plan::weeklyPeriods).sum() + groupEntries;
        if (totalEntries == 0) {
            State empty = new State(data.slots, data.rooms, data.classes, data.unavailable, data.rules, groupClasses, data.subjectPreference);
            return SolverProtocol.success(data.protocolVersion, empty, started, data.softWeights);
        }

        Map<String, Double> pressure = pressureOf(data, roomsByPlan);
        List<Plan> fixedPriority = new ArrayList<>(data.plans);
        fixedPriority.sort(Comparator.comparingDouble((Plan plan) -> pressure.getOrDefault(plan.id(), 0.0)).reversed());
        // Keep starting fresh constructions until the deadline. The previous
        // fixed cap of 8 attempts made anything above ~8 seconds pointless: the
        // solver returned FAILED while most of the requested budget was unused.
        int attempts = Math.max(8, timeLimitSeconds * 4);
        System.err.println("[java] solve start: " + totalEntries + " entries, " + data.locked.size() + " locked, " + data.seed.size() + " seeded, "
            + data.plans.stream().filter(Plan::hasFixedSlots).count() + " fixed plans, "
            + data.plans.stream().filter(Plan::paired).count() + " paired plans, " + data.slots.size() + " slots, " + data.rooms.size() + " rooms, limit " + timeLimitSeconds + "s"
            + (stagnationSeconds > 0 ? ", stagnation " + stagnationSeconds + "s" : ""));
        for (int attempt = 0; attempt < attempts && System.nanoTime() < deadline
            && System.nanoTime() - lastImprovement < stagnationNanos; attempt++) {
            Random random = new Random(randomSeed + attempt * 7919L);
            State state = new State(data.slots, data.rooms, data.classes, data.unavailable, data.rules, groupClasses, data.subjectPreference);
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

            // Fixed lessons are hard commitments: reserve their slots first so a
            // free lesson can never take the place they are going to need, then
            // place the fixed lessons themselves before anything movable.
            for (Plan plan : data.plans) {
                for (String slotId : pendingFixedSlots(state, plan)) state.reserveFixed(plan, slotId);
            }
            for (Plan plan : fixedPriority) {
                if (System.nanoTime() >= deadline) break;
                for (String slotId : pendingFixedSlots(state, plan)) {
                    if (System.nanoTime() >= deadline) break;
                    int[] budget = { 400 };
                    placeFixedOccurrence(state, data, plan, slotId, planById, roomsByPlan, random, deadline, attempt, 2, budget);
                }
            }

            // Elective groups are rigid: every group lesson needs one slot where
            // all member classes are free and every block has a teacher + room.
            // Place them before individual lessons, which are easier to move.
            for (ElectiveGroup group : data.groups) {
                for (int lesson = 0; lesson < group.weeklyPeriods(); lesson++) {
                    if (System.nanoTime() >= deadline) break;
                    placeElectiveGroup(state, data, group, random);
                }
            }

            // Free week-pairs are greedy about their slot. Placing every pair
            // at one common anchor slot reproduces the usual school convention
            // (语数间周 at a fixed period) and keeps specialist teachers' days
            // contiguous. The anchor is the slot that fits the most pairs.
            List<List<Plan>> freePairGroups = new ArrayList<>();
            for (List<Plan> group : pairGroups.values()) {
                boolean pinned = false;
                boolean touched = false;
                for (Plan plan : group) {
                    if (plan.hasFixedSlots()) pinned = true;
                    if (placedFor(state, plan.id()) > 0) touched = true;
                }
                // A seeded/locked pair member already has a slot; leave that
                // group to repair so the anchor cannot add a second copy.
                if (!pinned && !touched) freePairGroups.add(group);
            }
            if (!freePairGroups.isEmpty()) {
                Slot anchor = null;
                int bestFit = 0;
                List<List<Plan>> bestGroups = List.of();
                for (Slot slot : state.slots.values()) {
                    List<List<Plan>> fits = new ArrayList<>();
                    for (List<Plan> group : freePairGroups) {
                        if (pairFitsAt(state, group, slot, roomsByPlan)) fits.add(group);
                    }
                    if (fits.size() > bestFit) {
                        bestFit = fits.size();
                        anchor = slot;
                        bestGroups = fits;
                    }
                }
                if (anchor != null) {
                    for (List<Plan> group : bestGroups) placePairAtSlot(state, data, group, anchor, attempt, roomsByPlan, random);
                }
            }

            // Consecutive (连堂) plans are placed as whole runs before singles so
            // the two lessons really end up next to each other.
            for (Plan plan : fixedPriority) {
                int runLength = runLengths.getOrDefault(plan.id(), 0);
                if (runLength < 2) continue;
                while (System.nanoTime() < deadline) {
                    int free = freeOccurrences(state, plan);
                    if (free < runLength) break;
                    if (!placeRun(state, plan, runLength, roomsByPlan.get(plan.id()), random, attempt, slotByDayPeriod)) break;
                }
            }

            // Most-constrained-first: plans whose teacher is already heavily
            // loaded, or that have few rooms, are placed before the easy ones.
            List<Task> shuffled = orderTasks(singleTasks(state, data), pressure, random);
            for (Task task : shuffled) {
                if (System.nanoTime() >= deadline) continue;
                Plan plan = task.plan();
                if (plan.paired()) continue;
                if (placedFor(state, plan.id()) >= plan.weeklyPeriods()) continue;
                List<Slot> candidates = freeCandidateSlots(state, plan, planById, random);
                Placement bestPlacement = choosePlacement(state, plan, roomsByPlan.get(plan.id()), random, data.softWeights, candidates);
                if (bestPlacement == null) continue;
                state.add(autoEntry(plan, bestPlacement, attempt));
            }

            // Week-paired lessons are placed last: once the class has exactly
            // one free slot left, both weeks share it (语数间周). Placing them
            // first would scatter them and fragment specialist teachers' days.
            for (List<Plan> group : pairGroups.values()) {
                int lessons = group.stream().mapToInt(Plan::weeklyPeriods).max().orElse(0);
                for (int lesson = 0; lesson < lessons && System.nanoTime() < deadline; lesson++) {
                    int[] budget = { 400 };
                    if (!placePairGroup(state, data, group, planById, roomsByPlan, random, deadline, attempt, budget)) break;
                }
            }
            int unplaced = missingCount(state, data);
            if (unplaced > 0) {
                unplaced = repairMissing(state, data, planById, roomsByPlan, random, deadline, runLengths, slotByDayPeriod);
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
                localSearch(state, data, planById, roomsByPlan, random, deadline, runLengths);
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
            for (Entry entry : candidate.entries) {
                if (isMovable(candidate, planById, entry, runLengths)) movable.add(entry);
            }
            if (movable.isEmpty()) break;
            int kick = Math.max(1, movable.size() / 20);
            for (int index = 0; index < kick; index++) {
                candidate.remove(movable.get(random.nextInt(movable.size())));
            }
            int unplaced = repairMissing(candidate, data, planById, roomsByPlan, random, deadline, runLengths, slotByDayPeriod);
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
            localSearch(best, data, planById, roomsByPlan, new Random(randomSeed), deadline, runLengths);
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

    /** Run length per plan: explicit 连堂 wins, then a DOUBLE_PERIOD rule. Paired plans are excluded. */
    private static Map<String, Integer> runLengthsOf(SolverData data) {
        Map<String, Integer> result = new HashMap<>();
        for (Plan plan : data.plans) {
            if (plan.paired()) continue;
            int length = plan.consecutive() >= 2 ? Math.min(4, plan.consecutive()) : 0;
            for (Rule rule : data.rules) {
                if (!"DOUBLE_PERIOD".equals(rule.kind()) || !rule.matchesPlan(plan.teacherId(), plan.subjectId())) continue;
                length = Math.max(length, Math.min(4, Math.max(2, rule.number("periods", 2))));
            }
            if (length >= 2 && plan.weeklyPeriods() >= length) result.put(plan.id(), length);
        }
        return result;
    }

    private static List<String> pendingFixedSlots(State state, Plan plan) {
        if (!plan.hasFixedSlots()) return List.of();
        Set<String> occupied = new HashSet<>();
        for (Entry entry : state.entries) {
            if (entry.coursePlanId().equals(plan.id())) occupied.add(entry.slotId());
        }
        List<String> pending = new ArrayList<>();
        for (String slotId : plan.fixedSlotIds()) {
            if (!occupied.contains(slotId)) pending.add(slotId);
        }
        return pending;
    }

    private static int placedFor(State state, String planId) {
        int placed = 0;
        for (Entry entry : state.entries) if (entry.coursePlanId().equals(planId)) placed += 1;
        return placed;
    }

    /** Free (non-fixed, non-paired-run) occurrences still to place. */
    private static int freeOccurrences(State state, Plan plan) {
        int remaining = plan.weeklyPeriods() - placedFor(state, plan.id());
        int pendingFixed = pendingFixedSlots(state, plan).size();
        return Math.max(0, remaining - pendingFixed);
    }

    /** One single-lesson task per remaining free occurrence; fixed ones are handled separately. */
    private static List<Task> singleTasks(State state, SolverData data) {
        List<Task> tasks = new ArrayList<>();
        for (Plan plan : data.plans) {
            if (plan.paired()) continue;
            int free = freeOccurrences(state, plan);
            for (int index = 0; index < free; index++) tasks.add(new Task(plan, index));
        }
        return tasks;
    }

    /** Can every member of the pair group take this exact slot (ignoring ejection)? */
    private static boolean pairFitsAt(State state, List<Plan> group, Slot slot, Map<String, List<Room>> roomsByPlan) {
        Set<String> usedRooms = new HashSet<>();
        for (Plan plan : group) {
            List<Room> rooms = roomsByPlan.get(plan.id());
            if (rooms == null || rooms.isEmpty()) return false;
            boolean fits = false;
            for (Room room : rooms) {
                if (usedRooms.contains(room.id())) continue;
                if (!RuleEvaluator.canPlace(state, plan, slot, room)) continue;
                usedRooms.add(room.id());
                fits = true;
                break;
            }
            if (!fits) return false;
        }
        return true;
    }

    /** Add one lesson of every group member at the given slot (no ejection). */
    private static boolean placePairAtSlot(State state, SolverData data, List<Plan> group, Slot slot, int attempt,
                                           Map<String, List<Room>> roomsByPlan, Random random) {
        List<Plan> pending = new ArrayList<>();
        for (Plan plan : group) if (placedFor(state, plan.id()) < plan.weeklyPeriods()) pending.add(plan);
        if (pending.isEmpty()) return true;
        State.Snapshot snapshot = state.snapshot();
        for (Plan plan : pending) {
            Placement placement = choosePlacement(state, plan, roomsByPlan.get(plan.id()), random, data.softWeights, List.of(slot));
            if (placement == null) {
                state.restore(snapshot);
                return false;
            }
            state.add(autoEntry(plan, placement, attempt));
        }
        return true;
    }

    /**
     * Place one lesson of every member of an odd/even pair at the same slot.
     * The whole group is placed or rolled back together, so a leader can never
     * occupy a slot its partner's teacher/room cannot share.
     */
    private static boolean placePairGroup(State state, SolverData data, List<Plan> group, Map<String, Plan> planById,
                                          Map<String, List<Room>> roomsByPlan, Random random, long deadline, int attempt, int[] budget) {
        List<Plan> pending = new ArrayList<>();
        for (Plan plan : group) if (placedFor(state, plan.id()) < plan.weeklyPeriods()) pending.add(plan);
        if (pending.isEmpty()) return true;
        if (System.nanoTime() >= deadline || budget[0] <= 0) return false;
        java.util.LinkedHashSet<String> fixedSlots = new java.util.LinkedHashSet<>();
        for (Plan plan : pending) fixedSlots.addAll(pendingFixedSlots(state, plan));
        List<Slot> candidates = new ArrayList<>();
        if (!fixedSlots.isEmpty()) {
            for (String slotId : fixedSlots) {
                Slot slot = state.slots.get(slotId);
                if (slot != null) candidates.add(slot);
            }
        } else {
            candidates.addAll(state.slots.values());
            Collections.shuffle(candidates, random);
        }
        // First pass: no ejection at all. The class usually has exactly one
        // free slot left, and spending the ejection budget on full slots before
        // reaching it was what left a few pairs unplaced.
        for (Slot slot : candidates) {
            State.Snapshot snapshot = state.snapshot();
            for (Plan plan : pending) if (pendingFixedSlots(state, plan).contains(slot.id())) state.releaseReservation(plan, slot.id());
            boolean placed = true;
            for (Plan plan : pending) {
                Placement placement = choosePlacement(state, plan, roomsByPlan.get(plan.id()), random, data.softWeights, List.of(slot));
                if (placement == null) {
                    placed = false;
                    break;
                }
                state.add(autoEntry(plan, placement, attempt));
            }
            if (placed) return true;
            state.restore(snapshot);
        }
        // Second pass: eject one or two blockers when no slot is directly free.
        for (Slot slot : candidates) {
            State.Snapshot snapshot = state.snapshot();
            // All members reserve the same class/slot for their own fixed
            // occurrence; release every one of them together.
            for (Plan plan : pending) if (pendingFixedSlots(state, plan).contains(slot.id())) state.releaseReservation(plan, slot.id());
            boolean placed = true;
            for (Plan plan : pending) {
                if (!placeWithEjection(state, data, plan, slot.id(), planById, roomsByPlan, random, deadline, 2, budget)) {
                    placed = false;
                    break;
                }
            }
            if (placed) return true;
            state.restore(snapshot);
            if (budget[0] <= 0) return false;
        }
        return false;
    }

    /**
     * Place the fixed occurrence of a plan. The plan's own reservation is
     * released first so the lesson can use its slot; it is restored if the
     * attempt fails, keeping the slot protected for a later repair round.
     */
    private static boolean placeFixedOccurrence(State state, SolverData data, Plan plan, String slotId,
                                                Map<String, Plan> planById, Map<String, List<Room>> roomsByPlan,
                                                Random random, long deadline, int attempt, int depth, int[] budget) {
        if (System.nanoTime() >= deadline || budget[0] <= 0) return false;
        state.releaseReservation(plan, slotId);
        boolean placed = placeWithEjection(state, data, plan, slotId, planById, roomsByPlan, random, deadline, depth, budget);
        if (!placed) state.reserveFixed(plan, slotId);
        return placed;
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
            int fixedCount = plan.fixedCount();
            int slots = Math.max(1, data.slots.size() - fixedCount - unavailableByTeacher.getOrDefault(plan.teacherId(), 0));
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

    /** Slots a paired plan may use: the slot its partner already occupies, else every slot. */
    private static List<Slot> freeCandidateSlots(State state, Plan plan, Map<String, Plan> planById, Random random) {
        if (plan.paired()) {
            List<Slot> partners = new ArrayList<>();
            Set<String> seen = new HashSet<>();
            for (Entry entry : state.entries) {
                Plan other = planById.get(entry.coursePlanId());
                if (other == null || !plan.pairId().equals(other.pairId())) continue;
                Slot slot = state.slots.get(entry.slotId());
                if (slot != null && seen.add(slot.id())) partners.add(slot);
            }
            if (!partners.isEmpty()) return partners;
        }
        List<Slot> slots = new ArrayList<>(state.slots.values());
        Collections.shuffle(slots, random);
        return slots;
    }

    private static boolean placeRun(State state, Plan plan, int runLength, List<Room> rooms, Random random, int attempt,
                                    Map<String, Slot> slotByDayPeriod) {
        if (rooms == null || rooms.isEmpty()) return false;
        List<Integer> days = new ArrayList<>();
        for (Slot slot : state.slots.values()) if (!days.contains(slot.day())) days.add(slot.day());
        Collections.shuffle(days, random);
        for (int day : days) {
            List<Integer> starts = new ArrayList<>();
            for (Slot slot : state.slots.values()) {
                if (slot.day() != day) continue;
                boolean fits = true;
                for (int offset = 1; offset < runLength; offset++) {
                    if (!slotByDayPeriod.containsKey(day + "|" + (slot.period() + offset))) {
                        fits = false;
                        break;
                    }
                }
                if (fits) starts.add(slot.period());
            }
            Collections.shuffle(starts, random);
            for (int period : starts) {
                List<Slot> window = new ArrayList<>();
                for (int offset = 0; offset < runLength; offset++) window.add(slotByDayPeriod.get(day + "|" + (period + offset)));
                for (Room room : rooms) {
                    boolean ok = true;
                    for (Slot slot : window) {
                        if (!RuleEvaluator.canPlace(state, plan, slot, room)) {
                            ok = false;
                            break;
                        }
                    }
                    if (!ok) continue;
                    for (Slot slot : window) {
                        state.add(new Entry("entry-" + plan.id() + "-run-" + entrySequence++, plan.id(), plan.classId(),
                            plan.subjectId(), plan.teacherId(), room.id(), slot.id(), plan.weeks(), "AUTO", false));
                    }
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
            boolean reserved = false;
            for (String classId : group.classIds()) {
                if (state.classSlotReserved(classId, slot.id(), mask)) {
                    reserved = true;
                    break;
                }
            }
            if (reserved) continue;
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
                if (state.teacherSlotReserved(block.teacherId(), slot.id(), mask)) {
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

    private static Placement choosePlacement(State state, Plan plan, List<Room> rooms, Random random, SoftWeights weights, List<Slot> candidateSlots) {
        if (rooms == null || rooms.isEmpty() || candidateSlots == null || candidateSlots.isEmpty()) return null;
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
        Map<Integer, Integer> morningCutoff = new HashMap<>();
        if (weights.subjectTimePreference() > 0) {
            for (Slot slot : candidateSlots) morningCutoff.computeIfAbsent(slot.day(), state::morningCutoff);
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
                    + preferenceCost(state, plan, slot, weights, morningCutoff)
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

    /** Prefer the subject's morning/afternoon home when the soft objective is enabled. */
    private static int preferenceCost(State state, Plan plan, Slot slot, SoftWeights weights, Map<Integer, Integer> morningCutoff) {
        if (weights.subjectTimePreference() <= 0) return 0;
        String preference = state.subjectPreferenceOf(plan.subjectId());
        if (preference == null || preference.isBlank()) return 0;
        boolean morning = slot.period() <= morningCutoff.getOrDefault(slot.day(), slot.period());
        if ("morning".equals(preference) && !morning) return 6 + weights.subjectTimePreference() * 5;
        if ("afternoon".equals(preference) && morning) return 6 + weights.subjectTimePreference() * 5;
        return 0;
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
    private static int repairMissing(State state, SolverData data, Map<String, Plan> planById, Map<String, List<Room>> roomsByPlan,
                                     Random random, long deadline, Map<String, Integer> runLengths, Map<String, Slot> slotByDayPeriod) {
        List<Task> missing = missingTasks(state, data);
        int stillMissing = 0;
        int[] budget = { Math.max(200, missing.size() * 40) };
        for (Task task : missing) {
            if (System.nanoTime() >= deadline || budget[0] <= 0) {
                stillMissing += 1;
                continue;
            }
            Plan plan = task.plan();
            if (placedFor(state, plan.id()) >= plan.weeklyPeriods()) continue;
            boolean placed;
            if (plan.paired()) {
                List<Plan> group = new ArrayList<>();
                for (Plan other : data.plans) if (plan.pairId().equals(other.pairId())) group.add(other);
                placed = placePairGroup(state, data, group, planById, roomsByPlan, random, deadline, -1, budget);
            } else if (task.isFixed()) {
                placed = placeFixedOccurrence(state, data, plan, task.fixedSlotId(), planById, roomsByPlan, random, deadline, -1, 2, budget);
            } else {
                int runLength = runLengths.getOrDefault(plan.id(), 0);
                placed = false;
                if (runLength >= 2 && freeOccurrences(state, plan) >= runLength) {
                    placed = placeRun(state, plan, runLength, roomsByPlan.get(plan.id()), random, -1, slotByDayPeriod);
                }
                if (!placed) placed = placeWithEjection(state, data, plan, "", planById, roomsByPlan, random, deadline, 2, budget);
            }
            if (!placed) stillMissing += 1;
        }
        return stillMissing;
    }

    private static int missingCount(State state, SolverData data) {
        return missingTasks(state, data).size();
    }

    private static List<Task> missingTasks(State state, SolverData data) {
        Map<String, Integer> placed = new HashMap<>();
        Map<String, Set<String>> slotsByPlan = new HashMap<>();
        for (Entry entry : state.entries) {
            placed.merge(entry.coursePlanId(), 1, Integer::sum);
            slotsByPlan.computeIfAbsent(entry.coursePlanId(), key -> new HashSet<>()).add(entry.slotId());
        }
        List<Task> fixedTasks = new ArrayList<>();
        List<Task> freeTasks = new ArrayList<>();
        for (Plan plan : data.plans) {
            int gap = plan.weeklyPeriods() - placed.getOrDefault(plan.id(), 0);
            if (gap <= 0) continue;
            List<String> pending = new ArrayList<>();
            Set<String> occupied = slotsByPlan.getOrDefault(plan.id(), Set.of());
            for (String slotId : plan.fixedSlotIds()) if (!occupied.contains(slotId)) pending.add(slotId);
            for (int occurrence = 0; occurrence < gap; occurrence++) {
                if (occurrence < pending.size()) fixedTasks.add(new Task(plan, occurrence, pending.get(occurrence)));
                else freeTasks.add(new Task(plan, occurrence));
            }
        }
        List<Task> tasks = new ArrayList<>(fixedTasks);
        tasks.addAll(freeTasks);
        return tasks;
    }

    /**
     * Try to place one lesson. An explicit {@code onlySlotId} pins it (fixed
     * occurrence or a paired partner slot); otherwise every free slot is tried.
     */
    private static boolean placeWithEjection(State state, SolverData data, Plan plan, String onlySlotId,
                                             Map<String, Plan> planById, Map<String, List<Room>> roomsByPlan,
                                             Random random, long deadline, int depth, int[] budget) {
        if (System.nanoTime() >= deadline || budget[0] <= 0) return false;
        List<Room> rooms = roomsByPlan.get(plan.id());
        if (rooms == null || rooms.isEmpty()) return false;
        List<Slot> candidates;
        if (onlySlotId != null && !onlySlotId.isBlank()) {
            Slot slot = state.slots.get(onlySlotId);
            if (slot == null) return false;
            candidates = List.of(slot);
        } else {
            candidates = freeCandidateSlots(state, plan, planById, random);
        }
        Placement direct = choosePlacement(state, plan, rooms, random, data.softWeights, candidates);
        if (direct != null) {
            state.add(autoEntry(plan, direct, -1));
            return true;
        }
        if (depth <= 0) return false;
        int classSize = state.classes.containsKey(plan.classId()) ? state.classes.get(plan.classId()).size() : 0;
        for (Slot slot : candidates) {
            if (state.unavailable.contains(plan.teacherId() + "|" + slot.id())) continue;
            for (Room room : rooms) {
                if (room.capacity() < classSize) continue;
                List<Entry> blockers = blockingEntries(state, plan, slot, room);
                if (blockers.isEmpty() || blockers.size() > depth) continue;
                boolean protectedBlocker = false;
                for (Entry blocker : blockers) if (isProtectedEntry(state, planById, blocker)) protectedBlocker = true;
                if (protectedBlocker) continue;
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
                    if (blockerPlan == null || !placeWithEjection(state, data, blockerPlan, "", planById, roomsByPlan, random, deadline, depth - 1, budget)) {
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

    /** Locked, elective-group, paired and fixed lessons must never be ejected. */
    private static boolean isProtectedEntry(State state, Map<String, Plan> planById, Entry entry) {
        if (entry.locked() || entry.groupId() != null) return true;
        Plan plan = planById.get(entry.coursePlanId());
        if (plan == null) return true;
        if (plan.paired()) return true;
        return plan.fixedSlotIds().contains(entry.slotId());
    }

    /** An entry can be kicked by ruin-and-recreate only if no structural rule pins it. */
    private static boolean isMovable(State state, Map<String, Plan> planById, Entry entry, Map<String, Integer> runLengths) {
        if (entry.locked() || entry.groupId() != null) return false;
        Plan plan = planById.get(entry.coursePlanId());
        if (plan == null) return false;
        if (plan.paired() || plan.fixedSlotIds().contains(entry.slotId())) return false;
        return runLengths.getOrDefault(plan.id(), 0) < 2;
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

    private static void localSearch(State state, SolverData data, Map<String, Plan> planById, Map<String, List<Room>> roomsByPlan,
                                    Random random, long deadline, Map<String, Integer> runLengths) {
        if (!data.softWeights.anyEnabled()) return;
        int iterations = data.softWeights.classGaps() > 0 || data.softWeights.subjectTimePreference() > 0
            ? Math.min(12000, 200 + state.entries.size() * 20)
            : Math.min(1500, 200 + state.entries.size() * 10);
        int currentScore = softScore(state, data.softWeights).total();
        for (int i = 0; i < iterations && System.nanoTime() < deadline; i++) {
            List<Entry> movable = new ArrayList<>();
            for (Entry entry : state.entries) {
                if (isMovable(state, planById, entry, runLengths)) movable.add(entry);
            }
            if (movable.isEmpty()) return;
            Entry entry = movable.get(random.nextInt(movable.size()));
            Plan plan = planById.get(entry.coursePlanId());
            if (plan == null) continue;
            state.remove(entry);
            List<Slot> candidates = freeCandidateSlots(state, plan, planById, random);
            Placement placement = choosePlacement(state, plan, roomsByPlan.get(plan.id()), random, data.softWeights, candidates);
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
        int preference = 0;
        Map<String, Integer> classDaySubjects = new HashMap<>();
        Map<String, TreeSet<Integer>> teacherPeriods = new HashMap<>();
        Map<String, TreeSet<Integer>> classPeriods = new HashMap<>();
        Map<String, Integer> teacherLoads = new HashMap<>();
        Map<Integer, Integer> morningCutoff = new HashMap<>();
        for (Entry entry : state.entries) {
            Slot slot = state.slots.get(entry.slotId());
            if (slot == null) continue;
            String subjectKey = entry.classId() + "|" + slot.day() + "|" + entry.subjectId();
            classDaySubjects.merge(subjectKey, 1, Integer::sum);
            teacherPeriods.computeIfAbsent(entry.teacherId() + "|" + slot.day(), key -> new TreeSet<>()).add(slot.period());
            teacherLoads.merge(entry.teacherId(), 1, Integer::sum);
            if (weights.subjectTimePreference() > 0) {
                String subjectPreference = state.subjectPreferenceOf(entry.subjectId());
                if (subjectPreference != null && !subjectPreference.isBlank()) {
                    boolean morning = slot.period() <= morningCutoff.computeIfAbsent(slot.day(), state::morningCutoff);
                    if (("morning".equals(subjectPreference) && !morning) || ("afternoon".equals(subjectPreference) && morning)) preference += 1;
                }
            }
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
        int preferencePenalty = preference * weights.subjectTimePreference();
        int rulePenalty = RuleEvaluator.rulePenalty(state);
        int total = subjectPenalty + teacherGapPenalty + balance + classGapPenalty + preferencePenalty + rulePenalty;
        return new Score(Math.max(0, 100 - total), subjectPenalty, 0, teacherGapPenalty, balance, classGapPenalty, rulePenalty, preferencePenalty);
    }

    public record Score(int total, int subjectDistribution, int teacherContinuous, int teacherGaps, int teacherWorkloadBalance, int classGaps, int rulePenalty, int subjectTimePreference) {}
}
