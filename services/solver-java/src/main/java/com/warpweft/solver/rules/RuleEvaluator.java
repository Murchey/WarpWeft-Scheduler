package com.warpweft.solver.rules;

import com.warpweft.solver.engine.State;
import com.warpweft.solver.model.Entry;
import com.warpweft.solver.model.Plan;
import com.warpweft.solver.model.Room;
import com.warpweft.solver.model.Slot;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

public final class RuleEvaluator {
    public static boolean canPlace(State state, Plan plan, Slot slot, Room room) {
        if (state.unavailable.contains(plan.teacherId() + "|" + slot.id())) return false;
        if (room.capacity() < state.classes.get(plan.classId()).size()) return false;
        if (plan.roomType() != null && !plan.roomType().isBlank() && !plan.roomType().equals(room.type())) return false;
        if (!state.classSlot.contains(plan.classId() + "|" + slot.id())
            && !state.teacherSlot.contains(plan.teacherId() + "|" + slot.id())
            && !state.roomSlot.contains(room.id() + "|" + slot.id())) {
            for (Rule rule : state.rules) {
                if (!"must".equals(rule.importance()) || !rule.applies(plan.teacherId(), plan.subjectId(), slot.day(), slot.period())) continue;
                if ("TEACHER_MAX_DAILY".equals(rule.kind()) && state.teacherDayLoad(plan.teacherId(), slot.day()) >= rule.number("maxPerDay", 1)) return false;
                if ("SUBJECT_MAX_PER_DAY".equals(rule.kind()) && state.subjectDayCount(plan.classId(), slot.day(), plan.subjectId()) >= rule.number("maxPerDay", 1)) return false;
                if ("TEACHER_MAX_CONSECUTIVE".equals(rule.kind())) {
                    TreeSet<Integer> periods = state.teacherPeriods(plan.teacherId(), slot.day());
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

    public static int rulePlacementPenalty(State state, Plan plan, Slot slot) {
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

    public static int rulePenalty(State state) {
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
            if ("DOUBLE_PERIOD".equals(rule.kind())) {
                Map<String, TreeSet<Integer>> periods = new HashMap<>();
                for (Entry entry : state.entries) {
                    Slot slot = state.slots.get(entry.slotId());
                    if (slot == null || !rule.applies(entry.teacherId(), entry.subjectId(), slot.day(), slot.period())) continue;
                    periods.computeIfAbsent(entry.classId() + "|" + slot.day() + "|" + entry.subjectId(), key -> new TreeSet<>()).add(slot.period());
                }
                int desired = Math.max(2, rule.number("periods", 2));
                for (TreeSet<Integer> set : periods.values()) {
                    int adjacent = 0;
                    Integer previous = null;
                    for (Integer period : set) {
                        if (previous != null && period == previous + 1) adjacent++;
                        previous = period;
                    }
                    int expectedPairs = set.size() / desired;
                    if (adjacent < expectedPairs) penalty += (expectedPairs - adjacent) * 4;
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
}
