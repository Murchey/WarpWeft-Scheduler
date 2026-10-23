package com.warpweft.solver.protocol;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.warpweft.solver.engine.Scheduler;
import com.warpweft.solver.engine.State;
import com.warpweft.solver.model.ClassInfo;
import com.warpweft.solver.model.ElectiveBlock;
import com.warpweft.solver.model.ElectiveGroup;
import com.warpweft.solver.model.Entry;
import com.warpweft.solver.model.Plan;
import com.warpweft.solver.model.Room;
import com.warpweft.solver.model.Slot;
import com.warpweft.solver.model.SolverData;
import com.warpweft.solver.rules.Rule;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class SolverProtocol {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String[] SCORE_KEYS = {
        "subjectDistribution", "teacherContinuous", "teacherGaps", "teacherWorkloadBalance", "rules"
    };

    public static void run(String[] args) {
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
            ObjectNode result = Scheduler.solve(
                data,
                Math.max(1, integer(root, "timeLimitSeconds", 30)),
                Math.max(1, integer(root, "randomSeed", 1)),
                started,
                text(root, "checkpointFile", ""),
                integer(root, "stagnationSeconds", 0)
            );
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
                text(node, "id", ""), integer(node, "day", 0), integer(node, "period", 0), text(node, "label", ""), text(node, "kind", "regular")
            ));
        }
        for (JsonNode node : root.path("rooms")) {
            data.rooms.put(text(node, "id", ""), new Room(
                text(node, "id", ""), text(node, "name", ""), integer(node, "capacity", 0), text(node, "type", "普通教室")
            ));
        }
        Map<String, String> homeroomByClass = new HashMap<>();
        for (JsonNode node : root.path("classes")) {
            String classId = text(node, "id", "");
            data.classes.put(classId, new ClassInfo(
                classId, text(node, "name", ""), integer(node, "size", 40)
            ));
            String homeroom = text(node, "homeroomTeacherId", "");
            if (!homeroom.isBlank()) homeroomByClass.put(classId, homeroom);
        }
        for (JsonNode node : root.path("unavailableSlots")) {
            data.unavailable.add(text(node, "teacherId", "") + "|" + text(node, "slotId", ""));
        }
        Set<String> classIds = data.classes.keySet();
        Set<String> teacherIds = new HashSet<>();
        Map<String, Set<String>> teacherClasses = new HashMap<>();
        Map<String, Set<String>> teacherSubjects = new HashMap<>();
        for (JsonNode node : root.path("teachers")) {
            String teacherId = text(node, "id", "");
            teacherIds.add(teacherId);
            Set<String> bound = new HashSet<>();
            for (JsonNode classNode : node.path("classIds")) {
                String classId = classNode.asText("");
                if (classIds.contains(classId)) bound.add(classId);
                else data.violations.add("教师 " + teacherId + " 的负责班级引用了不存在的班级：" + classId);
            }
            teacherClasses.put(teacherId, bound);
            Set<String> subjects = new HashSet<>();
            for (JsonNode subjectNode : node.path("subjectIds")) subjects.add(subjectNode.asText(""));
            teacherSubjects.put(teacherId, subjects);
        }
        Set<String> subjectIds = new HashSet<>();
        for (JsonNode node : root.path("subjects")) subjectIds.add(text(node, "id", ""));
        for (JsonNode node : root.path("coursePlans")) {
            Plan plan = new Plan(
                text(node, "id", ""), text(node, "classId", ""), text(node, "subjectId", ""),
                text(node, "teacherId", ""), integer(node, "weeklyPeriods", 0),
                text(node, "roomType", ""), text(node, "fixedSlotId", ""), text(node, "weeks", "all"), text(node, "kind", "regular")
            );
            if (plan.weeklyPeriods() <= 0) data.violations.add("教学计划 " + plan.id() + " 的周课时必须大于 0");
            if (!classIds.contains(plan.classId())) data.violations.add("教学计划 " + plan.id() + " 引用了不存在的班级");
            if (!teacherIds.contains(plan.teacherId())) data.violations.add("教学计划 " + plan.id() + " 引用了不存在的教师");
            Set<String> boundClasses = teacherClasses.get(plan.teacherId());
            if (boundClasses != null && !boundClasses.isEmpty() && !boundClasses.contains(plan.classId())) {
                data.violations.add("教学计划 " + plan.id() + " 的教师 " + plan.teacherId() + " 不负责班级 " + plan.classId());
            }
            if (!subjectIds.contains(plan.subjectId())) data.violations.add("教学计划 " + plan.id() + " 引用了不存在的学科");
            if (!plan.fixedSlotId().isBlank() && !data.slots.containsKey(plan.fixedSlotId())) data.violations.add("教学计划 " + plan.id() + " 引用了不存在的固定时间");
            data.plans.add(plan);
        }
        Map<String, List<String>> homeroomByTeacher = new HashMap<>();
        for (Map.Entry<String, String> entry : homeroomByClass.entrySet()) {
            String classId = entry.getKey();
            String teacherId = entry.getValue();
            ClassInfo klass = data.classes.get(classId);
            if (!teacherIds.contains(teacherId)) {
                data.violations.add("班级 " + classId + " 的班主任不存在");
                continue;
            }
            List<String> assigned = homeroomByTeacher.computeIfAbsent(teacherId, key -> new ArrayList<>());
            assigned.add(klass == null ? classId : klass.name());
            Set<String> bound = teacherClasses.get(teacherId);
            if (bound != null && !bound.isEmpty() && !bound.contains(classId)) {
                data.violations.add("班主任 " + teacherId + " 不负责班级 " + classId);
            }
            List<Plan> classPlans = data.plans.stream().filter(plan -> plan.classId().equals(classId)).toList();
            Set<String> teacherSubjectIds = teacherSubjects.getOrDefault(teacherId, Set.of());
            boolean qualified = !classPlans.isEmpty() && (teacherSubjectIds.isEmpty()
                || classPlans.stream().anyMatch(plan -> teacherSubjectIds.contains(plan.subjectId())));
            boolean hasLesson = classPlans.stream().anyMatch(plan -> plan.teacherId().equals(teacherId));
            if (qualified && !hasLesson) {
                data.violations.add("班主任 " + teacherId + " 必须在本班 " + classId + " 承担至少一节课");
            }
        }
        for (Map.Entry<String, List<String>> entry : homeroomByTeacher.entrySet()) {
            if (entry.getValue().size() > 1) {
                data.violations.add("教师 " + entry.getKey() + " 同时担任多个班的班主任：" + String.join("、", entry.getValue()));
            }
        }
        for (JsonNode node : root.path("electiveGroups")) {
            String groupId = text(node, "id", "");
            List<String> groupClasses = new ArrayList<>();
            for (JsonNode classNode : node.path("classIds")) {
                String classId = classNode.asText("");
                if (!classIds.contains(classId)) {
                    data.violations.add("走班组 " + groupId + " 引用了不存在的班级：" + classId);
                    continue;
                }
                groupClasses.add(classId);
            }
            List<ElectiveBlock> blocks = new ArrayList<>();
            for (JsonNode blockNode : node.path("blocks")) {
                String teacherId = text(blockNode, "teacherId", "");
                if (!teacherIds.contains(teacherId)) {
                    data.violations.add("走班组 " + groupId + " 的并行班引用了不存在的教师：" + teacherId);
                    continue;
                }
                blocks.add(new ElectiveBlock(
                    text(blockNode, "id", groupId + "-block-" + (blocks.size() + 1)),
                    text(blockNode, "name", ""),
                    teacherId,
                    text(blockNode, "roomType", "")
                ));
            }
            int weekly = integer(node, "weeklyPeriods", 0);
            if (weekly <= 0) data.violations.add("走班组 " + groupId + " 的周课时必须大于 0");
            if (groupClasses.isEmpty()) data.violations.add("走班组 " + groupId + " 没有参与班级");
            if (blocks.isEmpty()) data.violations.add("走班组 " + groupId + " 没有并行班");
            if (!subjectIds.contains(text(node, "subjectId", ""))) data.violations.add("走班组 " + groupId + " 引用了不存在的学科");
            if (!data.violations.isEmpty()) continue;
            data.groups.add(new ElectiveGroup(
                groupId, text(node, "name", groupId), text(node, "subjectId", ""), weekly, groupClasses, blocks
            ));
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
            entry = new Entry(entry.id(), plan.id(), plan.classId(), plan.subjectId(), plan.teacherId(), entry.roomId(), entry.slotId(), plan.weeks(), "MANUAL", true);
            if (!data.slots.containsKey(entry.slotId()) || !data.rooms.containsKey(entry.roomId())) {
                data.violations.add("锁定课程 " + entry.id() + " 引用了不存在的时间或教室");
                continue;
            }
            data.locked.add(entry);
        }
        // Resume checkpoint: keep the lessons where they are but let repair move
        // them again. Invalid seeds are dropped, not fatal — the job continues.
        for (JsonNode node : root.path("seedEntries")) {
            String planId = text(node, "coursePlanId", "");
            Plan plan = data.plans.stream().filter(p -> p.id().equals(planId)).findFirst().orElse(null);
            if (plan == null) continue;
            Entry entry = new Entry(
                text(node, "id", ""), plan.id(), plan.classId(), plan.subjectId(), plan.teacherId(),
                text(node, "roomId", ""), text(node, "slotId", ""), plan.weeks(), "AUTO", false
            );
            if (!data.slots.containsKey(entry.slotId()) || !data.rooms.containsKey(entry.roomId())) continue;
            data.seed.add(entry);
        }
        return data;
    }

    private static String text(JsonNode node, String field, String fallback) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? fallback : value.asText(fallback);
    }

    private static int integer(JsonNode node, String field, int fallback) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? fallback : value.asInt(fallback);
    }

    public static ObjectNode baseResult(String protocolVersion, String status, List<String> violations, List<Entry> entries) {
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
            item.put("weeks", entry.weeks());
            if (entry.groupId() != null) item.put("groupId", entry.groupId());
            if (entry.blockId() != null) item.put("blockId", entry.blockId());
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

    public static ObjectNode failure(String protocolVersion, List<String> violations) {
        ObjectNode result = baseResult(protocolVersion, "FAILED", violations, List.of());
        result.put("explanation", "排课失败：存在无法满足的硬约束");
        return result;
    }

    public static ObjectNode success(String protocolVersion, State state, long started) {
        Scheduler.Score score = Scheduler.softScore(state);
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
}



