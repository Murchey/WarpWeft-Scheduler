package com.warpweft.solver.model;

public record Plan(
    String id, String classId, String subjectId, String teacherId,
    int weeklyPeriods, String roomType, String fixedSlotId, String weeks, String kind
) {
    /** Compatibility constructors for callers that predate parity / slot kinds. */
    public Plan(String id, String classId, String subjectId, String teacherId,
                int weeklyPeriods, String roomType, String fixedSlotId, String weeks) {
        this(id, classId, subjectId, teacherId, weeklyPeriods, roomType, fixedSlotId, weeks, "regular");
    }

    public Plan(String id, String classId, String subjectId, String teacherId,
                int weeklyPeriods, String roomType, String fixedSlotId) {
        this(id, classId, subjectId, teacherId, weeklyPeriods, roomType, fixedSlotId, "all", "regular");
    }
}
