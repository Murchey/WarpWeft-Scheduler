# 局域网服务端：连接数、并发与信任模型

> 适用：WarpWeft Scheduler 单机版以「局域网（服务端）」运行时
> 状态：已实现（服务端限额、客户端计数、并发队列、可取消任务）
> 更新：2026-10-21

## 1. 定位与信任模型

一台电脑作为服务端，其他电脑作为「局域网客户端」连接同一地址。整个链路**不做身份验证**：

- 没有口令、令牌、配对码、账号；
- 不做 TLS；
- 服务端只做两件事：**准入数量控制**（同时连几台）和**排队公平性**（一台机器不能吃满队列）。

因此：**同网段任何人都能读写本工作区数据**。请只在可信的学校内网/办公室网络启用；如网络不完全可信，可启用可选的「允许网段」白名单（`allowedCidrs`），但这不是身份认证。

客户端身份用 `X-Client-Id` 头（浏览器 localStorage 里的随机 UUID）区分，仅用于计数与配额；它可被伪造，这是「无条件信任」的必然取舍。

## 2. 快速开始

1. 服务端电脑：运行桌面端（或 `npm run dev:api`），进入「服务端」页。
2. 「局域网共享」卡片里把 **监听模式** 从「仅本机」切到「局域网」，按需调整允许电脑数/并发数，点 **保存并应用**。
3. 卡片会列出本机 LAN 地址，例如 `http://192.168.1.20:4317`。
4. 其他电脑：启动 WarpWeft → 运行模式选「局域网（客户端）」→ 服务地址填上面的 URL → 进入工作台。
5. 服务端「已连接电脑」表能看到每台机器的短 id、IP、最近活动、在跑/排队任务数。

> Windows 首次监听局域网时，系统防火墙会询问是否允许 Node/Electron 访问专用网络；选允许（仅专用网络）即可。

## 3. 限额

「服务端 → 局域网共享」可改，保存后立即生效（监听模式切换会短暂断连后自动恢复）。

| 字段 | 默认 | 范围 | 含义 / 调参建议 |
| --- | --- | --- | --- |
| `bindAddress` | `loopback`（局域网模式下为 `lan`） | loopback / lan | `loopback` 仅本机；`lan` 监听 `0.0.0.0` |
| `maxClients` | 8 | 1–32 | 同时允许的客户端电脑数（按 client id 计，90s 无请求过期） |
| `maxConcurrentJobs` | 1 | 1–8 | 同时运行的 Java 求解器进程数；每个进程 `-Xmx512m` |
| `queueCapacity` | 24 | 4–100 | 全局排队上限，满了返回 503 |
| `perClientActive` | 2 | 1–并发数 | 单台电脑同时跑的任务上限 |
| `perClientQueued` | 4 | 0–队列容量 | 单台电脑排队上限；与 `perClientActive` 合计为单机在途上限 |
| `jobTimeoutSeconds` | 120 | 30–600 | 单任务硬超时，到点 kill 并记为 `timeout` |
| `allowedCidrs` | `[]` | IPv4 CIDR 列表 | 空 = 全部允许；非空时只接受匹配来源 |

并发还会被内存钳制：`effective.maxConcurrentJobs = min(设置, floor(空闲可用内存/640MB))`，上限 8。UI 里若设置值被钳制会显示「已按内存限制为 N」。

**建议**：4 核 8GB 的办公机用 `并发 1–2`；16 核 32GB 的机器最多 `4`；更多并发主要受 JVM 内存与 CPU 单核性能限制，并不会线性加速单个任务。

## 4. 队列语义

- **FIFO**：先提交先排队；每个任务独立 JVM。
- **准入**：客户端未注册且已达 `maxClients` → `429 CLIENT_LIMIT`；单机在途（跑+排）达 `perClientActive + perClientQueued` → `429 CLIENT_QUEUE_FULL`；全局队列满 → `503 QUEUE_FULL`（带 `Retry-After`）。
- **取消**：排队中立即移除；运行中 kill 子进程，槽位立即释放，状态记 `cancelled`。
- **超时**：`min(jobTimeoutSeconds, max(15, timeLimitSeconds + 15))` 秒后 kill，状态 `timeout`。
- **客户端断开**：`POST /api/solve` 的连接断开不会杀掉任务；任务继续跑完并留在历史里，避免半截结果。
- **重启**：队列/历史/客户端表都在内存，服务端重启即清空（工作区数据不受影响）。

## 5. 性能设计

| 机制 | 说明 |
| --- | --- |
| 聚合轮询 | 服务端页每 2s 只打一个 `GET /api/server/overview`（原先 3 个请求） |
| 静态资源 | 改流式 `createReadStream` + `Content-Length`；`/assets/*` 一年 immutable 缓存，其余 no-store |
| 连接 | `keepAliveTimeout=65s`、`headersTimeout=70s`、`maxConnections = maxClients*4` |
| 求解请求 | `requestTimeout=0`，允许最长 `jobTimeoutSeconds` 的等待 |
| 内存 | 历史任务 100 条、日志 500 条；完成后释放求解结果对象，只留摘要 |
| CPU 统计 | 统计接口只读 `os`，不遍历工作区 |

## 6. HTTP 接口

| 方法 & 路径 | 说明 |
| --- | --- |
| `GET /api/health` | 存活 + 限额 + 客户端数 |
| `GET /api/server/overview?sinceLog=N` | 聚合：stats / jobs / logs / config / effective / clients |
| `GET /api/server/stats`、`GET /api/server/jobs`、`GET /api/server/logs?since=` | 兼容旧调用 |
| `GET /api/server/clients` | 已连接电脑列表 |
| `DELETE /api/server/clients/:id` | 断开某台（有在跑/排队任务时 409 `CLIENT_BUSY`） |
| `PUT /api/server/config` | 修改限额；返回 `config/effective/warnings/bind`，非法值回退并给 warning |
| `POST /api/server/jobs/:id/cancel` | 取消任务 |
| `POST /api/solve` | 提交排课任务（带 `X-Client-Id`），成功返回 SolverOutput |
| `GET/PUT /api/data` | 工作区读写（同样受客户端准入控制） |

错误码：`CLIENT_LIMIT`(429)、`CLIENT_QUEUE_FULL`(429)、`QUEUE_FULL`(503)、`SOLVER_UNAVAILABLE`(503)、`TIMEOUT`(504)、`JOB_CANCELLED`(409)、`CLIENT_BUSY`(409)、`INVALID_CONFIG`(400)、`IP_NOT_ALLOWED`(403)、`NOT_FOUND`(404)。

## 7. 故障排查

| 现象 | 排查 |
| --- | --- |
| 其他电脑连不上 | 服务端监听模式是否为「局域网」；防火墙是否放行 4317；客户端地址是否用服务端 LAN IP 而不是 127.0.0.1 |
| 提示「已连接的电脑数量达到上限」 | 提高允许电脑数，或在「已连接电脑」里断开闲置机器（90s 无请求也会自动过期） |
| 提交任务返回 503 | 队列满：等任务完成或提高队列容量/并发数 |
| 返回 429 `CLIENT_QUEUE_FULL` | 这台电脑在途任务过多，等自己的任务结束 |
| 任务 504 | 数据规模大或时限过短：提高 `timeLimitSeconds`，或提高 `jobTimeoutSeconds` |
| 「已连接电脑」为空 | 客户端还没发过请求；或客户端用了旧的固定 ip 计数（无 `X-Client-Id` 时按 IP 计一台） |
| 页面提示「服务端监控连接失败」 | 服务端进程退出或监听地址切换中；刷新页面即重连 |

## 8. 验证与压测

- 单元/集成测试：`npm test` 中的 `tests/server-limits.test.cjs`（假求解器，不依赖 Java）覆盖：并发上限、队列容量、客户端上限与过期、单机配额、取消、超时、配置校验、静态资源不占名额、监听地址切换、监控接口延迟；`tests/server-config.test.cjs` 覆盖限额钳制与网段匹配。
- 手动压测：`npm run load:lan -- --base http://<服务端IP>:4317 --clients 4 --jobs 2`，脚本模拟多台客户端并发提交，打印 running/queued 变化与每个任务耗时；也可两台以上机器同时提交大课时任务，观察「服务端」页的 CPU、并发、队列。需要更高并发时逐步提高 `maxConcurrentJobs` 并观察内存占用（每并发约 600MB–1GB）。

## 9. 已知限制

- 无鉴权、无 TLS：仅适用于可信内网。
- 队列与任务历史不持久化，服务端重启即丢；工作区数据仍在 `data/warpweft.json`。
- 一个任务一个 JVM（启动开销约 0.3–0.8s）；没有进程池复用。
- 单服务端单工作区；暂不支持多服务端/分布式调度。
