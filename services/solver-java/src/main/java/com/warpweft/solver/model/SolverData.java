package com.warpweft.solver.model;

import com.warpweft.solver.rules.Rule;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class SolverData {
    public final String protocolVersion;
    public final Map<String, Slot> slots = new LinkedHashMap<>();
    public final Map<String, Room> rooms = new LinkedHashMap<>();
    public final Map<String, ClassInfo> classes = new LinkedHashMap<>();
    public final Set<String> unavailable = new HashSet<>();
    public final List<Plan> plans = new ArrayList<>();
    public final List<Entry> locked = new ArrayList<>();
    /** Already-placed lessons from a checkpoint: occupy slots but stay movable. */
    public final List<Entry> seed = new ArrayList<>();
    public final List<Rule> rules = new ArrayList<>();
    public final List<ElectiveGroup> groups = new ArrayList<>();
    public final List<String> violations = new ArrayList<>();

    public SolverData(String protocolVersion) {
        this.protocolVersion = protocolVersion;
    }
}
