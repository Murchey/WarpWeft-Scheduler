package com.warpweft.solver.model;

import java.util.ArrayList;
import java.util.List;

/**
 * A group of classes that attend elective courses together. All blocks run in
 * the same slot; member classes are released (no regular lesson) in that slot.
 */
public record ElectiveGroup(
    String id, String name, String subjectId, int weeklyPeriods,
    List<String> classIds, List<ElectiveBlock> blocks
) {
    public ElectiveGroup {
        classIds = List.copyOf(classIds == null ? new ArrayList<>() : classIds);
        blocks = List.copyOf(blocks == null ? new ArrayList<>() : blocks);
    }
}
