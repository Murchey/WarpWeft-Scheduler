# server/ 模块边界

本目录集中存放服务端相关模块：HTTP API、规则冲突分析和相关运行脚本。桌面端 Electron 只负责窗口/文件对话框，启动时加载 `server/api/api.cjs`。

| 路径 | 角色 | 是否在运行路径 |
| --- | --- | --- |
| `server/api/` | HTTP API：数据读写、短时/长时任务、检查点、客户端配额、服务端配置 | 是 |
| `apps/desktop/main.cjs` | Electron 主进程：窗口、工作区选择、导出文件对话框，启动 `server/api` | 是 |
| `services/solver-java/` | 启发式排课求解器（Java 21，stdin/stdout JSON） | 是 |
| `server/fullsolver/` | 命令行规则冲突分析，调用求解器作为启发式 oracle | 否，离线/CLI |

## API 迁移

2026-10-23 将 `api.cjs`、`database.cjs`、`server-config.cjs` 从 `apps/desktop/` 迁入 `server/api/`。桌面入口、开发 API 脚本、测试和 electron-builder 的 `files` 已同步更新；`main.cjs` 仍以仓库根目录作为 `rootDir`，因此 `resources/solver` 与 `data/` 的路径不变。

本地开发：

```powershell
npm run dev:api   # node scripts/dev-api.cjs -> server/api/api.cjs
npm run dev       # Vite 渲染层
```

## FullSolver 的判定语义

见 `server/fullsolver/README.md`：启发式失败/超时只能报告“近似冲突集”，报告固定 `"proof": false`；状态为 `unknown` 时不给冲突集。不要把该模块描述为“精确最小冲突集”或 HTTP 服务。
