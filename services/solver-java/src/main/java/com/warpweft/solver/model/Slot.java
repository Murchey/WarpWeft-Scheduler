package com.warpweft.solver.model;

public record Slot(String id, int day, int period, String label, String kind) {
    /** Compatibility constructor: slots without a kind are regular lessons. */
    public Slot(String id, int day, int period, String label) {
        this(id, day, period, label, "regular");
    }
}
