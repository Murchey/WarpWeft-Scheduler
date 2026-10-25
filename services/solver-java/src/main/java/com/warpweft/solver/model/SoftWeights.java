package com.warpweft.solver.model;

import java.util.Map;

/** Weights for the soft objectives. 0 means the objective is disabled. */
public record SoftWeights(
    int subjectDistribution,
    int teacherContinuous,
    int teacherGaps,
    int teacherWorkloadBalance,
    int classGaps,
    int subjectTimePreference
) {
    /** Backwards-compatible defaults: the four old objectives, class gaps off. */
    public static SoftWeights defaults() {
        return new SoftWeights(3, 2, 1, 2, 0, 2);
    }

    public SoftWeights(int subjectDistribution, int teacherContinuous, int teacherGaps,
                       int teacherWorkloadBalance, int classGaps) {
        this(subjectDistribution, teacherContinuous, teacherGaps, teacherWorkloadBalance, classGaps, 0);
    }

    /** Explicit key=weight map from the solver input. Missing keys are 0. */
    public static SoftWeights from(Map<String, Integer> values) {
        return new SoftWeights(
            clamp(values.get("SUBJECT_DISTRIBUTION")),
            clamp(values.get("TEACHER_CONTINUOUS")),
            clamp(values.get("TEACHER_GAPS")),
            clamp(values.get("TEACHER_WORKLOAD_BALANCE")),
            clamp(values.get("CLASS_GAPS")),
            clamp(values.get("SUBJECT_TIME_PREFERENCE"))
        );
    }

    public boolean anyEnabled() {
        return subjectDistribution > 0 || teacherContinuous > 0 || teacherGaps > 0
            || teacherWorkloadBalance > 0 || classGaps > 0 || subjectTimePreference > 0;
    }

    private static int clamp(Integer value) {
        if (value == null) return 0;
        return Math.max(0, Math.min(5, value));
    }
}
