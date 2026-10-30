# 多工程（项目）与工程文件

## 1. 设计取舍

单机版与 Linux 服务端都只用一份 `server/api/api.cjs`，因此多工程能力只实现一次：

- `data/warpweft.json` 始终代表**当前正在编辑的工作区**，`store.read()/write()` 语义不变。
- **切换工程 = 把工程快照写进 `warpweft.json`**，所以 `PUT /api/data`、350ms 防抖保存、`validateData`、排课链路都不需要改动。
- 工程包是**分片 JSON 的 ZIP**（见下）；**导出也用同一格式**，导出的 `.zip` 可直接在另一台机器导入还原。

```
<dataDir>/
  warpweft.json                      活动工作区（既有，仍为单文件 JSON）
  projects/
    index.json                       工程清单 + 活动指针（单一真源）
    p_<id>.zip                       工程包（分片 JSON 的 ZIP）
    p_<id>.zip                       工程包（分片 JSON 的 ZIP）
    _autosave/<id>-<ts>.zip          切换前自动备份，每工程保留最近 3 份
```

### 1.1 工程包内部结构

用系统解压工具（Windows 资源管理器 / `tar -xf` / `unzip`）可直接打开查看：

```
manifest.json            格式版本、名称、保存时间、roomMode、计数、分片清单
core/school.json         基础资料，一类一个文件
core/classes.json
core/coursePlans.json
core/…
results/candidate.json   排课结果（体积大头，通常占 40%–50%）
results/published.json
history/adjustments.json 调代课、授课日志、审计日志
history/auditLog.json
extra.json               未知字段兜底，保证前向兼容不丢数据
```

- **自适应布局**：工作区 JSON 小于 32 KB 时只写 `manifest.json` + `data.json`（每个 ZIP 条目有 ~76 字节固定开销，20 个分片约 1.5 KB，对空工程反而膨胀）；超过阈值才分片。
- **压缩收益**（本机真实数据 45 班 / 690 计划 / 1620 课时）：
  | | 体积 | 耗时 |
  | --- | --- | --- |
  | 单文件 JSON（含缩进） | 747 KB | `JSON.parse` 1–2 ms |
  | 分片 ZIP | **52 KB** | 编码 7 ms / 解码 4 ms |
- ZIP 用 `node:zlib` 的 `deflateRaw`/`inflateRaw` 自实现（`server/api/zip.cjs`，约 200 行），**不引入第三方依赖**，保持 Linux 服务端零依赖。已用 Windows `bsdtar` 验证互通。

> 说明：压缩后读取会多一次 inflate（约 2–4 ms），换来磁盘与跨机拷贝字节数下降一个数量级。若数据目录在机械盘或网络盘，这个交换明显划算；纯内存态的高频读写仍走 `warpweft.json`，不受影响。

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
| POST | `/api/projects/import` | 导入工程包，请求体为 ZIP 二进制（`Content-Type: application/zip`） |
| GET | `/api/workspace/export?name=` | 把**当前工作区**打成 `.zip` 工程包下载（不依赖已绑定工程） |
| POST | `/api/workspace/unpack` | 解包工程包为 `{format, version, name, savedAt, data}`，**只读不落盘**（数据导入页「加载工作区」用） |

错误码：`PROJECT_NOT_FOUND`、`PROJECT_LIMIT_REACHED`、`PROJECT_INVALID_NAME`、`PROJECT_TOO_LARGE`、`PROJECT_CORRUPTED`、`PROJECT_CONFLICT`、`WORKSPACE_FORMAT_INVALID`、`WORKSPACE_VERSION_UNSUPPORTED`、`INVALID_DATA`。

`GET /api/projects/:id` 返回的 `doc` 由工程包合并而成，形状与导出文件一致：`{ format, version, name, savedAt, data }`

## 3. 数据安全

- `open` 默认 `saveCurrent: true`：切换前先把当前工作区写回其所属工程，并复制一份到 `_autosave`。
- `expectedActiveId` 与服务器不一致时返回 `409 PROJECT_CONFLICT`（多客户端同时切换），前端二次确认后带 `force: true` 重试。
- 配额：工程上限 30 个，**解压后**数据 4 MB（`MAX_BODY` 5 MB 的 80%），工程名 1–60 字符。超出返回 409/413，不自动删除任何数据。
- `bytes` 记录压缩后的包体积，`rawBytes` 记录解压后体积；配额按 `rawBytes` 判定。
- 单进程内用 Promise 链串行化 `index.json` 的读-改-写；**不支持**桌面端与 Linux 同时指向同一 `dataDir`。
- **单一格式**：工程文件只有 `.zip` 一种。旧的单文件 `.workspace.json` 在正式发版前已移除——既不读也不写，避免维护两套解析路径。若传入非 ZIP 数据，返回 `WORKSPACE_ARCHIVE_INVALID`。

## 4. 双端一致性

- Windows（`apps/desktop/main.cjs`）与 Linux（`linux_server/server.cjs`）都调用同一个 `startApi()`，新路由自动生效，Linux 端无需改代码。
- `scripts/build-linux-server.cjs` 以 `copy('server/api', 'server/api')` 整目录打包，`projects.cjs`、`projectSnapshot.cjs`、`zip.cjs` 自动入包。
- **零第三方依赖**：`zip.cjs` 只用 `node:zlib`，`linux_server/` 仍不需要 `package.json` 或 `npm install`。
- `tests/server-parity.test.cjs` 追加了 `/api/projects` 的双端等价断言。
- `data-schema.json` 的 `features` 增加 `projects` 但**不提高 `version`**，避免旧客户端被 `MIN_SERVER_SCHEMA` 拦截。
  代价：`features` 变更后必须重新执行 `npm run dist:linux`，否则 `linux_server/verify.sh` 的 capabilities 哈希比对会失败。

## 5. 前端行为

- 首次启动（`localStorage['warpweft-launcher-mode'] === 'always'`）先显示工程选择界面；默认 `auto` 直接进入上次工程。
- 标题栏承载工程工具栏：**保存**（覆盖当前工程）/ **保存副本…**（在工程库新建，当前工程不变）/ **从文件导入** / **导出 .zip**（下载工程包）。
  「保存副本」与「导出」刻意分开命名：前者留在工程库，后者生成可分发文件。
- 「设置 → 工程与数据」提供同一组动作与数据规模概览。
- 数据导入页的「加载工作区文件」接受 `.zip` 工程包，走 `POST /api/workspace/unpack` 解包；不写入工程库，只替换当前工作区数据。
- 导入入口只接受 `.zip` 工程包（按 ZIP 魔数校验，不看扩展名）。
