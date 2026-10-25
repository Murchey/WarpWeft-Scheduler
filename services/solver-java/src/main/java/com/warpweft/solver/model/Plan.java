package com.warpweft.solver.model;

import java.util.List;

public record Plan(
    String id, String classId, String subjectId, String teacherId,
    int weeklyPeriods, String roomType, List<String> fixedSlotIds, String weeks, String kind,
    int consecutive, String pairId
) {
    public Plan {
        fixedSlotIds = fixedSlotIds == null ? List.of() : List.copyOf(fixedSlotIds);
        weeks = weeks == null || weeks.isBlank() ? "all" : weeks;
        kind = kind == null || kind.isBlank() ? "regular" : kind;
        pairId = pairId == null ? "" : pairId;
    }

    /** Number of occurrences pinned to a fixed slot. */
    public int fixedCount() {
        return Math.min(Math.max(0, weeklyPeriods), fixedSlotIds.size());
    }

    public boolean hasFixedSlots() {
        return !fixedSlotIds.isEmpty();
    }

    public boolean paired() {
        return pairId != null && !pairId.isBlank();
    }

    /** Compatibility constructors for callers that predate per-occurrence fixed slots. */
    public Plan(String id, String classId, String subjectId, String teacherId,
                int weeklyPeriods, String roomType, String fixedSlotId, String weeks, String kind) {
        this(id, classId, subjectId, teacherId, weeklyPeriods, roomType,
            fixedSlotId == null || fixedSlotId.isBlank() ? List.of() : List.of(fixedSlotId),
            weeks, kind, 0, "");
    }

    public Plan(String id, String classId, String subjectId, String teacherId,
                int weeklyPeriods, String roomType, String fixedSlotId, String weeks) {
        this(id, classId, subjectId, teacherId, weeklyPeriods, roomType, fixedSlotId, weeks, "regular");
    }

    public Plan(String id, String classId, String subjectId, String teacherId,
                int weeklyPeriods, String roomType, String fixedSlotId) {
        this(id, classId, subjectId, teacherId, weeklyPeriods, roomType, fixedSlotId, "all", "regular");
    }
}
