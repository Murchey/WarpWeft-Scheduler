package com.warpweft.solver.engine;

import com.warpweft.solver.model.ClassInfo;
import com.warpweft.solver.model.Entry;
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
    public final Set<String> classSlot = new HashSet<>();
    public final Set<String> teacherSlot = new HashSet<>();
    public final Set<String> roomSlot = new HashSet<>();
    final Map<String, Integer> teacherLoad = new HashMap<>();
    public final List<Entry> entries = new ArrayList<>();
    public final List<Rule> rules = new ArrayList<>();
    final Set<String> pairedPlans = new HashSet<>();

    State(Map<String, Slot> sourceSlots, Map<String, Room> sourceRooms, Map<String, ClassInfo> sourceClasses, Set<String> sourceUnavailable, List<Rule> sourceRules) {
        slots.putAll(sourceSlots);
        rooms.putAll(sourceRooms);
        classes.putAll(sourceClasses);
        unavailable.addAll(sourceUnavailable);
        rules.addAll(sourceRules);
    }

    public TreeSet<Integer> teacherPeriods(String teacherId, int day) {
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

    public int teacherDayLoad(String teacherId, int day) {
        return (int) entries.stream().filter(e -> e.teacherId().equals(teacherId))
            .filter(e -> slots.get(e.slotId()).day() == day).count();
    }

    public int subjectDayCount(String classId, int day, String subjectId) {
        return (int) entries.stream().filter(e -> e.classId().equals(classId) && e.subjectId().equals(subjectId))
            .filter(e -> slots.get(e.slotId()).day() == day).count();
    }
}
