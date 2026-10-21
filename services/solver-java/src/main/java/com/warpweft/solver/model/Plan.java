package com.warpweft.solver.model;

public record Plan(
    String id, String classId, String subjectId, String teacherId,
    int weeklyPeriods, String roomType, String fixedSlotId
) {}
