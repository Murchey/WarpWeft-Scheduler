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

没有发现 UI 调用但服务端未实现的路由。

## 2. 本次修复

1. **同源 API 地址**：生产页面默认使用 `window.location.origin`，开发页面才回退 `127.0.0.1:4317`；运行模式对话框/设置页同步。
2. **可信代理 IP**：仅当直连 peer 是回环地址时信任 `X-Forwarded-For`/`X-Real-IP`，恢复 Nginx 后的客户端 IP、网段白名单和客户端列表。
3. **长时任务所有权**：列表只返回当前 `clientId` 的任务；读取/暂停/继续/取消/删除和 taskUuid 复用均做 owner 校验；旧的无 owner 任务只对回环管理请求可见。
4. **Linux 运行/构建**：新增 `linux_server/server.cjs`、systemd 单元、安装/卸载/验证脚本，以及跨平台 Solver 构建 wrapper。
5. **服务端提示**：将“本机服务端”改为“服务端”，增加当前访问地址和“多人同时编辑会整库覆盖”的提示。

## 3. 已知限制（未在本轮改变）

- 单个 JSON 工作区，保存是整库覆盖，最后写入者获胜；不做多用户合并。部署指南要求同一时间只保留一位编辑者。
- 应用层没有账号系统；`X-Client-Id` 只用于计数/配额，不是认证。公网必须经 Nginx TLS + Basic Auth 或 VPN。
- 同一时间只允许一个长时任务；短时任务按服务端队列/并发配置执行。
- 没有 SQLite/数据库迁移、Docker 镜像、自动更新或集中日志。
- 浏览器无法打开服务器文件管理器，只能复制服务端路径；这是浏览器安全边界。

## 4. 验收关注点

- 远程浏览器首次打开 Linux 页面时，网络面板中的 API 请求应指向当前服务器，而不是客户端 127.0.0.1。
- Nginx 代理后，`/api/server/clients` 显示真实客户端 IP；伪造 XFF 不应从直连客户端获得信任。
- 客户端 B 不能看到/操作客户端 A 的长时任务。
- Linux 包解压后可直接 `node linux_server/server.cjs` 启动；`install.sh` 安装后 systemd 单元、数据目录和 Nginx 反代按 `guideline.md` 工作。
