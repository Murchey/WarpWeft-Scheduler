# WarpWeft Scheduler Linux 服务端部署指南

本文面向在 Linux 服务器上部署 WarpWeft 的运维/管理员。Linux 服务端复用桌面版的同一套浏览器 UI、Java 排课求解器和 JSON 工作区，不需要 Electron。

## 1. 适用范围

- 推荐系统：Ubuntu 22.04 / 24.04 LTS、Debian 12，x86_64。
- 运行时：Node.js 20 或 22、Java 21（JRE 即可运行，构建需要 JDK）。
- 进程管理：systemd。
- 反向代理：Nginx（可选，但公网/VPN 访问建议启用 TLS）。
- 部署形态：内部可信局域网，或经 Nginx/VPN 访问的校园服务器。

## 2. 架构与数据流

```
浏览器（同一套 React UI）
        │  HTTP/HTTPS，同源静态页面 + /api/*
        ▼
Nginx（可选：TLS、Basic Auth、访问日志）
        │  proxy_pass 127.0.0.1:4317
        ▼
linux_server/server.cjs（Node，HTTP API + 静态文件）
        ├── /var/lib/warpweft/warpweft.json     工作区数据
        ├── /var/lib/warpweft/server-config.json 服务端限额
        ├── /var/lib/warpweft/solve-jobs/        长时任务与检查点
        └── resources/solver/warpweft-solver.jar（Java 21）
                    │ stdin/stdout JSON
                    ▼
              Java Solver（每个任务一个 JVM，默认 -Xmx512m）
```

- 静态页面由 Node 从安装目录的 `dist/` 提供；生产环境不需要 Vite。
- 短时排课请求和长时检查点任务共用同一个 Java 求解器。
- 默认单工作区、单长时任务；短时任务按服务端配置排队。
- 数据以 UTF-8 JSON 文件保存，写入采用临时文件 + rename；没有外部数据库。

## 3. 安全边界（先读）

**应用层没有登录/账号系统。** 只要网络能访问服务端端口，就能读取和修改工作区、取消任务、修改服务端限额。浏览器生成的 `X-Client-Id` 只用于连接计数和配额，不是身份认证。

因此：

- 默认只监听 `127.0.0.1`，适合“Nginx 同机反代”或 SSH 隧道管理。
- 直连局域网时，必须用防火墙限制来源网段，并且只放在可信校园网/VLAN。
- 不要把 4317 端口直接暴露到公网。公网访问请使用 Nginx TLS + Basic Auth，或 VPN。
- 同一时间建议只保留一位编辑者。当前保存是整库覆盖，多人同时编辑不会自动合并。
- 备份/恢复必须包含整个 `/var/lib/warpweft`，尤其是 `solve-jobs/`。

## 4. 先决条件

以 Ubuntu 22.04/24.04 为例：

```bash
sudo apt update
sudo apt install -y curl ca-certificates tar openjdk-21-jre-headless
```

安装 Node.js 22（二选一）：

```bash
# NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
```

构建机还需要 JDK 21 和 `unzip` 能力（`jar` 命令包含在 JDK 中）：

```bash
sudo apt install -y openjdk-21-jdk-headless
javac -version
jar --version
```

建议资源：

- 2 GB 以上内存；每个并发 Solver 约需 512 MB JVM 堆，服务端会按总内存限制并发。
- 至少 2 GB 可用磁盘（Electron 不参与 Linux 服务端，包体主要是 JRE 依赖之外的静态文件和 JAR）。
- 服务器时间同步（NTP），否则审计时间、任务时间和课表日期会漂移。

## 5. 构建 Linux 部署包

### 5.1 Windows 上交叉构建（推荐给当前开发机）

在项目根目录双击 [build_appliction.bat](build_appliction.bat)，选择：

```text
[2] 编译 Linux 服务端
```

或执行：

```powershell
npm run dist:linux
```

脚本会重新构建 Java Solver、渲染进程，并在项目根目录生成：

```text
dist/linux-server/warpweft-linux-server-<版本>.tar.gz
dist/linux-server/warpweft-linux-server-<版本>.tar.gz.sha256
```

### 5.2 Linux 原生构建

```bash
cd /path/to/WarpWeft-Scheduler
npm ci
npm test
npm run build
npm run dist:linux
```

如果已经在 CI 中构建过 `dist/` 和 JAR，可以跳过重复构建：

```bash
npm run dist:linux -- --skip-build
```

Java 依赖默认从 Maven Central 下载；内网环境可设置镜像：

```bash
MAVEN_MIRROR=https://maven.aliyun.com/repository/public npm run build:solver
```

### 5.3 校验部署包

```bash
cd dist/linux-server
sha256sum -c warpweft-linux-server-<版本>.tar.gz.sha256
```

部署包内容：

```text
warpweft/
  linux_server/server.cjs
  linux_server/install.sh
  linux_server/uninstall.sh
  linux_server/healthcheck.sh
  linux_server/verify.sh
  linux_server/warpweft.service
  linux_server/warpweft.env.example
  linux_server/nginx.conf.example
  server/api/*.cjs
  dist/                 # 浏览器 UI
  resources/solver/warpweft-solver.jar
  data-schema.json
  package.json          # 精简运行时元数据，无 Electron/Vite 依赖
  guideline.md
  LICENSE
```

服务端不需要执行 `npm install`；它只使用 Node 内置模块、静态文件和 Java JAR。

## 6. 安装

```bash
tar -xzf warpweft-linux-server-<版本>.tar.gz
cd warpweft
sudo bash linux_server/install.sh
```

安装脚本会：

- 创建系统用户 `warpweft`；
- 将应用安装到 `/opt/warpweft`；
- 创建数据目录 `/var/lib/warpweft`；
- 创建环境文件 `/etc/warpweft/warpweft.env`（已存在则保留）；
- 安装并启用 `warpweft.service`；
- 以 root 只读方式保护 `/opt/warpweft`，只允许服务写数据目录。

默认监听 `127.0.0.1:4317`。安装后检查：

```bash
systemctl status warpweft
journalctl -u warpweft -n 50 --no-pager
bash /opt/warpweft/linux_server/verify.sh
```

### 6.1 只通过 Nginx 访问（推荐）

保持服务端 `127.0.0.1`，在服务器上安装 Nginx：

```bash
sudo apt install -y nginx
sudo cp /opt/warpweft/linux_server/nginx.conf.example /etc/nginx/conf.d/warpweft.conf
sudo nginx -t
sudo systemctl reload nginx
```

把浏览器访问地址设为：

```text
http://<服务器域名或IP>/
```

如果使用 HTTPS，用 certbot 或现有证书配置 443，再把 80 重定向到 443。Nginx 示例中的 `X-Forwarded-For $remote_addr` 会覆盖客户端伪造头，服务端只信任同机回环代理。

### 6.2 直连局域网（不推荐公网）

如果确实要让局域网直接访问 4317：

1. 先通过 SSH 隧道打开本机管理页：
   ```bash
   ssh -L 4317:127.0.0.1:4317 user@server
   ```
2. 浏览器打开 `http://127.0.0.1:4317/`，进入“服务端 → 局域网共享”，把监听模式切为“局域网”并保存。
3. 或者在服务器上编辑 `/var/lib/warpweft/server-config.json`：
   ```json
   { "bindAddress": "lan" }
   ```
4. 重启服务：
   ```bash
   sudo systemctl restart warpweft
   ```
5. 防火墙只放行教学网段：
   ```bash
   sudo ufw allow from 192.168.1.0/24 to any port 4317 proto tcp
   sudo ufw deny 4317/tcp
   ```

只有在明确要强制覆盖 UI 的监听设置时，才在 `/etc/warpweft/warpweft.env` 中取消 `WARPVEFT_HOST` 注释。设置后 UI 的“切换局域网”不会在重启后保留。

### 6.3 Nginx + TLS + Basic Auth（公网/VPN 前置）

应用自身不做认证。公网必须额外加一层：

```bash
sudo apt install -y apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd warpweft-admin
sudo certbot --nginx -d scheduler.example.edu
```

并在 Nginx `location /` 中启用示例里的 `auth_basic` / `auth_basic_user_file`。TLS 终止在 Nginx，Node 只监听回环；服务端环境保留：

```text
WARPVEFT_TRUST_PROXY=1
```

不要让 4317 暴露在公网。Basic Auth 只是最低限度保护，正式公网部署仍建议 VPN/零信任网关。

## 7. 配置项

### 7.1 systemd 环境文件

编辑 `/etc/warpweft/warpweft.env` 后执行：

```bash
sudo systemctl restart warpweft
```

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `WARPVEFT_PORT` | `4317` | HTTP 端口，修改后同步 Nginx/防火墙。 |
| `WARPVEFT_DATA_DIR` | `/var/lib/warpweft` | 工作区、服务端配置和长时任务目录；必须可写。 |
| `WARPVEFT_HOST` | 不设置 | 可选强制监听地址。不设置时由 `server-config.json`/UI 决定；设置后覆盖 UI 的持久化监听设置。 |
| `WARPVEFT_SOLVER_JAR` | `/opt/warpweft/resources/solver/warpweft-solver.jar` | 自定义 JAR 路径。 |
| `JAVA_HOME` | 自动 PATH | 指向 JDK/JRE 21；找不到 Java 时健康页会显示未就绪。 |
| `WARPVEFT_TRUST_PROXY` | `1` | 同机回环代理时信任 `X-Forwarded-For`/`X-Real-IP`；设为 `0` 可关闭。 |

### 7.2 服务端 UI 配置

以 `mode=lan-server` 打开页面后，左侧出现“服务端”页，可修改：

- 监听模式（仅本机/局域网）；
- 最大连接电脑数；
- 最大并发 Solver 数（还会受物理内存钳制）；
- 队列容量、单客户端在跑/排队上限；
- 短时任务超时；
- 允许网段（IPv4 CIDR，留空表示全部允许）。

这些值保存在 `/var/lib/warpweft/server-config.json`，重启后保留。修改监听模式会短暂断连并自动重绑；如果设置了 `WARPVEFT_HOST`，重启后以环境变量为准。

### 7.3 运行模式

浏览器端“运行模式”只影响 UI 展示和 API 地址：

- `single`：本机/单机使用；
- `lan-server`：显示“服务端”管理页；
- `lan-client`：连接另一个服务端；
- `cloud`：连接远端 HTTPS API。

Linux 管理员可以使用：

```text
http://<服务器>/?mode=lan-server
```

普通客户端使用服务端地址即可；新的 UI 在通过服务器页面打开时会默认使用当前页面的同源 API，不再请求客户端自己的 `127.0.0.1`。

## 8. 日常运维

### 8.1 健康检查

```bash
curl -fsS http://127.0.0.1:4317/api/health
bash /opt/warpweft/linux_server/verify.sh
```

`verify.sh` 会检查 Node、Java、健康接口、首页和数据接口；任一项失败返回非 0。

### 8.2 日志

```bash
journalctl -u warpweft -f
journalctl -u warpweft --since "1 hour ago"
```

服务端日志也保存在内存中供“服务端”页查看；持久日志以 journal 为准。

### 8.3 备份与恢复

一致备份建议先停服务：

```bash
sudo systemctl stop warpweft
sudo tar -czf /var/backups/warpweft-$(date +%F-%H%M).tar.gz -C /var/lib warpweft
sudo systemctl start warpweft
```

恢复：

```bash
sudo systemctl stop warpweft
sudo tar -xzf /var/backups/warpweft-YYYY-MM-DD-HHMM.tar.gz -C /var/lib
sudo chown -R warpweft:warpweft /var/lib/warpweft
sudo systemctl start warpweft
```

至少备份：

- `/var/lib/warpweft/warpweft.json`
- `/var/lib/warpweft/server-config.json`
- `/var/lib/warpweft/solve-jobs/`

### 8.4 升级

1. 下载并校验新 tar.gz；
2. 备份数据；
3. 解压新包，执行 `sudo bash linux_server/install.sh`；
4. 安装脚本保留 `/var/lib/warpweft` 与 `/etc/warpweft/warpweft.env`；
5. `bash /opt/warpweft/linux_server/verify.sh`；
6. 浏览器强制刷新（静态资源使用内容哈希，但 HTML 缓存可能保留旧入口）。

升级前确认数据版本和 `data-schema.json` 兼容；当前版本 schemaVersion 为 3。

### 8.5 卸载

```bash
# 保留数据
sudo bash /opt/warpweft/linux_server/uninstall.sh

# 删除应用、数据、环境文件（不可恢复）
sudo bash /opt/warpweft/linux_server/uninstall.sh --purge-data
```

## 9. 故障排查

| 现象 | 检查/处理 |
| --- | --- |
| 页面能打开但一直显示未连接 | 确认页面与 API 同源；清除站点 localStorage 中旧的 `warpweft-runtime-endpoint`；检查浏览器控制台请求地址是否仍是客户端 127.0.0.1。 |
| Nginx 502 | `systemctl status warpweft`；`curl 127.0.0.1:4317/api/health`；确认 Nginx upstream 端口。 |
| 服务启动即退出 | `journalctl -u warpweft -n 80`；检查 `WARPVEFT_DATA_DIR` 权限、端口占用、Node 版本。 |
| `EADDRINUSE` | `ss -ltnp | grep 4317`；停止冲突进程或改 `WARPVEFT_PORT`。 |
| 健康页 Java 未就绪 | 检查 `java -version` 是否 21+、JAR 是否存在、`JAVA_HOME` 是否正确。 |
| 排课返回 503 Solver unavailable | 构建机重新 `npm run build:solver`，确认 `resources/solver/warpweft-solver.jar` 在包内。 |
| 保存报 413 | 工作区 JSON 超过 5 MiB 服务端上限，或 Nginx `client_max_body_size` 太小；不要盲目放大，先检查数据。 |
| 长任务 504 | Nginx `proxy_read_timeout` 至少 900s；服务端 `jobTimeoutSeconds` 最大 600s，长任务本身有 6 小时上限。 |
| 长任务 403 `TASK_FORBIDDEN` | 任务属于另一个浏览器 `clientId`；使用原浏览器/原 profile，或在服务器上查看 `/var/lib/warpweft/solve-jobs/`。 |
| 客户端 IP 全是 127.0.0.1 | Nginx 必须设置 `X-Forwarded-For`；Node 只在同机回环代理时信任它；确认没有设置 `WARPVEFT_TRUST_PROXY=0`。 |
| 允许网段误拦截 | 代理后 IP 取的是 XFF；先确认 Nginx 覆盖头；直连时 CIDR 取真实 socket IP。 |
| 切换局域网后重启又变回仅本机 | 环境文件里设置了 `WARPVEFT_HOST=127.0.0.1`，删除/注释它，让 `server-config.json` 生效。 |
| systemd 报只读文件系统 | 自定义 `WARPVEFT_DATA_DIR` 后同步修改 unit 的 `ReadWritePaths`，或使用默认 `/var/lib/warpweft`。 |
| 浏览器仍请求 `127.0.0.1` | 设置页“服务地址”残留旧值；清空/改为当前访问地址后保存；确认 UI 包是新构建。 |

## 10. 验收清单

在目标 Linux 服务器执行：

```bash
# 1. 服务
systemctl is-active warpweft
journalctl -u warpweft -n 30 --no-pager

# 2. 健康与页面
curl -fsS http://127.0.0.1:4317/api/health
curl -fsS http://127.0.0.1:4317/ | head

# 3. 数据读写
curl -fsS http://127.0.0.1:4317/api/data | head -c 300

# 4. UI
# 浏览器打开 http://<服务器>/ 或 https://<域名>/
# 确认首页、排课准备、排课任务、课表预览可加载

# 5. 真实排课
# 导入/打开工作区，启动一次短时排课，确认生成候选课表并保存

# 6. 长时任务
# 启动长时任务，暂停、继续、刷新页面后按任务 UUID 找回

# 7. 重启恢复
sudo systemctl restart warpweft
# 长时任务应显示“已中断（可继续）”，可继续
```

Nginx/TLS 部署还要验证：

- HTTP 自动跳 HTTPS（如启用）；
- Basic Auth 生效（如启用）；
- `X-Forwarded-For` 后客户端列表显示真实 IP；
- 大请求/长请求不被代理提前断开。

## 11. 已知限制

- 单工作区整库保存，没有多用户合并；多人同时编辑会互相覆盖。
- 没有应用层账号/权限/审计登录；依赖网络边界或 Nginx Basic Auth。
- 同一时间只允许一个长时任务；短时任务按队列串行/并发配置执行。
- JSON 存储适合小规模；大规模并发/多租户时应迁移数据库。
- 本指南的 systemd 方案以 Ubuntu/Debian 为主；其他发行版需相应调整包名和路径。
- Docker 镜像不在当前版本范围内。
