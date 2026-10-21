package com.warpweft.solver.model;

public record Entry(
    String id, String coursePlanId, String classId, String subjectId,
    String teacherId, String roomId, String slotId, String source, boolean locked
) {}
