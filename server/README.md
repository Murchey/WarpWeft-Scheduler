# server/ 模块边界

本目录用于集中与“服务端/离线计算”相关的模块。当前只有 `fullsolver/`，**没有**把现有 HTTP API 迁入这里。

| 路径 | 角色 | 是否在运行路径 |
| --- | --- | --- |
| `apps/desktop/api.cjs` | 当前桌面端启动的 HTTP API：数据读写、短时/长时任务、检查点、客户端配额 | 是 |
| `services/solver-java/` | 启发式排课求解器（Java 21，stdin/stdout JSON） | 是 |
| `server/fullsolver/` | 命令行规则冲突分析，调用求解器作为启发式 oracle | 否，离线/CLI |

## 为什么不把 API 一起搬进来

桌面启动、打包路径（`apps/desktop/main.cjs`、`resources/solver`）都依赖现有布局；T10 只迁移 FullSolver，避免一次改动同时动运行路径和安装包。若未来把 API 抽成独立服务，再整体迁入 `server/`，并同步 `package.json`、electron-builder 与文档。

## FullSolver 的判定语义

见 `server/fullsolver/README.md`：启发式失败/超时只能报告“近似冲突集”，报告固定 `"proof": false`；状态为 `unknown` 时不给冲突集。不要把该模块描述为“精确最小冲突集”或 HTTP 服务。
