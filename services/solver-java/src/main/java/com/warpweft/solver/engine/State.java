package com.warpweft.solver.engine;

import com.warpweft.solver.model.ClassInfo;
import com.warpweft.solver.model.Entry;
import com.warpweft.solver.model.Plan;
import com.warpweft.solver.model.Room;
import com.warpweft.solver.model.Slot;
import com.warpweft.solver.rules.Rule;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

public final class State {
    public final Map<String, Slot> slots = new LinkedHashMap<>();
    public final Map<String, Room> rooms = new LinkedHashMap<>();
    public final Map<String, ClassInfo> classes = new LinkedHashMap<>();
    public final Set<String> unavailable = new HashSet<>();
    /** slot occupancy key → week mask bit set (all = odd|even). */
    public final Map<String, Integer> classSlot = new HashMap<>();
    public final Map<String, Integer> teacherSlot = new HashMap<>();
    public final Map<String, Integer> roomSlot = new HashMap<>();
    /** Fixed-time reservations: a pending fixed lesson keeps its slot away from free lessons. */
    private final Map<String, Integer> reservedClassSlot = new HashMap<>();
    private final Map<String, Integer> reservedTeacherSlot = new HashMap<>();
    /** planId|slotId → reserved week mask, kept so a fixed lesson can consume its own reservation. */
    private final Map<String, Integer> reservationByPlanSlot = new HashMap<>();
    /** subjectId → morning/afternoon preference. */
    public final Map<String, String> subjectPreference = new HashMap<>();
    final Map<String, Integer> teacherLoad = new HashMap<>();
    // Incremental counters, bucketed by week parity: key|…|mask. A candidate
    // whose week mask overlaps several buckets sums the matching buckets only.
    final Map<String, Integer> classDayCount = new HashMap<>();
    final Map<String, Integer> teacherDayCount = new HashMap<>();
    final Map<String, Integer> classSubjectDayCount = new HashMap<>();
    final Map<String, TreeSet<Integer>> teacherDayPeriods = new HashMap<>();
    public final List<Entry> entries = new ArrayList<>();
    public final List<Rule> rules = new ArrayList<>();
    final Set<String> pairedPlans = new HashSet<>();
    /** groupId → member class ids; group lessons release every member class. */
    final Map<String, List<String>> groupClasses = new HashMap<>();

    /** all weeks occupy both parities; odd/even occupy one bit each. */
    public static int weekMask(String weeks) {
        if ("odd".equals(weeks)) return 1;
        if ("even".equals(weeks)) return 2;
        return 3;
    }

    /** Buckets that must be summed to answer "how many lessons in this week". */
    static int[] buckets(int mask) {
        if (mask == 1) return new int[] { 3, 1 };
        if (mask == 2) return new int[] { 3, 2 };
        return new int[] { 3, 1, 2 };
    }

    State(Map<String, Slot> sourceSlots, Map<String, Room> sourceRooms, Map<String, ClassInfo> sourceClasses,
          Set<String> sourceUnavailable, List<Rule> sourceRules, Map<String, List<String>> sourceGroups,
          Map<String, String> sourceSubjectPreference) {
        slots.putAll(sourceSlots);
        rooms.putAll(sourceRooms);
        classes.putAll(sourceClasses);
        unavailable.addAll(sourceUnavailable);
        rules.addAll(sourceRules);
        groupClasses.putAll(sourceGroups);
        subjectPreference.putAll(sourceSubjectPreference);
    }

    State(Map<String, Slot> sourceSlots, Map<String, Room> sourceRooms, Map<String, ClassInfo> sourceClasses,
          Set<String> sourceUnavailable, List<Rule> sourceRules, Map<String, List<String>> sourceGroups) {
        this(sourceSlots, sourceRooms, sourceClasses, sourceUnavailable, sourceRules, sourceGroups, Map.of());
    }

    /** Deep copy used by the ruin-and-recreate loop. */
    State copy() {
        State copy = new State(slots, rooms, classes, unavailable, rules, groupClasses, subjectPreference);
        copy.pairedPlans.addAll(pairedPlans);
        copy.reservedClassSlot.putAll(reservedClassSlot);
        copy.reservedTeacherSlot.putAll(reservedTeacherSlot);
        copy.reservationByPlanSlot.putAll(reservationByPlanSlot);
        for (Entry entry : entries) copy.add(entry);
        return copy;
    }

    /**
     * Keep a slot for a fixed lesson that is not placed yet. Free lessons must
     * not take it; the fixed lesson clears the reservation when it is placed.
     */
    void reserveFixed(Plan plan, String slotId) {
        int mask = weekMask(plan.weeks());
        String key = plan.id() + "|" + slotId;
        Integer current = reservationByPlanSlot.get(key);
        int next = current == null ? mask : current | mask;
        int added = current == null ? next : next & ~current;
        reservationByPlanSlot.put(key, next);
        addMask(reservedClassSlot, plan.classId() + "|" + slotId, added);
        addMask(reservedTeacherSlot, plan.teacherId() + "|" + slotId, added);
    }

    /** Drop a reservation, e.g. before placing the fixed lesson itself. */
    void releaseReservation(Plan plan, String slotId) {
        String key = plan.id() + "|" + slotId;
        Integer mask = reservationByPlanSlot.remove(key);
        if (mask == null) return;
        removeMask(reservedClassSlot, plan.classId() + "|" + slotId, mask);
        removeMask(reservedTeacherSlot, plan.teacherId() + "|" + slotId, mask);
    }

    /** True when a pending fixed lesson owns this class slot for overlapping weeks. */
    public boolean classSlotReserved(String classId, String slotId, int mask) {
        Integer classMask = reservedClassSlot.get(classId + "|" + slotId);
        return classMask != null && (classMask & mask) != 0;
    }

    /** True when a pending fixed lesson owns this teacher slot for overlapping weeks. */
    public boolean teacherSlotReserved(String teacherId, String slotId, int mask) {
        Integer teacherMask = reservedTeacherSlot.get(teacherId + "|" + slotId);
        return teacherMask != null && (teacherMask & mask) != 0;
    }

    /** True when a pending fixed lesson owns this class/teacher slot for overlapping weeks. */
    public boolean reservationBlocks(String classId, String teacherId, String slotId, int mask) {
        return classSlotReserved(classId, slotId, mask) || teacherSlotReserved(teacherId, slotId, mask);
    }

    /** Last period that still counts as morning on this weekday. */
    public int morningCutoff(int day) {
        int min = Integer.MAX_VALUE;
        int max = 0;
        for (Slot slot : slots.values()) {
            if (slot.day() != day) continue;
            min = Math.min(min, slot.period());
            max = Math.max(max, slot.period());
        }
        if (max == 0) return 0;
        return (min + max) / 2;
    }

    public String subjectPreferenceOf(String subjectId) {
        return subjectPreference.getOrDefault(subjectId, "");
    }

    private static void addMask(Map<String, Integer> masks, String key, int mask) {
        if (mask == 0) return;
        masks.merge(key, mask, (current, added) -> current | added);
    }

    private static void removeMask(Map<String, Integer> masks, String key, int mask) {
        Integer current = masks.get(key);
        if (current == null) return;
        int next = current & ~mask;
        if (next == 0) masks.remove(key);
        else masks.put(key, next);
    }

    public TreeSet<Integer> teacherPeriods(String teacherId, int day, int mask) {
        TreeSet<Integer> periods = new TreeSet<>();
        for (int bucket : buckets(mask)) {
            TreeSet<Integer> stored = teacherDayPeriods.get(teacherId + "|" + day + "|" + bucket);
            if (stored != null) periods.addAll(stored);
        }
        return periods;
    }

    public boolean teacherPeriodTaken(String teacherId, int day, int period, int mask) {
        for (int bucket : buckets(mask)) {
            TreeSet<Integer> stored = teacherDayPeriods.get(teacherId + "|" + day + "|" + bucket);
            if (stored != null && stored.contains(period)) return true;
        }
        return false;
    }

    void add(Entry entry) {
        Slot slot = slots.get(entry.slotId());
        int mask = weekMask(entry.weeks());
        entries.add(entry);
        if (entry.groupId() != null && groupClasses.containsKey(entry.groupId())) {
            for (String classId : groupClasses.get(entry.groupId())) {
                occupy(classSlot, classId + "|" + entry.slotId(), mask);
            }
        } else {
            occupy(classSlot, entry.classId() + "|" + entry.slotId(), mask);
        }
        occupy(teacherSlot, entry.teacherId() + "|" + entry.slotId(), mask);
        occupy(roomSlot, entry.roomId() + "|" + entry.slotId(), mask);
        teacherLoad.merge(entry.teacherId(), 1, Integer::sum);
        if (slot != null) {
            merge(classDayCount, entry.classId() + "|" + slot.day() + "|" + mask);
            merge(teacherDayCount, entry.teacherId() + "|" + slot.day() + "|" + mask);
            merge(classSubjectDayCount, entry.classId() + "|" + slot.day() + "|" + entry.subjectId() + "|" + mask);
            teacherDayPeriods.computeIfAbsent(entry.teacherId() + "|" + slot.day() + "|" + mask, key -> new TreeSet<>()).add(slot.period());
        }
    }

    void remove(Entry entry) {
        Slot slot = slots.get(entry.slotId());
        int mask = weekMask(entry.weeks());
        entries.remove(entry);
        if (entry.groupId() != null && groupClasses.containsKey(entry.groupId())) {
            for (String classId : groupClasses.get(entry.groupId())) {
                release(classSlot, classId + "|" + entry.slotId(), mask);
            }
        } else {
            release(classSlot, entry.classId() + "|" + entry.slotId(), mask);
        }
        release(teacherSlot, entry.teacherId() + "|" + entry.slotId(), mask);
        release(roomSlot, entry.roomId() + "|" + entry.slotId(), mask);
        teacherLoad.computeIfPresent(entry.teacherId(), (key, value) -> value <= 1 ? null : value - 1);
        if (slot == null) return;
        decrement(classDayCount, entry.classId() + "|" + slot.day() + "|" + mask);
        decrement(teacherDayCount, entry.teacherId() + "|" + slot.day() + "|" + mask);
        decrement(classSubjectDayCount, entry.classId() + "|" + slot.day() + "|" + entry.subjectId() + "|" + mask);
        TreeSet<Integer> periods = teacherDayPeriods.get(entry.teacherId() + "|" + slot.day() + "|" + mask);
        if (periods != null) {
            periods.remove(slot.period());
            if (periods.isEmpty()) teacherDayPeriods.remove(entry.teacherId() + "|" + slot.day() + "|" + mask);
        }
    }

    private static void occupy(Map<String, Integer> occupancy, String key, int mask) {
        occupancy.merge(key, mask, (current, added) -> current | added);
    }

    private static void release(Map<String, Integer> occupancy, String key, int mask) {
        Integer current = occupancy.get(key);
        if (current == null) return;
        int next = current & ~mask;
        if (next == 0) occupancy.remove(key);
        else occupancy.put(key, next);
    }

    static boolean free(Map<String, Integer> occupancy, String key, int mask) {
        Integer current = occupancy.get(key);
        return current == null || (current & mask) == 0;
    }

    public boolean classSlotFree(String classId, String slotId, int mask) {
        return free(classSlot, classId + "|" + slotId, mask);
    }

    public boolean teacherSlotFree(String teacherId, String slotId, int mask) {
        return free(teacherSlot, teacherId + "|" + slotId, mask);
    }

    public boolean roomSlotFree(String roomId, String slotId, int mask) {
        return free(roomSlot, roomId + "|" + slotId, mask);
    }

    private static void merge(Map<String, Integer> counts, String key) {
        counts.merge(key, 1, Integer::sum);
    }

    private static void decrement(Map<String, Integer> counts, String key) {
        Integer value = counts.get(key);
        if (value == null) return;
        if (value <= 1) counts.remove(key);
        else counts.put(key, value - 1);
    }

    private static int sum(Map<String, Integer> counts, String keyPrefix, int mask) {
        int total = 0;
        for (int bucket : buckets(mask)) total += counts.getOrDefault(keyPrefix + "|" + bucket, 0);
        return total;
    }

    public int classDayLoad(String classId, int day, int mask) {
        return sum(classDayCount, classId + "|" + day, mask);
    }

    public int teacherDayLoad(String teacherId, int day, int mask) {
        return sum(teacherDayCount, teacherId + "|" + day, mask);
    }

    public int teacherWeeklyLoad(String teacherId) {
        return teacherLoad.getOrDefault(teacherId, 0);
    }

    public int subjectDayCount(String classId, int day, String subjectId, int mask) {
        return sum(classSubjectDayCount, classId + "|" + day + "|" + subjectId, mask);
    }

    /** Immutable-enough snapshot for repair rollback. */
    static final class Snapshot {
        private final List<Entry> entries;
        private final Map<String, Integer> classSlot;
        private final Map<String, Integer> teacherSlot;
        private final Map<String, Integer> roomSlot;
        private final Map<String, Integer> teacherLoad;
        private final Map<String, Integer> classDayCount;
        private final Map<String, Integer> teacherDayCount;
        private final Map<String, Integer> classSubjectDayCount;
        private final Map<String, TreeSet<Integer>> teacherDayPeriods;
        private final Set<String> pairedPlans;
        private final Map<String, Integer> reservedClassSlot;
        private final Map<String, Integer> reservedTeacherSlot;
        private final Map<String, Integer> reservationByPlanSlot;

        private Snapshot(State state) {
            entries = new ArrayList<>(state.entries);
            classSlot = new HashMap<>(state.classSlot);
            teacherSlot = new HashMap<>(state.teacherSlot);
            roomSlot = new HashMap<>(state.roomSlot);
            teacherLoad = new HashMap<>(state.teacherLoad);
            classDayCount = new HashMap<>(state.classDayCount);
            teacherDayCount = new HashMap<>(state.teacherDayCount);
            classSubjectDayCount = new HashMap<>(state.classSubjectDayCount);
            teacherDayPeriods = new HashMap<>();
            for (Map.Entry<String, TreeSet<Integer>> item : state.teacherDayPeriods.entrySet()) {
                teacherDayPeriods.put(item.getKey(), new TreeSet<>(item.getValue()));
            }
            pairedPlans = new HashSet<>(state.pairedPlans);
            reservedClassSlot = new HashMap<>(state.reservedClassSlot);
            reservedTeacherSlot = new HashMap<>(state.reservedTeacherSlot);
            reservationByPlanSlot = new HashMap<>(state.reservationByPlanSlot);
        }
    }

    Snapshot snapshot() {
        return new Snapshot(this);
    }

    void restore(Snapshot snapshot) {
        entries.clear();
        entries.addAll(snapshot.entries);
        replace(classSlot, snapshot.classSlot);
        replace(teacherSlot, snapshot.teacherSlot);
        replace(roomSlot, snapshot.roomSlot);
        replace(teacherLoad, snapshot.teacherLoad);
        replace(classDayCount, snapshot.classDayCount);
        replace(teacherDayCount, snapshot.teacherDayCount);
        replace(classSubjectDayCount, snapshot.classSubjectDayCount);
        teacherDayPeriods.clear();
        for (Map.Entry<String, TreeSet<Integer>> item : snapshot.teacherDayPeriods.entrySet()) {
            teacherDayPeriods.put(item.getKey(), new TreeSet<>(item.getValue()));
        }
        replace(pairedPlans, snapshot.pairedPlans);
        replace(reservedClassSlot, snapshot.reservedClassSlot);
        replace(reservedTeacherSlot, snapshot.reservedTeacherSlot);
        replace(reservationByPlanSlot, snapshot.reservationByPlanSlot);
    }

    private static <T> void replace(Set<T> target, Set<T> source) {
        target.clear();
        target.addAll(source);
    }

    private static <K, V> void replace(Map<K, V> target, Map<K, V> source) {
        target.clear();
        target.putAll(source);
    }
}

