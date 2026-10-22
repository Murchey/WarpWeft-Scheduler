package com.warpweft.fullsolver;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/**
 * Heuristic conflict analysis for WarpWeft scheduling rules.
 *
 * <p>The MVP solver is a heuristic search: it reports a feasible schedule when it finds one, but a
 * failed or timed-out run does <em>not</em> prove that no schedule exists. This tool therefore treats
 * the solver as a <strong>heuristic oracle</strong>, not a decision procedure:
 * <ul>
 *   <li>feasible — the solver found a schedule for this rule subset;</li>
 *   <li>infeasible-reported — the solver finished without a schedule or hit its time limit
 *       (reported as a conflict, but not a mathematical proof);</li>
 *   <li>unknown — the solver timed out, failed, or returned no conclusive status. Any analysis that
 *       depends on such a subset stops with {@code status=unknown} instead of claiming a proof.</li>
 * </ul>
 *
 * <p>Modes:
 * <ul>
 *   <li>{@code mus} (default) — deletion-based irreducible conflict set relative to the oracle's
 *       reported results.</li>
 *   <li>{@code minimum} — smallest-cardinality conflict set(s) by increasing subset size, bounded by
 *       {@code --max-cardinality}.</li>
 * </ul>
 */
public final class Main {
    private static final ObjectMapper JSON = new ObjectMapper();

    public static void main(String[] args) {
        Map<String, String> options = parseArgs(args);
        if (options.containsKey("--help") || options.containsKey("-h") || !options.containsKey("--input")) {
            usage();
            return;
        }

        Path input = Path.of(options.get("--input"));
        Path solver = Path.of(options.getOrDefault("--solver", defaultSolverJar()));
        String mode = options.getOrDefault("--mode", "mus").toLowerCase(Locale.ROOT);
        int maxCardinality = Integer.parseInt(options.getOrDefault("--max-cardinality", "4"));
        int timeLimit = Integer.parseInt(options.getOrDefault("--time-limit", "10"));
        int processTimeout = Integer.parseInt(options.getOrDefault("--process-timeout", "120"));
        boolean includeExplanation = !options.containsKey("--no-explanation");
        Path out = options.containsKey("--out") ? Path.of(options.get("--out")) : null;

        long started = System.nanoTime();
        try {
            ObjectNode root = (ObjectNode) JSON.readTree(Files.readString(input));
            List<ObjectNode> candidates = mustRules(root);
            Oracle oracle = new Oracle(solver, root, timeLimit, processTimeout);

            ObjectNode report = JSON.createObjectNode();
            report.put("protocolVersion", "1.0");
            report.put("algorithm", "heuristic-oracle-conflict-analysis");
            report.put("proof", false);
            report.put("mode", mode);
            report.put("solverJar", solver.toAbsolutePath().normalize().toString());
            report.put("candidateRuleCount", candidates.size());

            ObjectNode base = oracle.run(List.of());
            Oracle.Outcome baseOutcome = Oracle.outcomeOf(base);
            if (baseOutcome == Oracle.Outcome.UNKNOWN) {
                report.put("status", "unknown");
                report.put("solverStatus", base.path("status").asText(""));
                report.put("note", "基线判定未完成（" + base.path("status").asText("") + "），无法判断硬约束是否可行。");
            } else if (baseOutcome == Oracle.Outcome.INFEASIBLE) {
                report.put("status", "base-infeasible");
                report.put("note", "求解器未找到满足硬约束的解；这不能单独证明数学无解，请先处理硬约束/数据冲突。");
                if (includeExplanation) attachExplanation(report, base);
            } else {
                ObjectNode all = oracle.run(candidates);
                Oracle.Outcome allOutcome = Oracle.outcomeOf(all);
                if (allOutcome == Oracle.Outcome.UNKNOWN) {
                    report.put("status", "unknown");
                    report.put("solverStatus", all.path("status").asText(""));
                    report.put("note", "全部规则下的判定未完成，不能据此给出冲突集。");
                } else if (allOutcome == Oracle.Outcome.FEASIBLE) {
                    report.put("status", "no-conflict");
                    report.put("note", "全部启用规则下仍有可行解。");
                } else {
                    report.put("status", "conflict");
                    List<List<ObjectNode>> conflicts = "minimum".equals(mode)
                            ? oracle.minimumConflicts(candidates, maxCardinality)
                            : List.of(oracle.minimalUnsatisfiableSubset(candidates));
                    ArrayNode sets = report.putArray("minimalConflictSets");
                    for (List<ObjectNode> conflict : conflicts) {
                        ObjectNode item = sets.addObject();
                        ArrayNode ids = item.putArray("ruleIds");
                        ArrayNode kinds = item.putArray("ruleKinds");
                        for (ObjectNode rule : conflict) {
                            ids.add(rule.path("id").asText(rule.path("kind").asText("rule")));
                            kinds.add(rule.path("kind").asText(""));
                        }
                        item.put("size", conflict.size());
                        if (includeExplanation) {
                            ObjectNode detail = oracle.run(conflict);
                            attachExplanation(item, detail);
                        }
                    }
                    report.put(
                            "note",
                            "基于启发式求解器的冲突分析：求解器在这些子集上未找到可行解，不构成数学证明；提高 --time-limit 或复核数据后再采信。"
                                    + ("minimum".equals(mode)
                                            ? " 按基数递增枚举，返回最小势冲突集（同势可能多组）。"
                                            : " 删除法得到的不可约冲突集（相对启发式判定）。"));
                }
            }
            report.put("oracleCalls", oracle.calls);
            report.put("elapsedMs", (System.nanoTime() - started) / 1_000_000);
            String json = JSON.writerWithDefaultPrettyPrinter().writeValueAsString(report);
            if (out != null) Files.writeString(out, json, StandardCharsets.UTF_8);
            System.out.println(json);
        } catch (Indeterminate unknown) {
            ObjectNode report = JSON.createObjectNode();
            report.put("protocolVersion", "1.0");
            report.put("algorithm", "heuristic-oracle-conflict-analysis");
            report.put("proof", false);
            report.put("status", "unknown");
            report.put("solverStatus", unknown.solverStatus);
            ArrayNode ids = report.putArray("ruleIds");
            for (ObjectNode rule : unknown.rules) {
                ids.add(rule.path("id").asText(rule.path("kind").asText("rule")));
            }
            report.put("message", "求解器在判定该规则子集时未完成（" + unknown.solverStatus + "），无法得出可信冲突集。");
            report.put("oracleCalls", unknown.oracleCalls);
            report.put("elapsedMs", (System.nanoTime() - started) / 1_000_000);
            System.out.println(report.toPrettyString());
        } catch (Exception error) {
            ObjectNode report = JSON.createObjectNode();
            report.put("protocolVersion", "1.0");
            report.put("algorithm", "heuristic-oracle-conflict-analysis");
            report.put("proof", false);
            report.put("status", "error");
            report.put("message", String.valueOf(error.getMessage()));
            report.put("elapsedMs", (System.nanoTime() - started) / 1_000_000);
            System.out.println(report.toPrettyString());
            System.exit(2);
        }
    }

    private static void attachExplanation(ObjectNode target, ObjectNode solverOutput) {
        target.put("solverStatus", solverOutput.path("status").asText(""));
        String explanation = solverOutput.path("explanation").asText("");
        if (!explanation.isBlank()) target.put("solverExplanation", explanation);
        JsonNode violations = solverOutput.path("hardConstraintViolations");
        if (violations.isArray() && violations.size() > 0) {
            ArrayNode copy = target.putArray("hardConstraintViolations");
            violations.forEach(copy::add);
        }
    }

    private static List<ObjectNode> mustRules(ObjectNode root) {
        List<ObjectNode> rules = new ArrayList<>();
        for (JsonNode node : root.withArray("rules")) {
            if (!node.isObject()) continue;
            ObjectNode rule = (ObjectNode) node;
            if (rule.has("enabled") && !rule.path("enabled").asBoolean(true)) continue;
            String importance = rule.path("importance").asText("prefer");
            if (!"must".equalsIgnoreCase(importance)) continue;
            rules.add(rule);
        }
        return rules;
    }

    private static String defaultSolverJar() {
        List<Path> candidates = List.of(
                Path.of("resources", "solver", "warpweft-solver.jar"),
                Path.of("..", "..", "resources", "solver", "warpweft-solver.jar"),
                Path.of("..", "WarpWeft-Scheduler", "resources", "solver", "warpweft-solver.jar"));
        for (Path candidate : candidates) {
            if (Files.exists(candidate)) return candidate.toString();
        }
        return candidates.get(0).toString();
    }

    private static void usage() {
        System.out.println("""
                WarpWeft 规则冲突分析（启发式判定，非数学证明）

                用法：
                  java -jar warpweft-fullsolver.jar --input <solver-input.json> [选项]

                选项：
                  --solver <jar>          启发式求解器 jar（默认在仓库根目录查找 resources/solver/warpweft-solver.jar）
                  --mode mus|minimum      mus = 不可约冲突集（默认）；minimum = 最小势冲突集
                  --max-cardinality <n>   minimum 模式搜索的最大冲突规模（默认 4）
                  --time-limit <秒>       每次可行性判定的求解时限（默认 10）
                  --process-timeout <秒>  单次 JVM 调用超时（默认 120）
                  --out <file>            同时把报告写入文件
                  --no-explanation        不附带求解器说明，减少调用次数
                """);
    }

    private static Map<String, String> parseArgs(String[] args) {
        Map<String, String> options = new LinkedHashMap<>();
        for (int i = 0; i < args.length; i++) {
            String arg = args[i];
            if (!arg.startsWith("--")) continue;
            if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
                options.put(arg, args[++i]);
            } else {
                options.put(arg, "true");
            }
        }
        return options;
    }

    /** Raised when the heuristic oracle cannot decide a subset (timeout/failed run). */
    static final class Indeterminate extends RuntimeException {
        final List<ObjectNode> rules;
        final String solverStatus;
        final int oracleCalls;

        Indeterminate(List<ObjectNode> rules, String solverStatus, int oracleCalls) {
            super("solver did not complete: " + solverStatus);
            this.rules = rules;
            this.solverStatus = solverStatus;
            this.oracleCalls = oracleCalls;
        }
    }

    /** Feasibility oracle: runs the MVP solver with a given rule subset. */
    static final class Oracle {
        enum Outcome { FEASIBLE, INFEASIBLE, UNKNOWN }

        private final Path solverJar;
        private final ObjectNode base;
        private final int timeLimit;
        private final int processTimeout;
        private final Map<String, ObjectNode> cache = new LinkedHashMap<>();
        int calls;

        Oracle(Path solverJar, ObjectNode base, int timeLimit, int processTimeout) {
            this.solverJar = solverJar;
            this.base = base;
            this.timeLimit = Math.max(1, timeLimit);
            this.processTimeout = Math.max(10, processTimeout);
        }

        static Outcome outcomeOf(ObjectNode result) {
            if (result.path("hasFeasibleSolution").asBoolean(false)) return Outcome.FEASIBLE;
            String status = result.path("status").asText("");
            // The MVP solver reports COMPLETED with a schedule, or FAILED when it
            // could not finish (time limit / hard violations). FAILED is the
            // oracle's reported-infeasible answer, but it is not a proof.
            if ("COMPLETED".equalsIgnoreCase(status) || "FAILED".equalsIgnoreCase(status)) {
                return Outcome.INFEASIBLE;
            }
            return Outcome.UNKNOWN;
        }

        private Outcome require(List<ObjectNode> rules) {
            ObjectNode result = run(rules);
            Outcome outcome = outcomeOf(result);
            if (outcome == Outcome.UNKNOWN) {
                throw new Indeterminate(rules, result.path("status").asText(""), calls);
            }
            return outcome;
        }

        ObjectNode run(List<ObjectNode> rules) {
            String key = keyOf(rules);
            ObjectNode cached = cache.get(key);
            if (cached != null) return cached;
            ObjectNode copy = base.deepCopy();
            ArrayNode array = copy.putArray("rules");
            for (ObjectNode rule : rules) array.add(rule.deepCopy());
            copy.put("timeLimitSeconds", timeLimit);
            ObjectNode result = invoke(copy);
            cache.put(key, result);
            calls++;
            return result;
        }

        List<ObjectNode> minimalUnsatisfiableSubset(List<ObjectNode> rules) {
            List<ObjectNode> current = new ArrayList<>(rules);
            int index = 0;
            while (index < current.size()) {
                List<ObjectNode> candidate = new ArrayList<>(current);
                candidate.remove(index);
                if (require(candidate) == Outcome.INFEASIBLE) {
                    current = candidate;
                } else {
                    index++;
                }
            }
            return current;
        }

        List<List<ObjectNode>> minimumConflicts(List<ObjectNode> rules, int maxCardinality) {
            int limit = Math.min(Math.max(1, maxCardinality), rules.size());
            for (int size = 1; size <= limit; size++) {
                List<List<ObjectNode>> found = new ArrayList<>();
                for (List<ObjectNode> combination : combinations(rules, size)) {
                    if (require(combination) == Outcome.INFEASIBLE) {
                        found.add(combination);
                    }
                }
                if (!found.isEmpty()) return found;
            }
            return List.of();
        }

        private ObjectNode invoke(ObjectNode payload) {
            try {
                if (!Files.exists(solverJar)) {
                    throw new IllegalStateException("找不到求解器 jar：" + solverJar.toAbsolutePath());
                }
                ProcessBuilder builder = new ProcessBuilder(javaBinary(), "-jar", solverJar.toAbsolutePath().toString());
                builder.redirectError(ProcessBuilder.Redirect.DISCARD);
                Process process = builder.start();
                try (OutputStream stdin = process.getOutputStream()) {
                    stdin.write(JSON.writeValueAsString(payload).getBytes(StandardCharsets.UTF_8));
                }
                String stdout = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
                if (!process.waitFor(processTimeout, TimeUnit.SECONDS)) {
                    process.destroyForcibly();
                    throw new IllegalStateException("求解器超过 " + processTimeout + " 秒未返回");
                }
                if (stdout.isBlank()) throw new IllegalStateException("求解器没有输出");
                JsonNode parsed = JSON.readTree(stdout);
                if (!(parsed instanceof ObjectNode object)) {
                    throw new IllegalStateException("求解器输出不是 JSON 对象");
                }
                return object;
            } catch (IOException error) {
                throw new IllegalStateException("调用求解器失败：" + error.getMessage(), error);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("调用被中断", error);
            }
        }

        private static String keyOf(List<ObjectNode> rules) {
            Set<String> ids = new LinkedHashSet<>();
            for (ObjectNode rule : rules) {
                ids.add(rule.path("id").asText(rule.path("kind").asText("rule")));
            }
            List<String> sorted = new ArrayList<>(ids);
            sorted.sort(String::compareTo);
            return String.join("|", sorted);
        }

        private static List<List<ObjectNode>> combinations(List<ObjectNode> rules, int size) {
            List<List<ObjectNode>> result = new ArrayList<>();
            combine(rules, size, 0, new ArrayList<>(), result);
            return result;
        }

        private static void combine(
                List<ObjectNode> rules,
                int size,
                int start,
                List<ObjectNode> current,
                List<List<ObjectNode>> result) {
            if (current.size() == size) {
                result.add(new ArrayList<>(current));
                return;
            }
            for (int i = start; i < rules.size(); i++) {
                current.add(rules.get(i));
                combine(rules, size, i + 1, current, result);
                current.remove(current.size() - 1);
            }
        }

        private static String javaBinary() {
            String home = System.getenv("JAVA_HOME");
            if (home == null || home.isBlank()) return "java";
            Path binary = Path.of(home, "bin", isWindows() ? "java.exe" : "java");
            return Files.exists(binary) ? binary.toString() : "java";
        }

        private static boolean isWindows() {
            return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
        }
    }
}



