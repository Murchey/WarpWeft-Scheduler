package com.warpweft.solver.model;

public record Entry(
    String id, String coursePlanId, String classId, String subjectId,
    String teacherId, String roomId, String slotId, String weeks,
    String groupId, String blockId, String source, boolean locked
) {
    /** Compatibility constructors for callers that predate week parity / electives. */
    public Entry(String id, String coursePlanId, String classId, String subjectId, String teacherId,
                 String roomId, String slotId, String weeks, String source, boolean locked) {
        this(id, coursePlanId, classId, subjectId, teacherId, roomId, slotId, weeks, null, null, source, locked);
    }

    public Entry(String id, String coursePlanId, String classId, String subjectId, String teacherId,
                 String roomId, String slotId, String source, boolean locked) {
        this(id, coursePlanId, classId, subjectId, teacherId, roomId, slotId, "all", null, null, source, locked);
    }
}
