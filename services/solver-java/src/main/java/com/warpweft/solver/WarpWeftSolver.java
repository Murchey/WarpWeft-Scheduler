package com.warpweft.solver;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.TreeSet;

public final class WarpWeftSolver {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String[] SCORE_KEYS = {
        "subjectDistribution", "teacherContinuous", "teacherGaps", "teacherWorkloadBalance", "rules"
    };

    private record Slot(String id, int day, int period, String label) {}
    private record Room(String id, String name, int capacity, String type) {}
    private record ClassInfo(String id, String name, int size) {}
    private record Plan(
        String id, String classId, String subjectId, String teacherId,
        int weeklyPeriods, String roomType, String fixedSlotId
    ) {}
    private record Entry(
        String id, String coursePlanId, String classId, String subjectId,
        String teacherId, String roomId, String slotId, String source, boolean locked
    ) {}
    private record Task(Plan plan, int occurrence) {}
    private record Placement(Slot slot, Room room) {}

    private record Rule(
        String kind, String importance, String scopeType, String scopeId,
        String timeType, List<Integer> days, int from, int to, JsonNode params
    ) {
        boolean applies(String teacherId, String subjectId, int day, int period) {
            if ("teacher".equals(scopeType) && !scopeId.equals(teacherId)) return false;
            if ("subject".equals(scopeType) && !scopeId.equals(subjectId)) return false;
            if ("weekday".equals(timeType) && !days.contains(day)) return false;
            if ("periodRange".equals(timeType) && (period < from || period > to)) return false;
            return true;
        }

        int number(String key, int fallback) {
            JsonNode value = params == null ? null : params.get(key);
            return value == null || value.isNull() ? fallback : value.asInt(fallback);
        }
    }

    private static final class State {
        final Map<String, Slot> slots = new LinkedHashMap<>();
        final Map<String, Room> rooms = new LinkedHashMap<>();
        final Map<String, ClassInfo> classes = new LinkedHashMap<>();
        final Set<String> unavailable = new HashSet<>();
        final Set<String> classSlot = new HashSet<>();
        final Set<String> teacherSlot = new HashSet<>();
        final Set<String> roomSlot = new HashSet<>();
        final Map<String, Integer> teacherLoad = new HashMap<>();
        final List<Entry> entries = new ArrayList<>();
        final List<Rule> rules = new ArrayList<>();

        State(Map<String, Slot> sourceSlots, Map<String, Room> sourceRooms, Map<String, ClassInfo> sourceClasses, Set<String> sourceUnavailable, List<Rule> sourceRules) {
            slots.putAll(sourceSlots);
            rooms.putAll(sourceRooms);
            classes.putAll(sourceClasses);
            unavailable.addAll(sourceUnavailable);
            rules.addAll(sourceRules);
        }

        boolean canPlace(Plan plan, Slot slot, Room room) {
            if (unavailable.contains(plan.teacherId() + "|" + slot.id())) return false;
            if (room.capacity() < classes.get(plan.classId()).size()) return false;
            if (plan.roomType() != null && !plan.roomType().isBlank() && !plan.roomType().equals(room.type())) return false;
            if (!classSlot.contains(plan.classId() + "|" + slot.id())
                && !teacherSlot.contains(plan.teacherId() + "|" + slot.id())
                && !roomSlot.contains(room.id() + "|" + slot.id())) {
                for (Rule rule : rules) {
                    if (!"must".equals(rule.importance()) || !rule.applies(plan.teacherId(), plan.subjectId(), slot.day(), slot.period())) continue;
                    if ("TEACHER_MAX_DAILY".equals(rule.kind()) && teacherDayLoad(plan.teacherId(), slot.day()) >= rule.number("maxPerDay", 1)) return false;
                    if ("SUBJECT_MAX_PER_DAY".equals(rule.kind()) && subjectDayCount(plan.classId(), slot.day(), plan.subjectId()) >= rule.number("maxPerDay", 1)) return false;
            if ("TEACHER_MAX_CONSECUTIVE".equals(rule.kind())) {
                        TreeSet<Integer> periods = teacherPeriods(plan.teacherId(), slot.day());
                        periods.add(slot.period());
                        int run = 1;
                        for (int p = slot.period() - 1; periods.contains(p); p--) run++;
                        for (int p = slot.period() + 1; periods.contains(p); p++) run++;
                        if (run > rule.number("maxConsecutive", 1)) return false;
                    }
                }
                return true;
            }
            return false;
        }

        TreeSet<Integer> teacherPeriods(String teacherId, int day) {
            TreeSet<Integer> periods = new TreeSet<>();
            for (Entry entry : entries) {
                if (!entry.teacherId().equals(teacherId)) continue;
                Slot slot = slots.get(entry.slotId());
                if (slot != null && slot.day() == day) periods.add(slot.period());
            }
            return periods;
        }

        void add(Entry entry) {
            entries.add(entry);
            classSlot.add(entry.classId() + "|" + entry.slotId());
            teacherSlot.add(entry.teacherId() + "|" + entry.slotId());
            roomSlot.add(entry.roomId() + "|" + entry.slotId());
            teacherLoad.merge(entry.teacherId(), 1, Integer::sum);
        }

        void remove(Entry entry) {
            entries.remove(entry);
            classSlot.remove(entry.classId() + "|" + entry.slotId());
            teacherSlot.remove(entry.teacherId() + "|" + entry.slotId());
            roomSlot.remove(entry.roomId() + "|" + entry.slotId());
            teacherLoad.computeIfPresent(entry.teacherId(), (key, value) -> value <= 1 ? null : value - 1);
        }

        int classDayLoad(String classId, int day) {
            return (int) entries.stream().filter(e -> e.classId().equals(classId))
                .filter(e -> slots.get(e.slotId()).day() == day).count();
        }

        int teacherDayLoad(String teacherId, int day) {
            return (int) entries.stream().filter(e -> e.teacherId().equals(teacherId))
                .filter(e -> slots.get(e.slotId()).day() == day).count();
        }

        int subjectDayCount(String classId, int day, String subjectId) {
            return (int) entries.stream().filter(e -> e.classId().equals(classId) && e.subjectId().equals(subjectId))
                .filter(e -> slots.get(e.slotId()).day() == day).count();
        }
    }

    private static String text(JsonNode node, String field, String fallback) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? fallback : value.asText(fallback);
    }

    private static int integer(JsonNode node, String field, int fallback) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? fallback : value.asInt(fallback);
    }

    private static ObjectNode baseResult(String protocolVersion, String status, List<String> violations, List<Entry> entries) {
        ObjectNode result = JSON.createObjectNode();
        result.put("protocolVersion", protocolVersion);
        result.put("status", status);
        ArrayNode entryArray = result.putArray("entries");
        for (Entry entry : entries) {
            ObjectNode item = entryArray.addObject();
            item.put("id", entry.id());
            item.put("coursePlanId", entry.coursePlanId());
            item.put("classId", entry.classId());
            item.put("teacherId", entry.teacherId());
            item.put("roomId", entry.roomId());
            item.put("slotId", entry.slotId());
            item.put("source", entry.source());
            item.put("locked", entry.locked());
        }
        ArrayNode violationArray = result.putArray("hardConstraintViolations");
        for (String violation : violations) violationArray.add(violation);
        result.put("softScore", 0);
        ObjectNode breakdown = result.putObject("scoreBreakdown");
        for (String key : SCORE_KEYS) breakdown.put(key, 0);
        ArrayNode unsatisfied = result.putArray("unsatisfiedRules");
        if (!violations.isEmpty()) unsatisfied.add("资源或时间不足");
        result.put("explanation", entries.isEmpty() ? "Java 求解器没有生成课表" : "Java 求解器未完成全部课程安排");
        result.put("elapsedMs", 0);
        result.put("hasFeasibleSolution", false);
        return result;
    }

    private static ObjectNode failure(String protocolVersion, List<String> violations) {
        ObjectNode result = baseResult(protocolVersion, "FAILED", violations, List.of());
        result.put("explanation", "排课失败：存在无法满足的硬约束");
        return result;
    }

    public static void main(String[] args) {
        long started = System.nanoTime();
        try {
            JsonNode root = JSON.readTree(System.in.readAllBytes());
            String protocolVersion = text(root, "protocolVersion", "unknown");
            SolverData data = parse(root, protocolVersion);
            System.err.println("[java] parsed " + data.slots.size() + " slots, " + data.rooms.size() + " rooms, " + data.plans.size() + " plans");
            if (!data.violations.isEmpty()) {
                ObjectNode result = failure(protocolVersion, data.violations);
                result.put("elapsedMs", (System.nanoTime() - started) / 1_000_000);
                System.out.println(JSON.writeValueAsString(result));
                return;
            }
            ObjectNode result = solve(data, Math.max(1, integer(root, "timeLimitSeconds", 30)), Math.max(1, integer(root, "randomSeed", 1)), started);
            System.out.println(JSON.writeValueAsString(result));
        } catch (Throwable error) {
            ObjectNode result = failure("unknown", List.of("Java 求解器异常：" + error.getMessage()));
            result.put("elapsedMs", (System.nanoTime() - started) / 1_000_000);
            try {
                System.out.println(JSON.writeValueAsString(result));
            } catch (Exception ignored) {
                System.out.println("{\"status\":\"FAILED\",\"entries\":[],\"hasFeasibleSolution\":false}");
            }
        }
    }

    private static SolverData parse(JsonNode root, String protocolVersion) {
        SolverData data = new SolverData(protocolVersion);
        for (JsonNode node : root.path("timeSlots")) {
            data.slots.put(text(node, "id", ""), new Slot(
                text(node, "id", ""), integer(node, "day", 0), integer(node, "period", 0), text(node, "label", "")
            ));
        }
        for (JsonNode node : root.path("rooms")) {
            data.rooms.put(text(node, "id", ""), new Room(
                text(node, "id", ""), text(node, "name", ""), integer(node, "capacity", 0), text(node, "type", "普通教室")
            ));
        }
        for (JsonNode node : root.path("classes")) {
            data.classes.put(text(node, "id", ""), new ClassInfo(
                text(node, "id", ""), text(node, "name", ""), integer(node, "size", 40)
            ));
        }
        for (JsonNode node : root.path("unavailableSlots")) {
            data.unavailable.add(text(node, "teacherId", "") + "|" + text(node, "slotId", ""));
        }
        Set<String> classIds = data.classes.keySet();
        Set<String> teacherIds = new HashSet<>();
        for (JsonNode node : root.path("teachers")) teacherIds.add(text(node, "id", ""));
        Set<String> subjectIds = new HashSet<>();
        for (JsonNode node : root.path("subjects")) subjectIds.add(text(node, "id", ""));
        for (JsonNode node : root.path("coursePlans")) {
            Plan plan = new Plan(
                text(node, "id", ""), text(node, "classId", ""), text(node, "subjectId", ""),
                text(node, "teacherId", ""), integer(node, "weeklyPeriods", 0),
                text(node, "roomType", ""), text(node, "fixedSlotId", "")
            );
            if (plan.weeklyPeriods() <= 0) data.violations.add("教学计划 " + plan.id() + " 的周课时必须大于 0");
            if (!classIds.contains(plan.classId())) data.violations.add("教学计划 " + plan.id() + " 引用了不存在的班级");
            if (!teacherIds.contains(plan.teacherId())) data.violations.add("教学计划 " + plan.id() + " 引用了不存在的教师");
            if (!subjectIds.contains(plan.subjectId())) data.violations.add("教学计划 " + plan.id() + " 引用了不存在的学科");
            if (!plan.fixedSlotId().isBlank() && !data.slots.containsKey(plan.fixedSlotId())) data.violations.add("教学计划 " + plan.id() + " 引用了不存在的固定时间");
            data.plans.add(plan);
        }
        for (JsonNode node : root.path("rules")) {
            if (!node.path("enabled").asBoolean(true)) continue;
            JsonNode scope = node.path("scope");
            JsonNode time = node.path("time");
            List<Integer> days = new ArrayList<>();
            for (JsonNode day : time.path("days")) days.add(day.asInt());
            data.rules.add(new Rule(
                text(node, "kind", ""), text(node, "importance", "prefer"),
                text(scope, "type", "all"),
                text(scope, "teacherId", text(scope, "subjectId", "")),
                text(time, "type", "all"), days,
                integer(time, "from", 1), integer(time, "to", 12),
                node.path("params")
            ));
        }
        for (JsonNode node : root.path("lockedEntries")) {
            final String planId = text(node, "coursePlanId", "");
            Entry entry = new Entry(
                text(node, "id", ""), planId, text(node, "classId", ""),
                "", text(node, "teacherId", ""), text(node, "roomId", ""), text(node, "slotId", ""),
                "MANUAL", true
            );
            Plan plan = data.plans.stream().filter(p -> p.id().equals(planId)).findFirst().orElse(null);
            if (plan == null) {
                data.violations.add("锁定课程 " + entry.id() + " 引用了不存在的教学计划");
                continue;
            }
            entry = new Entry(entry.id(), plan.id(), plan.classId(), plan.subjectId(), plan.teacherId(), entry.roomId(), entry.slotId(), "MANUAL", true);
            if (!data.slots.containsKey(entry.slotId()) || !data.rooms.containsKey(entry.roomId())) {
                data.violations.add("锁定课程 " + entry.id() + " 引用了不存在的时间或教室");
                continue;
            }
            data.locked.add(entry);
        }
        return data;
    }

    private static ObjectNode solve(SolverData data, int timeLimitSeconds, int randomSeed, long started) {
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
            ObjectNode result = failure(data.protocolVersion, violations);
            result.put("elapsedMs", (System.nanoTime() - started) / 1_000_000);
            return result;
        }

        List<Task> tasks = new ArrayList<>();
        for (Plan plan : data.plans) {
            int locked = lockedByPlan.getOrDefault(plan.id(), 0);
            for (int occurrence = locked; occurrence < plan.weeklyPeriods(); occurrence++) tasks.add(new Task(plan, occurrence));
        }

        int attempts = 8;
        System.err.println("[java] solve start: " + tasks.size() + " tasks, " + data.locked.size() + " locked");
        for (int attempt = 0; attempt < attempts && System.nanoTime() < deadline; attempt++) {
            Random random = new Random(randomSeed + attempt * 7919L);
            State state = new State(data.slots, data.rooms, data.classes, data.unavailable, data.rules);
            List<String> attemptViolations = new ArrayList<>();
            for (Entry entry : data.locked) {
                Plan plan = data.plans.stream().filter(p -> p.id().equals(entry.coursePlanId())).findFirst().orElse(null);
                Slot slot = data.slots.get(entry.slotId());
                Room room = data.rooms.get(entry.roomId());
                if (plan == null || slot == null || room == null || !state.canPlace(plan, slot, room)) {
                    attemptViolations.add("锁定课程冲突： " + entry.id());
                } else {
                    state.add(entry);
                }
            }
            if (!attemptViolations.isEmpty()) {
                if (best == null) {
                    best = state;
                    bestUnplaced = tasks.size();
                }
                violations = attemptViolations;
                continue;
            }
            List<Task> shuffled = new ArrayList<>(tasks);
            java.util.Collections.shuffle(shuffled, random);
            shuffled.sort(Comparator
                .comparing((Task task) -> task.plan().fixedSlotId() == null)
                .thenComparing((Task task) -> -task.plan().weeklyPeriods()));
            List<Task> unplaced = new ArrayList<>();
            for (Task task : shuffled) {
                if (System.nanoTime() >= deadline) {
                    unplaced.add(task);
                    continue;
                }
                Placement bestPlacement = choosePlacement(state, task.plan(), random);
                if (bestPlacement == null) {
                    unplaced.add(task);
                    continue;
                }
                state.add(new Entry(
                    "entry-" + task.plan().id() + "-" + task.occurrence() + "-" + attempt,
                    task.plan().id(), task.plan().classId(), task.plan().subjectId(), task.plan().teacherId(),
                    bestPlacement.room().id(), bestPlacement.slot().id(), "AUTO", false
                ));
            }
            int score = softScore(state).total();
            System.err.println("[java] attempt " + (attempt + 1) + ": placed " + (tasks.size() - unplaced.size()) + "/" + tasks.size() + ", score " + score);
            if (unplaced.size() < bestUnplaced || (unplaced.size() == bestUnplaced && score > bestScore)) {
                best = state;
                bestUnplaced = unplaced.size();
                bestScore = score;
            }
            if (unplaced.isEmpty()) {
                localSearch(state, data, random, deadline);
                ObjectNode result = success(data.protocolVersion, state, started);
                System.err.println("[java] completed in " + result.get("elapsedMs").asLong() + " ms");
                return result;
            }
        }

        if (best != null && bestUnplaced == 0) {
            return success(data.protocolVersion, best, started);
        }
        List<String> messages = new ArrayList<>(violations);
        if (best == null || bestUnplaced > 0) {
            messages.add("无法在给定时间和资源下安排全部课程");
        }
        ObjectNode result = baseResult(data.protocolVersion, "FAILED", messages, best == null ? List.of() : best.entries);
        result.put("explanation", messages.isEmpty() ? "排课失败" : messages.get(0));
        result.put("elapsedMs", (System.nanoTime() - started) / 1_000_000);
        result.put("hasFeasibleSolution", false);
        return result;
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
                if (!state.canPlace(plan, slot, room)) continue;
                int score = state.classDayLoad(plan.classId(), slot.day()) * 4
                    + state.teacherDayLoad(plan.teacherId(), slot.day()) * 2
                    + state.subjectDayCount(plan.classId(), slot.day(), plan.subjectId()) * 10
                    + Math.max(0, room.capacity() - state.classes.get(plan.classId()).size()) / 10
                    + rulePlacementPenalty(state, plan, slot)
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
            List<Entry> movable = state.entries.stream().filter(entry -> !entry.locked()).toList();
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

    private static int rulePlacementPenalty(State state, Plan plan, Slot slot) {
        int penalty = 0;
        Map<Integer, Integer> minDay = new HashMap<>();
        Map<Integer, Integer> maxDay = new HashMap<>();
        for (Slot item : state.slots.values()) {
            minDay.merge(item.day(), item.period(), Math::min);
            maxDay.merge(item.day(), item.period(), Math::max);
        }
        for (Rule rule : state.rules) {
            if (!rule.applies(plan.teacherId(), plan.subjectId(), slot.day(), slot.period())) continue;
            if ("TEACHER_MAX_DAILY".equals(rule.kind()) && state.teacherDayLoad(plan.teacherId(), slot.day()) >= rule.number("maxPerDay", 1)) penalty += 60;
            if ("SUBJECT_MAX_PER_DAY".equals(rule.kind()) && state.subjectDayCount(plan.classId(), slot.day(), plan.subjectId()) >= rule.number("maxPerDay", 1)) penalty += 60;
            if ("SUBJECT_SPREAD".equals(rule.kind()) && state.subjectDayCount(plan.classId(), slot.day(), plan.subjectId()) >= rule.number("maxPerDay", 1)) penalty += 40;
            if ("SUBJECT_TIME_PREFERENCE".equals(rule.kind())) {
                int mid = (minDay.getOrDefault(slot.day(), slot.period()) + maxDay.getOrDefault(slot.day(), slot.period())) / 2;
                boolean morning = slot.period() <= mid;
                if (("morning".equals(rule.params().path("preference").asText()) && !morning)
                    || ("afternoon".equals(rule.params().path("preference").asText()) && morning)) penalty += 4;
            }
            if ("SUBJECT_AVOID_FIRST_LAST".equals(rule.kind())) {
                boolean first = slot.period() == minDay.getOrDefault(slot.day(), slot.period());
                boolean last = slot.period() == maxDay.getOrDefault(slot.day(), slot.period());
                if (("first".equals(rule.params().path("avoid").asText()) && first)
                    || ("last".equals(rule.params().path("avoid").asText()) && last)) penalty += 4;
            }
            if ("TEACHER_MAX_CONSECUTIVE".equals(rule.kind())) {
                TreeSet<Integer> periods = state.teacherPeriods(plan.teacherId(), slot.day());
                int run = 1;
                for (int p = slot.period() - 1; periods.contains(p); p--) run++;
                for (int p = slot.period() + 1; periods.contains(p); p++) run++;
                if (run > rule.number("maxConsecutive", 1)) penalty += 20;
            }
        }
        return penalty;
    }

    private static int rulePenalty(State state) {
        int penalty = 0;
        Map<Integer, Integer> minDay = new HashMap<>();
        Map<Integer, Integer> maxDay = new HashMap<>();
        for (Slot slot : state.slots.values()) {
            minDay.merge(slot.day(), slot.period(), Math::min);
            maxDay.merge(slot.day(), slot.period(), Math::max);
        }
        for (Rule rule : state.rules) {
            if ("TEACHER_MAX_DAILY".equals(rule.kind())) {
                Map<String, Integer> counts = new HashMap<>();
                for (Entry entry : state.entries) {
                    Slot slot = state.slots.get(entry.slotId());
                    if (slot == null || !rule.applies(entry.teacherId(), entry.subjectId(), slot.day(), slot.period())) continue;
                    counts.merge(entry.teacherId() + "|" + slot.day(), 1, Integer::sum);
                }
                int max = rule.number("maxPerDay", 1);
                for (int count : counts.values()) if (count > max) penalty += (count - max) * 3;
            }
            if ("SUBJECT_MAX_PER_DAY".equals(rule.kind()) || "SUBJECT_SPREAD".equals(rule.kind())) {
                Map<String, Integer> counts = new HashMap<>();
                for (Entry entry : state.entries) {
                    Slot slot = state.slots.get(entry.slotId());
                    if (slot == null || !rule.applies(entry.teacherId(), entry.subjectId(), slot.day(), slot.period())) continue;
                    counts.merge(entry.classId() + "|" + slot.day() + "|" + entry.subjectId(), 1, Integer::sum);
                }
                int max = rule.number("maxPerDay", 1);
                for (int count : counts.values()) if (count > max) penalty += (count - max) * 3;
            }
            if ("SUBJECT_TIME_PREFERENCE".equals(rule.kind()) || "SUBJECT_AVOID_FIRST_LAST".equals(rule.kind())) {
                for (Entry entry : state.entries) {
                    Slot slot = state.slots.get(entry.slotId());
                    if (slot == null || !rule.applies(entry.teacherId(), entry.subjectId(), slot.day(), slot.period())) continue;
                    int mid = (minDay.getOrDefault(slot.day(), slot.period()) + maxDay.getOrDefault(slot.day(), slot.period())) / 2;
                    boolean morning = slot.period() <= mid;
                    if ("SUBJECT_TIME_PREFERENCE".equals(rule.kind())) {
                        String preference = rule.params().path("preference").asText();
                        if (("morning".equals(preference) && !morning) || ("afternoon".equals(preference) && morning)) penalty += 3;
                    } else {
                        boolean first = slot.period() == minDay.getOrDefault(slot.day(), slot.period());
                        boolean last = slot.period() == maxDay.getOrDefault(slot.day(), slot.period());
                        String avoid = rule.params().path("avoid").asText();
                        if (("first".equals(avoid) && first) || ("last".equals(avoid) && last)) penalty += 3;
                    }
                }
            }
            if ("TEACHER_FREE_HALF_DAY".equals(rule.kind())) {
                Map<String, TreeSet<Integer>> periods = new HashMap<>();
                Set<String> teachers = new HashSet<>();
                Map<Integer, List<Slot>> slotsByDay = new HashMap<>();
                for (Slot item : state.slots.values()) slotsByDay.computeIfAbsent(item.day(), key -> new ArrayList<>()).add(item);
                for (Entry entry : state.entries) {
                    Slot slot = state.slots.get(entry.slotId());
                    if (slot == null || !rule.applies(entry.teacherId(), entry.subjectId(), slot.day(), slot.period())) continue;
                    teachers.add(entry.teacherId());
                    periods.computeIfAbsent(entry.teacherId() + "|" + slot.day(), key -> new TreeSet<>()).add(slot.period());
                }
                int minFree = rule.number("minFreeHalfDays", 1);
                for (String teacherId : teachers) {
                    int free = 0;
                    for (Map.Entry<Integer, List<Slot>> dayEntry : slotsByDay.entrySet()) {
                        int day = dayEntry.getKey();
                        int mid = (minDay.getOrDefault(day, 1) + maxDay.getOrDefault(day, 1)) / 2;
                        TreeSet<Integer> set = periods.getOrDefault(teacherId + "|" + day, new TreeSet<>());
                        boolean morningTaken = false;
                        boolean afternoonTaken = false;
                        for (Integer period : set) {
                            if (period <= mid) morningTaken = true; else afternoonTaken = true;
                        }
                        if (!morningTaken) free++;
                        if (!afternoonTaken) free++;
                    }
                    if (free < minFree) penalty += (minFree - free) * 4;
                }
            }
            if ("TEACHER_MAX_CONSECUTIVE".equals(rule.kind())) {
                Map<String, TreeSet<Integer>> periods = new HashMap<>();
                for (Entry entry : state.entries) {
                    Slot slot = state.slots.get(entry.slotId());
                    if (slot == null || !rule.applies(entry.teacherId(), entry.subjectId(), slot.day(), slot.period())) continue;
                    periods.computeIfAbsent(entry.teacherId() + "|" + slot.day(), key -> new TreeSet<>()).add(slot.period());
                }
                int max = rule.number("maxConsecutive", 1);
                for (TreeSet<Integer> set : periods.values()) {
                    int run = 0;
                    Integer previous = null;
                    for (Integer period : set) {
                        run = previous != null && period == previous + 1 ? run + 1 : 1;
                        if (run > max) penalty += 3;
                        previous = period;
                    }
                }
            }
        }
        return penalty;
    }

    private record Score(int total, int subjectDistribution, int teacherContinuous, int teacherGaps, int teacherWorkloadBalance, int rulePenalty) {}

    private static Score softScore(State state) {
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
        int rulePenalty = rulePenalty(state);
        int total = subject + gaps + balance + rulePenalty;
        return new Score(Math.max(0, 100 - total), subject, 0, gaps, balance, rulePenalty);
    }

    private static ObjectNode success(String protocolVersion, State state, long started) {
        Score score = softScore(state);
        ObjectNode result = baseResult(protocolVersion, "COMPLETED", List.of(), state.entries);
        result.put("softScore", score.total());
        ObjectNode breakdown = result.putObject("scoreBreakdown");
        breakdown.put("subjectDistribution", score.subjectDistribution());
        breakdown.put("teacherContinuous", score.teacherContinuous());
        breakdown.put("teacherGaps", score.teacherGaps());
        breakdown.put("teacherWorkloadBalance", score.teacherWorkloadBalance());
        breakdown.put("rules", score.rulePenalty());
        result.put("explanation", "Java 21 求解器已生成可行课表");
        result.put("elapsedMs", (System.nanoTime() - started) / 1_000_000);
        result.put("hasFeasibleSolution", true);
        return result;
    }

    private static final class SolverData {
        final String protocolVersion;
        final Map<String, Slot> slots = new LinkedHashMap<>();
        final Map<String, Room> rooms = new LinkedHashMap<>();
        final Map<String, ClassInfo> classes = new LinkedHashMap<>();
        final Set<String> unavailable = new HashSet<>();
        final List<Plan> plans = new ArrayList<>();
        final List<Entry> locked = new ArrayList<>();
        final List<Rule> rules = new ArrayList<>();
        final List<String> violations = new ArrayList<>();

        SolverData(String protocolVersion) {
            this.protocolVersion = protocolVersion;
        }
    }
}
