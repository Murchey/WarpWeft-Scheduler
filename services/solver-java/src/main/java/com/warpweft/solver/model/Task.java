package com.warpweft.solver.model;

/** One lesson to place: occurrence {@code occurrence} of {@code plan}, optionally pinned to a slot. */
public record Task(Plan plan, int occurrence, String fixedSlotId) {
    public Task(Plan plan, int occurrence) {
        this(plan, occurrence, "");
    }

    public boolean isFixed() {
        return fixedSlotId != null && !fixedSlotId.isBlank();
    }
}
