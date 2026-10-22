# WarpWeft 规则冲突分析（server/fullsolver）

> 定位：**命令行冲突分析模块**，不是 HTTP 服务端，也不参与排课运行路径。  
> 依赖：JDK 21、`resources/solver/warpweft-solver.jar`（启发式求解器）  
> 迁移：2026-10-22 从独立项目 `WarpWeft-FullSolver` 并入主仓库；原目录保留作回退。

## 它做什么

给定一份 solver input JSON，分析 `importance: must` 的规则中，哪些子集会让启发式求解器找不到可行解：

- `mus`（默认）：删除法得到的不可约冲突集；
- `minimum`：按规则条数递增枚举的最小势冲突集（受 `--max-cardinality` 限制）。

它通过反复调用主项目的启发式求解器来判断规则子集，自身不做排课搜索。

## 关键边界：这是启发式判定，不是数学证明

主求解器是启发式搜索。它对一个规则子集返回：

| 求解器结果 | 本工具的判定 | 含义 |
| --- | --- | --- |
| `hasFeasibleSolution=true` | feasible | 找到可行课表 |
| `status=COMPLETED` 且无可行解 | infeasible-reported | 词法上“完成但没排出来” |
| `status=FAILED`（时限/硬约束） | infeasible-reported | 启发式未找到，**不能证明无解** |
| 其它/空状态（如 TIMEOUT） | unknown | 判定未完成，停止分析 |

因此报告固定带 `"proof": false`，`status` 可能是：

- `no-conflict`：全部规则下仍有可行解；
- `conflict`：求解器在这些子集上未找到可行解（**近似冲突集**）；
- `base-infeasible`：基线（无自定义规则）就未找到解；
- `unknown`：基线或某个子集判定未完成，不给冲突集；
- `error`：进程/输入错误（退出码 2）。

提高 `--time-limit` 或复核数据后再采信 `conflict`。若未来接入可证明的求解器，可替换 oracle 并把 `proof` 改为 true。

## 构建与验证（从仓库根目录）

```powershell
npm run build:fullsolver     # 输出 server/fullsolver/dist/warpweft-fullsolver.jar
npm run verify:fullsolver    # 生成 fixtures 并跑 可行 / MUS / 最小势 三个场景
```

`build.ps1` 优先复用 `services/solver-java/lib` 里的 Jackson 依赖；`verify.ps1` 使用仓库根目录的 `database/seeds/demo.json` 与 `resources/solver/warpweft-solver.jar`。

## 用法

```powershell
java -jar server/fullsolver/dist/warpweft-fullsolver.jar --input input.json
java -jar server/fullsolver/dist/warpweft-fullsolver.jar --input input.json --mode minimum --max-cardinality 4
```

| 参数 | 说明 |
| --- | --- |
| `--input <json>` | 必填，solver input JSON |
| `--solver <jar>` | 启发式求解器；默认依次查找 `resources/solver/...`、`../../resources/solver/...`、旧相邻目录 |
| `--mode mus\|minimum` | 算法模式，默认 `mus` |
| `--max-cardinality <n>` | `minimum` 的最大冲突规模，默认 4 |
| `--time-limit <秒>` | 单次可行性判定的求解时限，默认 10 |
| `--process-timeout <秒>` | 单次 JVM 调用超时，默认 120 |
| `--out <file>` | 同时写报告文件 |
| `--no-explanation` | 不附带求解器说明，减少调用次数 |

## 报告示例

```json
{
  "protocolVersion": "1.0",
  "algorithm": "heuristic-oracle-conflict-analysis",
  "proof": false,
  "mode": "mus",
  "candidateRuleCount": 1,
  "status": "conflict",
  "minimalConflictSets": [
    { "ruleIds": ["rule-hard-teacher"], "ruleKinds": ["TEACHER_MAX_DAILY"], "size": 1 }
  ],
  "note": "基于启发式求解器的冲突分析……不构成数学证明",
  "oracleCalls": 3,
  "elapsedMs": 900
}
```

## 与其它模块的边界

- `apps/desktop/api.cjs` 是当前的 HTTP API 与任务编排；
- `services/solver-java` 是启发式排课求解器；
- `server/fullsolver` 只做离线冲突分析，不被 API 或渲染进程调用；
- 本模块不读写业务数据，只接收 solver input、输出 JSON 报告。
