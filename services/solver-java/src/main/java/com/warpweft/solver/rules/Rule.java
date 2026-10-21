package com.warpweft.solver.rules;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.List;

public record Rule(
    String kind, String importance, String scopeType, String scopeId,
    String timeType, List<Integer> days, int from, int to, JsonNode params
) {
    public boolean applies(String teacherId, String subjectId, int day, int period) {
        if ("teacher".equals(scopeType) && !scopeId.equals(teacherId)) return false;
        if ("subject".equals(scopeType) && !scopeId.equals(subjectId)) return false;
        if ("weekday".equals(timeType) && !days.contains(day)) return false;
        if ("periodRange".equals(timeType) && (period < from || period > to)) return false;
        return true;
    }

    public boolean matchesPlan(String teacherId, String subjectId) {
        if ("teacher".equals(scopeType) && !scopeId.equals(teacherId)) return false;
        if ("subject".equals(scopeType) && !scopeId.equals(subjectId)) return false;
        return true;
    }

    public int number(String key, int fallback) {
        JsonNode value = params == null ? null : params.get(key);
        return value == null || value.isNull() ? fallback : value.asInt(fallback);
    }
}
