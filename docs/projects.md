# 多工程（项目）与工程文件

## 1. 设计取舍

单机版与 Linux 服务端都只用一份 `server/api/api.cjs`，因此多工程能力只实现一次：

- `data/warpweft.json` 始终代表**当前正在编辑的工作区**，`store.read()/write()` 语义不变。
- **切换工程 = 把工程快照写进 `warpweft.json`**，所以 `PUT /api/data`、350ms 防抖保存、`validateData`、排课链路都不需要改动。
- 工程快照与导出文件同构：`{ format: 'warpweft-workspace', version: 1, name, savedAt, data }`，即 `.workspace.json` 格式，可直接跨机器迁移。

```
<dataDir>/
  warpweft.json                      活动工作区（既有）
  projects/
    index.json                       工程清单 + 活动指针（单一真源）
    p_<id>.json                      工程快照（同 .workspace.json）
    _autosave/<id>-<ts>.json         切换前自动备份，每工程保留最近 3 份
```

## 2. 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/projects` | 清单 + `activeId` + `limit` |
| GET | `/api/projects/active` | 当前工程与是否落后于工作区（`stale`） |
| POST | `/api/projects` | 新建；`{name, data?, open?}`，`data` 缺省时取当前工作区 |
| GET | `/api/projects/:id` | 读取快照，供前端导出 |
| PUT | `/api/projects/:id` | 覆盖保存 `{data?, name?}` |
| PATCH | `/api/projects/:id` | 仅重命名 `{name}` |
| DELETE | `/api/projects/:id` | 删除；若为活动工程则清空指针 |
| POST | `/api/projects/:id/open` | 换入工作区；`{expectedActiveId?, saveCurrent?, force?}`，成功直接返回换入后的 `data` |
| POST | `/api/projects/import` | 导入 `.workspace.json`，校验 `format` 与 `version` |

错误码：`PROJECT_NOT_FOUND`、`PROJECT_LIMIT_REACHED`、`PROJECT_INVALID_NAME`、`PROJECT_TOO_LARGE`、`PROJECT_CONFLICT`、`WORKSPACE_FORMAT_INVALID`、`WORKSPACE_VERSION_UNSUPPORTED`、`INVALID_DATA`。

## 3. 数据安全

- `open` 默认 `saveCurrent: true`：切换前先把当前工作区写回其所属工程，并复制一份到 `_autosave`。
- `expectedActiveId` 与服务器不一致时返回 `409 PROJECT_CONFLICT`（多客户端同时切换），前端二次确认后带 `force: true` 重试。
- 配额：工程上限 30 个，单工程 4 MB（`MAX_BODY` 5 MB 的 80%），工程名 1–60 字符。超出返回 409/413，不自动删除任何数据。
- 单进程内用 Promise 链串行化 `index.json` 的读-改-写；**不支持**桌面端与 Linux 同时指向同一 `dataDir`。

## 4. 双端一致性

- Windows（`apps/desktop/main.cjs`）与 Linux（`linux_server/server.cjs`）都调用同一个 `startApi()`，新路由自动生效，Linux 端无需改代码。
- `scripts/build-linux-server.cjs` 以 `copy('server/api', 'server/api')` 整目录打包，`projects.cjs` 自动入包并计入清单哈希。
- `tests/server-parity.test.cjs` 追加了 `/api/projects` 的双端等价断言。
- `data-schema.json` 的 `features` 增加 `projects` 但**不提高 `version`**，避免旧客户端被 `MIN_SERVER_SCHEMA` 拦截。
  代价：`features` 变更后必须重新执行 `npm run dist:linux`，否则 `linux_server/verify.sh` 的 capabilities 哈希比对会失败。

## 5. 前端行为

- 首次启动（`localStorage['warpweft-launcher-mode'] === 'always'`）先显示工程选择界面；默认 `auto` 直接进入上次工程。
- 标题栏承载工程工具栏（保存 / 另存 / 导入 / 导出）与当前工程名，保存状态以「未保存 / 保存中 / 保存失败」显示在工程名旁。
- 「设置 → 工程与数据」提供同一组动作与数据规模概览。
- 数据导入页只保留单个工作区文件的导入导出，不再维护 localStorage 工程列表，避免两套工程体系并存。
