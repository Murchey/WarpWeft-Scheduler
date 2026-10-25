# 本地服务端 / UI 匹配审计

审计对象：`server/api/api.cjs`、`apps/renderer/src`、Electron 桌面入口与现有测试。目标是把同一套 UI 放到 Linux 服务端上运行，而不是另做一个前端。

## 1. 功能对照

| UI 功能 | 使用中的服务端能力 | 结论 |
| --- | --- | --- |
| 启动加载工作区 | `GET /api/data` | 匹配 |
| 编辑后自动保存 | `PUT /api/data` | 匹配；整库覆盖限制见下 |
| 顶部在线/版本状态 | `GET /api/health` | 匹配 |
| 短时排课 | `POST /api/solve` | 匹配 |
| 长时任务启动/暂停/继续/取消/删除 | `/api/solve/long`、`/api/solve/jobs/*` | 匹配；本次补齐 owner 隔离 |
| 任务历史与检查点 | `GET /api/solve/jobs`、`by-uuid` | 匹配；本次只返回自己的任务 |
| 服务端监控 | `/api/server/overview`、stats、logs、clients | 匹配 |
| 服务端限额配置 | `PUT /api/server/config` | 匹配 |
| 断开客户端/取消短任务 | `DELETE /api/server/clients/:id`、`POST /api/server/jobs/:id/cancel` | 匹配 |
| 课表/Excel/CSV 导出 | 浏览器 Blob 下载；桌面 bridge 保存 | 匹配；Linux 浏览器使用普通下载 |
| 工作区路径选择 | Electron bridge；浏览器回退为服务端数据目录说明 | 不阻塞 Linux |
| 打开任务文件所在文件夹 | Electron bridge；浏览器回退为复制路径 | 不阻塞 Linux；服务器路径由服务端返回 |
| 服务端静态页面 | `rootDir/dist` | 匹配；Linux 包内包含构建后的 dist |
| Linux 登录 | `/api/auth/login`、`/api/auth/me`、`/api/auth/logout` | 新增；Electron 本机不启用 |
| Linux 用户管理 | `/api/users`（管理员） | 新增；仅 Linux 浏览器管理页显示 |

没有发现 UI 调用但服务端未实现的路由。

## 2. 本次修复

1. **同源 API 地址**：生产页面默认使用 `window.location.origin`，开发页面才回退 `127.0.0.1:4317`；运行模式对话框/设置页同步。
2. **可信代理 IP**：仅当直连 peer 是回环地址时信任 `X-Forwarded-For`/`X-Real-IP`，恢复 Nginx 后的客户端 IP、网段白名单和客户端列表。
3. **长时任务所有权**：列表只返回当前 `clientId` 的任务；读取/暂停/继续/取消/删除和 taskUuid 复用均做 owner 校验；旧的无 owner 任务只对回环管理请求可见。
4. **Linux 运行/构建**：新增 `linux_server/server.cjs`、systemd 单元、安装/卸载/验证脚本，以及跨平台 Solver 构建 wrapper。
5. **服务端提示**：将“本机服务端”改为“服务端”，增加当前访问地址和“多人同时编辑会整库覆盖”的提示。
6. **Linux 登录架构**：`users.json`、scrypt 密码哈希、Bearer session、登录页；只有 Linux 服务端显示“用户与密码”，Electron 客户端不显示。

## 3. 已知限制（未在本轮改变）

- 单个 JSON 工作区，保存是整库覆盖，最后写入者获胜；不做多用户合并。部署指南要求同一时间只保留一位编辑者。
- Linux 端有账号/密码（admin/user），登录 token 默认 12 小时；Electron 本机桌面版不启用登录，连接 Linux 时只显示登录、不显示用户管理。`X-Client-Id` 仍只用于计数/配额，不是认证。公网必须经 Nginx TLS/VPN。
- 同一时间只允许一个长时任务；短时任务按服务端队列/并发配置执行。
- 没有 SQLite/数据库迁移、Docker 镜像、自动更新或集中日志。
- 浏览器无法打开服务器文件管理器，只能复制服务端路径；这是浏览器安全边界。

## 4. 验收关注点

- 远程浏览器首次打开 Linux 页面时，网络面板中的 API 请求应指向当前服务器，而不是客户端 127.0.0.1。
- Nginx 代理后，`/api/server/clients` 显示真实客户端 IP；伪造 XFF 不应从直连客户端获得信任。
- 客户端 B 不能看到/操作客户端 A 的长时任务。
- Linux 包解压后可直接 `node linux_server/server.cjs` 启动；`install.sh` 安装后 systemd 单元、数据目录和 Nginx 反代按 `guideline.md` 工作。

---

## 5. 本轮一致性保障（2026-10）

Linux 入口和桌面入口继续共用 `server/api/api.cjs`，没有另写一套 API。本轮补上了可执行的对照与打包校验：

- **运行时对照测试**：`tests/server-parity.test.cjs` 同时启动桌面式 `startApi` 与 Linux `startFromEnv`（关闭 Linux 登录做等价比较），比较 `/api/health` 的 `appVersion`、`schemaVersion`、`solverProtocol`、`capabilities`、配额配置，以及 `/` 构建页面和空工作区数据。两边必须完全一致。
- **构建清单**：`npm run dist:linux` 会在包根写入 `warpweft-build.json`，记录版本、schema、capabilities、渲染资源数量，以及 `dist/index.html`、`server/api/api.cjs`、`linux_server/server.cjs`、`data-schema.json`、Solver jar 的 SHA-256。
- **安装后自检**：`linux_server/verify.sh` 在 health/schema 检查后调用 `verify-manifest.cjs`，把运行中的 `appVersion` / `schemaVersion` / `solverProtocol` / `capabilities` 与构建清单对比，并校验五个关键文件及 renderer 资源哈希；半覆盖升级、只替换 UI 或只替换 API 会直接失败。
- **构建资源检查**：`scripts/build-linux-server.cjs` 会解析 `dist/index.html` 的本地 `src`/`href`，确认引用的 JS/CSS/图标都进入包内，避免“服务能启动但页面白屏”。
- **最新包**：`dist/linux-server/warpweft-linux-server-0.1.0.tar.gz` 已按当前 `dist`、`data-schema.json`、Solver jar 重新构建；解压后启动并用 `WARPVEFT_BASE_URL=http://127.0.0.1:4321 bash linux_server/verify.sh` 实测通过。

### 仍然保留的平台差异（不是能力缺失）

- Linux 默认启用账号登录和管理员用户管理；Electron 单机版不启用登录，只保存本地工作区。
- 桌面版有系统文件选择/打开文件夹；Linux 浏览器使用普通下载/目录选择器，受浏览器安全边界限制。
- 数据目录：桌面版可在界面选择工作区；Linux 固定在 `WARPVEFT_DATA_DIR`（默认 `/var/lib/warpweft`）。
- 登录、用户管理、桌面 bridge 不进入“能力一致性”比较；其余 API、schema、capabilities、静态 UI 和 Solver 路径必须一致。

**验证**：`node --test tests/server-parity.test.cjs tests/linux-manifest.test.cjs` 2 条通过；Linux 包解压启动后 `verify.sh` 全部检查通过，`build manifest matches health, schema and package hashes`。
