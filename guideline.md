# WarpWeft Scheduler Linux 服务端部署指南

本文面向在 Linux 服务器上部署 WarpWeft 的运维/管理员。Linux 服务端复用桌面版的同一套浏览器 UI、Java 排课求解器和 JSON 工作区，不需要 Electron。

## 1. 适用范围

- 推荐系统：Ubuntu 22.04 / 24.04 LTS、Debian 12，x86_64。
- 运行时：Node.js 20 或 22、Java 21（JRE 即可运行，构建需要 JDK）。
- 进程管理：systemd。
- 反向代理：Nginx（可选，但公网/VPN 访问建议启用 TLS）。
- 部署形态：内部可信局域网；云服务器/公网必须经 Nginx TLS 或 VPN，完整步骤见 6.5。

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
        ├── /var/lib/warpweft/users.json         Linux 用户与密码哈希
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

**Linux 服务端默认启用账号登录。** 除 `/api/health` 和登录接口外，所有 API 都需要登录后获得的 Bearer token；用户管理只允许管理员操作。

- **Linux 端**：有用户、密码、角色；管理员可以在 Linux 服务端的“用户与密码”页添加用户/重置密码，也可以用 `user-cli.cjs`。
- **Electron 端**：本机桌面 API 不启用登录，也不创建用户文件；Electron 连接 Linux 服务端时只出现登录界面，不显示用户管理。
- `X-Client-Id` 仍只用于连接计数/配额，**不是身份认证**；真正的身份是登录 token。
- 默认只监听 `127.0.0.1`，适合“Nginx 同机反代”或 SSH 隧道管理。直连局域网必须用防火墙限制来源网段，并只在可信校园网/VLAN 使用。
- 不要把 4317 端口直接暴露到公网。公网必须使用 Nginx TLS；云服务器安全组只放行 22/80/443，**不要放行 4317**。Basic Auth 可作为第二层保护，但不是替代应用登录。
- 账号 token 默认 12 小时后过期；服务端重启会清空内存中的会话，所有人需要重新登录。
- 同一时间建议只保留一位编辑者。当前保存是整库覆盖，多人同时编辑不会自动合并。
- 备份/恢复必须包含整个 `/var/lib/warpweft`，尤其是 `users.json` 和 `solve-jobs/`。

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

如果已经在本地构建过 `dist/` 和 JAR，可以跳过重复构建：

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
  linux_server/user-cli.cjs
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

登录启用时，`verify.sh` 默认只检查 health 和页面；设置 `WARPVEFT_VERIFY_USERNAME`/`WARPVEFT_VERIFY_PASSWORD` 后会额外登录并检查 `/api/data`。

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

### 6.3 Nginx + TLS（可选 Basic Auth）

应用已有 Linux 账号登录；公网必须再加 TLS。Basic Auth 是可选的附加层，也可以改用 VPN/安全组限制来源。云服务器从零开始的完整流程见 6.5。

```bash
sudo apt install -y apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd warpweft-admin
sudo certbot --nginx -d scheduler.example.edu
```

并在 Nginx `location /` 中启用示例里的 `auth_basic` / `auth_basic_user_file`。TLS 终止在 Nginx，Node 只监听回环；服务端环境保留：

```text
WARPVEFT_TRUST_PROXY=1
```

不要让 4317 暴露在公网。Basic Auth 不能替代应用登录；是否启用取决于使用人群，课堂多人使用时通常只保留应用登录，并用 VPN 或安全组限制来源。

### 6.4 初始化管理员、登录和用户管理

安装后先创建第一位管理员（密码至少 8 位）：

```bash
sudo -u warpweft env WARPVEFT_DATA_DIR=/var/lib/warpweft \
  node /opt/warpweft/linux_server/user-cli.cjs create-admin admin
```

命令会提示输入两次密码。也可以先创建普通用户：

```bash
sudo -u warpweft env WARPVEFT_DATA_DIR=/var/lib/warpweft \
  node /opt/warpweft/linux_server/user-cli.cjs add-user teacher1
```

常用用户命令：

```bash
# 查看用户（不显示密码哈希）
sudo -u warpweft env WARPVEFT_DATA_DIR=/var/lib/warpweft \
  node /opt/warpweft/linux_server/user-cli.cjs list

# 重置密码
sudo -u warpweft env WARPVEFT_DATA_DIR=/var/lib/warpweft \
  node /opt/warpweft/linux_server/user-cli.cjs reset-password teacher1

# 禁用/启用/删除
sudo -u warpweft env WARPVEFT_DATA_DIR=/var/lib/warpweft \
  node /opt/warpweft/linux_server/user-cli.cjs disable teacher1
sudo -u warpweft env WARPVEFT_DATA_DIR=/var/lib/warpweft \
  node /opt/warpweft/linux_server/user-cli.cjs enable teacher1
sudo -u warpweft env WARPVEFT_DATA_DIR=/var/lib/warpweft \
  node /opt/warpweft/linux_server/user-cli.cjs remove teacher1
```

- 用户文件：`/var/lib/warpweft/users.json`，密码用 `scrypt` 哈希保存，文件权限 0600。
- 角色：`admin` 可管理用户；`user` 可使用排课功能但不能管理账号。
- 最后一位管理员不能被删除、禁用或降级。
- 命令执行后不需要重启服务；服务端会检测 `users.json` 变化。登录页如果没有自动刷新，点“重新检测”。
- 自动化脚本可通过 `WARPVEFT_USER_PASSWORD` 提供密码，但不要把密码写进 shell 历史或仓库。

**在 UI 中登录**：

1. 浏览器打开 `http://<服务器>/`（管理员建议加 `?mode=lan-server`）。
2. 首次会显示“登录 Linux 服务端”，输入用户名和密码。
3. 登录后 Linux 管理员进入“服务端 → 用户与密码”，可以新增用户、改角色、启用/停用、重置密码、删除用户。
4. 普通用户登录后只看到排课界面，不显示“用户与密码”。
5. Electron 客户端连接 Linux 时只显示登录框；即使账号是管理员，Electron 也不显示“用户与密码”，用户和密码只能在 Linux 服务端管理。

**验证登录**：

```bash
# health 是公开接口
curl -fsS http://127.0.0.1:4317/api/health

# 带账号检查数据接口（生产请使用不进入 shell 历史的方式）
curl -fsS -X POST http://127.0.0.1:4317/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"你的密码"}'

# verify.sh 也支持同一组变量
WARPVEFT_VERIFY_USERNAME=admin WARPVEFT_VERIFY_PASSWORD='你的密码' \
  bash /opt/warpweft/linux_server/verify.sh
```

登录返回的 `token` 用于后续请求：

```bash
curl -fsS http://127.0.0.1:4317/api/data \
  -H "Authorization: Bearer <token>"
```

> 密码不要直接写在命令行历史里；上面的 JSON 只是示例，生产请用交互式 CLI 或受保护的脚本变量。

### 6.5 云服务器（公网）部署

云服务器和局域网服务器运行的是同一套程序，安装包也相同；差别在公网入口：安全组、域名、TLS、备份，以及卸载后还要清理云上资源。下面以 Ubuntu 22.04/24.04 的腾讯云 CVM、阿里云 ECS 等为例。

#### 6.5.1 推荐拓扑

```text
用户浏览器
  │ HTTPS 443
  ▼
云安全组（只放行 22/80/443）
  ▼
Nginx（TLS 终止、同源反向代理）
  ▼ 127.0.0.1:4317
Node.js + Java Solver + /var/lib/warpweft
```

- 公网只暴露 Nginx 的 80/443；Node 继续只监听 `127.0.0.1:4317`。
- 不要用 `http://<公网IP>:4317` 直接访问，也不要把 4317 加进安全组。
- 正式使用必须 HTTPS。HTTP 只用于跳转和证书签发，不能让用户在明文页面输入密码。
- 单机部署已经够用。若前面再加云负载均衡/CDN，需要额外配置真实客户端 IP，见 6.5.6。

#### 6.5.2 安全组与系统防火墙

先在云控制台配置**入站规则**（腾讯云：云服务器 → 安全组；阿里云：ECS → 安全组）：

| 类型 | 端口 | 来源 | 用途 |
| --- | --- | --- | --- |
| SSH | 22 | 你的固定办公/校园出口 IP，或跳板机 | 远程管理 |
| HTTP | 80 | `0.0.0.0/0`、`::/0` | 跳转 HTTPS、证书续期 |
| HTTPS | 443 | `0.0.0.0/0`、`::/0` | 业务访问 |

如果 SSH 改过端口，按实际端口放行；不要为了省事把 22 或 4317 直接对全网开放。

**不要添加 4317 的入站规则。** 安全组是云平台层防火墙，Ubuntu 的 `ufw` 是系统层防火墙；两层都放行才能访问，只改一层不够。

在服务器上启用 `ufw` 时，务必先放行 SSH，再启用，避免把自己关在门外：

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

确认 Node 只绑定回环地址：

```bash
ss -ltnp | grep 4317
# 期望：127.0.0.1:4317；如果是 0.0.0.0:4317 或 [::]:4317，先停服务排查
```

如果显示的是 `0.0.0.0:4317`，说明监听地址被改成了局域网/公网。检查 `/etc/warpweft/warpweft.env` 是否有 `WARPVEFT_HOST`，以及 `/var/lib/warpweft/server-config.json` 的 `bindAddress`，改回仅本机后重启。

#### 6.5.3 上传、安装与初始化

如果云主机是新系统，先安装运行时（已有 Node 20+/Java 21 可跳过）：

```bash
sudo apt update
sudo apt install -y curl ca-certificates tar openjdk-21-jre-headless nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
java -version
```

> 1 GB 内存的入门机型建议先加 2 GB swap，或直接选择 2 GB 以上内存；Java Solver 默认需要约 512 MB 堆。

在本地构建机上传部署包和校验文件：

```bash
scp dist/linux-server/warpweft-linux-server-<版本>.tar.gz \
    dist/linux-server/warpweft-linux-server-<版本>.tar.gz.sha256 \
    user@<公网IP>:/tmp/
```

如果本地是 Windows PowerShell，`scp` 语法相同；使用密钥时加上 `-i C:\path\to\key.pem`。云主机默认用户通常是 `ubuntu`，不是 `root`，所以安装命令要加 `sudo`。

在服务器上校验并安装：

```bash
cd /tmp
sha256sum -c warpweft-linux-server-<版本>.tar.gz.sha256
tar -xzf warpweft-linux-server-<版本>.tar.gz
cd warpweft
sudo bash linux_server/install.sh
```

安装脚本默认让服务只监听 `127.0.0.1:4317`。先确认本机健康，再配置 Nginx：

```bash
systemctl status warpweft --no-pager
curl -fsS http://127.0.0.1:4317/api/health
```

创建第一位管理员（密码至少 8 位，按提示输入两次）：

```bash
sudo -u warpweft env WARPVEFT_DATA_DIR=/var/lib/warpweft \
  node /opt/warpweft/linux_server/user-cli.cjs create-admin admin
```

此时公网还不能访问，这是正常的；下一步配置域名和 Nginx。

#### 6.5.4 域名解析与 Nginx

在 DNS 服务商添加 A 记录：

```text
scheduler.example.edu.    A    <云服务器公网IP>
```

如果服务器有固定 IPv6，再添加 AAAA；没有就不要添加，避免浏览器优先走不通的 IPv6。

> 中国大陆节点的域名解析到公网并提供网站服务，一般需要完成 ICP 备案；未备案可能被云厂商拦截。没有备案域名时，建议先用 SSH 隧道管理（见 6.2），不要把公网 IP 的明文 HTTP 当作正式入口。香港/海外节点通常不受此限制，但仍必须配置 HTTPS。

复制 Nginx 示例并改成自己的域名：

```bash
sudo cp /opt/warpweft/linux_server/nginx.conf.example /etc/nginx/conf.d/warpweft.conf
sudo nano /etc/nginx/conf.d/warpweft.conf
```

把 `server_name _;` 改成：

```nginx
server_name scheduler.example.edu;
```

检查并加载：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

此时用 `http://scheduler.example.edu/` 应能打开登录页。**在配置 HTTPS 之前不要录入真实密码**，先用临时测试账号或直接进入下一步。

申请 Let's Encrypt 证书并强制跳转 HTTPS：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d scheduler.example.edu --redirect
sudo certbot renew --dry-run
```

`certbot` 会自动修改 Nginx 配置、申请证书并加入续期定时器。确认续期任务存在：

```bash
systemctl list-timers | grep -i certbot
```

如果前面还有云负载均衡/WAF/CDN，不要直接把 443 暴露给公网；应让负载均衡终止 TLS，回源只允许负载均衡网段，并按 6.5.6 配置真实 IP。

可选的双层保护（不是应用登录的替代品）：

```bash
sudo apt install -y apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd warpweft-admin
```

然后在 Nginx 的 `location /` 中启用示例里的 `auth_basic` 和 `auth_basic_user_file`，执行 `sudo nginx -t && sudo systemctl reload nginx`。这会让所有访问者先弹一次浏览器认证框；课堂多人使用时通常只保留应用登录即可，或用 VPN/安全组限制来源。

#### 6.5.5 云上验收

从云主机**外部**（你的电脑）检查：

```bash
# 1. HTTP 应跳转到 HTTPS（启用 certbot --redirect 后）
curl -I http://scheduler.example.edu/

# 2. HTTPS 应返回 200，证书链正常
curl -I https://scheduler.example.edu/

# 3. 4317 从公网必须不可达（超时或拒绝）
curl -m 5 http://<公网IP>:4317/
```

在云主机上检查：

```bash
ss -ltnp | grep 4317          # 只应是 127.0.0.1:4317
sudo ufw status verbose       # 只放行 22/80/443
systemctl is-active warpweft
WARPVEFT_VERIFY_USERNAME=admin WARPVEFT_VERIFY_PASSWORD='你的密码' \
  bash /opt/warpweft/linux_server/verify.sh
```

浏览器打开 `https://scheduler.example.edu/?mode=lan-server`，完成登录、用户管理、一次真实短时排课和一次长时任务。Electron 客户端连接同一个 HTTPS 地址时只显示登录框，不显示“用户与密码”，这是预期行为。

证书检查：

```bash
echo | openssl s_client -connect scheduler.example.edu:443 \
  -servername scheduler.example.edu 2>/dev/null | openssl x509 -noout -dates
```

#### 6.5.6 云上备份、更新与真实 IP

**备份**：云硬盘快照只能保证磁盘层面可回滚，不等于应用一致备份。至少每天做一次应用备份，并复制到对象存储或另一台机器：

```bash
sudo systemctl stop warpweft
sudo tar -czf /root/warpweft-$(date +%F-%H%M).tar.gz -C /var/lib warpweft
sudo chmod 600 /root/warpweft-*.tar.gz
sudo systemctl start warpweft
```

备份包含 `users.json`（密码哈希）和全部课表数据，必须限制权限并加密传输；不要放在公开的 Web 目录。恢复步骤见 8.3。

**系统更新**：定期执行 `sudo apt update && sudo apt upgrade`，关注 Node/Java 安全更新；重启前先确认长时任务状态。生产环境建议开启 `unattended-upgrades`，并只允许密钥登录 SSH。

**云负载均衡/CDN 的真实 IP**：本指南的 Nginx 示例只信任同机回环代理。若前面还有 CLB/ALB/WAF/CDN，Nginx 看到的 `$remote_addr` 是上一跳地址，必须在 Nginx 中显式信任回源网段，例如：

```nginx
set_real_ip_from 10.0.0.0/8;
real_ip_header X-Forwarded-For;
real_ip_recursive on;
```

只填写云厂商实际回源网段，不要写 `0.0.0.0/0`。否则所有客户端会显示成同一个 IP，登录限流和“允许网段”都会误判。

> 云服务器更换公网 IP 后，要同步修改 DNS 解析、安全组和 Electron/浏览器里保存的服务地址；否则会表现为“昨天还能登录，今天连接超时”。

## 7. 配置项

### 7.1 systemd 环境文件

编辑 `/etc/warpweft/warpweft.env` 后执行：

```bash
sudo systemctl restart warpweft
```

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `WARPVEFT_PORT` | `4317` | HTTP 端口，修改后同步 Nginx/防火墙。 |
| `WARPVEFT_DATA_DIR` | `/var/lib/warpweft` | 工作区、服务端配置、用户文件和长时任务目录；必须可写。 |
| `WARPVEFT_AUTH` | `1` | Linux 端启用账号登录；生产不要设为 0。Electron 桌面版不读取此变量。 |
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
- 允许网段（IPv4 CIDR，留空表示全部允许）；
- **用户与密码**（仅 Linux 管理员；可新增用户、改角色、启用/停用、重置密码、删除；Electron 客户端不显示此区域）。

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

### 8.0 常用命令速查

服务管理：

```bash
sudo systemctl start warpweft      # 启动
sudo systemctl stop warpweft       # 停止
sudo systemctl restart warpweft    # 重启（改环境文件后）
sudo systemctl status warpweft     # 状态
sudo systemctl enable warpweft     # 开机自启
sudo systemctl disable warpweft    # 取消自启
```

日志与健康：

```bash
journalctl -u warpweft -n 80 --no-pager
journalctl -u warpweft -f
curl -fsS http://127.0.0.1:4317/api/health
bash /opt/warpweft/linux_server/verify.sh
```

账号（Linux 专用；详见 6.4）：

```bash
sudo -u warpweft env WARPVEFT_DATA_DIR=/var/lib/warpweft \
  node /opt/warpweft/linux_server/user-cli.cjs list
sudo -u warpweft env WARPVEFT_DATA_DIR=/var/lib/warpweft \
  node /opt/warpweft/linux_server/user-cli.cjs reset-password teacher1
```

网络与 Nginx：

```bash
ss -ltnp | grep 4317
sudo nginx -t
sudo systemctl reload nginx
sudo ufw status
```

数据目录：

```bash
sudo ls -lah /var/lib/warpweft
sudo ls -lah /var/lib/warpweft/solve-jobs
```

### 8.1 健康检查

```bash
curl -fsS http://127.0.0.1:4317/api/health
bash /opt/warpweft/linux_server/verify.sh
```

`verify.sh` 会检查 Node、Java、健康接口和首页；设置 `WARPVEFT_VERIFY_USERNAME`/`WARPVEFT_VERIFY_PASSWORD` 后会登录并检查数据接口；任一项失败返回非 0。

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
sudo chmod 600 /var/backups/warpweft-*.tar.gz
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
- `/var/lib/warpweft/users.json`
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

先明确两种卸载方式，避免误删数据：

- **普通卸载**：删除程序和 systemd 服务，保留 `/var/lib/warpweft` 与 `/etc/warpweft`，适合迁移、重装或暂时停用。
- **彻底卸载**：在普通卸载基础上删除数据、环境文件和 `warpweft` 系统用户，**不可恢复**。

> 如果只是升级，不要卸载，直接按 8.4 覆盖安装。覆盖安装会保留数据与环境文件。

#### 8.5.1 保留数据卸载（推荐先做）

```bash
sudo bash /opt/warpweft/linux_server/uninstall.sh
```

脚本会：

1. 停止并禁用 `warpweft.service`；
2. 删除 `/etc/systemd/system/warpweft.service` 并执行 `daemon-reload`；
3. 删除 `/opt/warpweft`；
4. **保留** `/var/lib/warpweft`（课表、用户、长时任务）；
5. **保留** `/etc/warpweft/warpweft.env`（端口、数据目录等配置）。

检查：

```bash
systemctl status warpweft --no-pager || true
test ! -d /opt/warpweft && echo "/opt/warpweft removed"
sudo ls -lah /var/lib/warpweft
sudo ls -lah /etc/warpweft
```

之后重新解压安装包并执行 `sudo bash linux_server/install.sh`，原有账号、课表和环境配置都会继续使用。服务重启后旧登录会话失效，需要重新登录，但账号仍在 `users.json` 中。

#### 8.5.2 彻底卸载（删除数据）

> **不可恢复。** 执行前先备份，并确认没有其他程序依赖这些数据。

先做最后一份备份：

```bash
sudo systemctl stop warpweft
sudo tar -czf /root/warpweft-final-$(date +%F-%H%M).tar.gz -C /var/lib warpweft
sudo chmod 600 /root/warpweft-final-*.tar.gz
sudo systemctl start warpweft
```

备份文件包含密码哈希和全部课表，权限应保持 `600`，确认后再执行：

```bash
sudo bash /opt/warpweft/linux_server/uninstall.sh --purge-data
```

脚本除了 8.5.1 的动作，还会删除：

- `/var/lib/warpweft`（工作区、`users.json`、`server-config.json`、`solve-jobs/`）；
- `/etc/warpweft`（`warpweft.env`）；
- 系统用户 `warpweft`。

检查：

```bash
systemctl status warpweft --no-pager || true
test ! -e /opt/warpweft && echo "/opt/warpweft removed"
test ! -e /var/lib/warpweft && echo "/var/lib/warpweft removed"
test ! -e /etc/warpweft && echo "/etc/warpweft removed"
id warpweft 2>/dev/null || echo "warpweft user removed"
ss -ltnp | grep 4317 || echo "port 4317 not listening"
```

如果 `/opt/warpweft` 已经被手工删除，`uninstall.sh` 也就不存在了，可按下面的命令手工清理：

```bash
# 1. 停止并移除服务
sudo systemctl stop warpweft 2>/dev/null || true
sudo systemctl disable warpweft 2>/dev/null || true
sudo rm -f /etc/systemd/system/warpweft.service
sudo systemctl daemon-reload

# 2. 删除程序和 systemd 单元
sudo rm -rf /opt/warpweft

# 3. 仅在确认不再需要数据时执行
sudo rm -rf /var/lib/warpweft /etc/warpweft
sudo userdel warpweft 2>/dev/null || true
```

#### 8.5.3 云服务器额外清理

`uninstall.sh` 只管理应用自身，**不会**删除 Nginx 配置、TLS 证书、安全组规则、DNS 记录和云备份。云服务器按下面顺序清理：

**1. 移除 Nginx 站点**

```bash
sudo ls -l /etc/nginx/conf.d/warpweft.conf 2>/dev/null || true
sudo rm -f /etc/nginx/conf.d/warpweft.conf

# 如果当初放在 sites-available/sites-enabled
sudo rm -f /etc/nginx/sites-enabled/warpweft /etc/nginx/sites-available/warpweft

sudo nginx -t
sudo systemctl reload nginx
```

如果这台 Nginx 只服务 WarpWeft，才考虑停止或卸载 Nginx；否则保留，避免影响同机其他站点。

**2. 删除 Basic Auth 文件（如果启用过）**

```bash
sudo rm -f /etc/nginx/.htpasswd
```

**3. 删除 TLS 证书**

先确认证书没有被其他站点共用：

```bash
sudo certbot certificates
sudo certbot delete --cert-name scheduler.example.edu
```

`certbot delete` 会删除证书和续期配置；若同一张证书还用于其他域名/站点，不要删除。

**4. 关闭云安全组端口**

到云控制台删除 80、443 的入站规则，只保留受限来源的 22。**这一步无法用服务器内命令完成**，必须操作云平台安全组。

**5. 删除 DNS 记录**

删除 `scheduler.example.edu` 的 A/AAAA 记录，避免域名继续解析到已释放的服务器 IP。

**6. 收紧系统防火墙**

```bash
sudo ufw status numbered
sudo ufw delete allow 80/tcp
sudo ufw delete allow 443/tcp
```

不要删除 OpenSSH 规则，除非你确认已能通过其他方式登录。如果整台服务器都要释放，按云厂商流程退订/销毁实例即可，不必单独关闭 22。

**7. 清理备份、快照和临时文件**

```bash
# 只在确认不再需要时删除
sudo rm -f /root/warpweft-*.tar.gz
sudo rm -rf /tmp/warpweft /tmp/warpweft-linux-server-*.tar.gz
```

同时到云控制台删除该实例的自动快照、手动快照和对象存储中的备份。备份含 `users.json` 密码哈希和完整课表，不能当普通临时文件丢弃。

**8. 保留系统日志**

`journalctl` 中的服务日志属于系统日志，不建议为了卸载应用而清空全局 journal；如需缩短保留期，按服务器整体日志策略处理，而不是只删 `warpweft`。

#### 8.5.4 卸载检查清单

```bash
echo '--- service ---'
systemctl is-active warpweft 2>/dev/null || true
systemctl is-enabled warpweft 2>/dev/null || true
test -e /etc/systemd/system/warpweft.service && echo 'unit still exists'

echo '--- files ---'
test -e /opt/warpweft && echo '/opt/warpweft still exists'
test -e /var/lib/warpweft && echo '/var/lib/warpweft still exists'
test -e /etc/warpweft && echo '/etc/warpweft still exists'

echo '--- user/port ---'
id warpweft 2>/dev/null || true
ss -ltnp | grep 4317 || true

echo '--- nginx ---'
sudo nginx -T 2>/dev/null | grep -i warpweft || true
```

各项归属：

| 内容 | 普通卸载 | `--purge-data` | 备注 |
| --- | --- | --- | --- |
| systemd 单元 | 删除 | 删除 | `uninstall.sh` |
| `/opt/warpweft` | 删除 | 删除 | 程序 |
| `/var/lib/warpweft` | **保留** | 删除 | 课表、用户、长时任务 |
| `/etc/warpweft` | **保留** | 删除 | 环境文件 |
| `warpweft` 用户 | **保留** | 删除 | 系统用户 |
| Nginx 配置 | 不处理 | 不处理 | 手工删除 |
| `.htpasswd` | 不处理 | 不处理 | 手工删除 |
| TLS 证书 | 不处理 | 不处理 | `certbot delete` |
| 安全组 80/443 | 不处理 | 不处理 | 云控制台 |
| DNS 记录 | 不处理 | 不处理 | DNS 服务商 |
| 备份/快照 | 不处理 | 不处理 | 含敏感数据 |
| journal 日志 | 保留 | 保留 | 系统日志 |

## 9. 故障排查

| 现象 | 检查/处理 |
| --- | --- |
| 页面能打开但一直显示未连接 | 确认页面与 API 同源；清除站点 localStorage 中旧的 `warpweft-runtime-endpoint`；检查浏览器控制台请求地址是否仍是客户端 127.0.0.1。 |
| Nginx 502 | `systemctl status warpweft`；`curl 127.0.0.1:4317/api/health`；确认 Nginx upstream 端口。 |
| 云服务器公网打不开，服务器内 `curl 127.0.0.1` 正常 | 安全组未放行 80/443、`ufw` 未放行、Nginx 未启动或 `server_name` 不匹配；依次查控制台安全组、`sudo ufw status`、`sudo ss -ltnp`（确认 80/443 在监听）、`sudo nginx -t`。 |
| 公网 `http://IP:4317` 能打开 | 高危：Node 绑定到了 0.0.0.0，或安全组放行了 4317；立即停服务，修正 `WARPVEFT_HOST`/`bindAddress`，并删除安全组 4317 规则。 |
| certbot 申请证书失败 | 域名未解析到本机、80 被安全组/ufw 拦截、域名未备案，或 Nginx `server_name` 不匹配；先 `dig +short 域名`，再从外部访问 80。 |
| 域名打开的是别的网站 | Nginx 有默认站点抢占，或 `server_name` 没改；检查 `sudo nginx -T` 中的 `server_name` 和 `default_server`。 |
| 所有客户端显示同一 IP / 登录 429 集中出现 | 前面有 CLB/WAF/CDN 但未恢复真实 IP；按 6.5.6 设置 `set_real_ip_from`/`real_ip_header`，只信任云厂商回源网段。 |
| 云主机换 IP 后无法访问 | 更新 DNS A 记录、安全组、Electron/浏览器保存的服务地址；用 `dig +short 域名` 确认解析到新 IP。 |
| 卸载后仍能打开旧页面 | 服务已删但 Nginx 仍在反代/缓存，或 DNS 仍指向旧机；按 8.5.3 删除站点和 DNS，检查 `nginx -T`、`ss -ltnp`。 |
| 服务启动即退出 | `journalctl -u warpweft -n 80`；检查 `WARPVEFT_DATA_DIR` 权限、端口占用、Node 版本。 |
| `EADDRINUSE` | `sudo ss -ltnp` 查看 4317 的占用进程；停止冲突进程或改 `WARPVEFT_PORT`。 |
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
| 登录页一直显示“尚未初始化管理员” | 运行 `user-cli.cjs create-admin`；确认 `WARPVEFT_DATA_DIR` 与 service 一致；刷新/重新检测。 |
| 用户名密码正确但 401 | 确认账号未禁用；确认登录的是当前 Linux 服务地址；看 `journalctl -u warpweft` 的“登录失败”日志。 |
| 登录尝试过多 429 | 同一 IP/用户 5 次失败后限流 5 分钟；等待或从服务端排查账号。 |
| 管理员看不到“用户与密码” | 确认账号 role=admin；确认页面来自 Linux 服务端而不是 Electron；Electron 客户端永远不显示用户管理。 |
| user-cli 提示 Permission denied | 用 service 用户执行：`sudo -u warpweft env WARPVEFT_DATA_DIR=/var/lib/warpweft node ...`；不要用 root 直接写 `users.json`。 |
| 新建用户后登录不了 | 检查用户名/密码、角色、disabled；服务端会检测文件变化，仍不行则刷新登录页或重启服务。 |
| 删除/降级管理员被拒绝 | 至少保留一位启用状态的管理员；先创建另一位管理员。 |
| 服务重启后所有人都要重新登录 | 这是设计：会话保存在内存，12 小时过期且重启清空；账号仍在 `users.json`。 |

## 10. 验收清单

在目标 Linux 服务器执行：

```bash
# 1. 服务
systemctl is-active warpweft
journalctl -u warpweft -n 30 --no-pager

# 2. 健康与页面
curl -fsS http://127.0.0.1:4317/api/health
curl -fsS http://127.0.0.1:4317/ | head

# 3. 登录与数据读写
curl -fsS -X POST http://127.0.0.1:4317/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"你的密码"}'
# 从返回 JSON 取 token 后：
curl -fsS http://127.0.0.1:4317/api/data \
  -H "Authorization: Bearer <token>" | head -c 300

# 4. UI 与登录
# 浏览器打开 http://<服务器>/ 或 https://<域名>/
# 登录后确认首页、排课准备、排课任务、课表预览可加载

# 5. 用户管理（Linux 管理员）
# 打开“服务端 → 用户与密码”，新增一个普通用户并用它登录
# Electron 客户端登录同账号，确认看不到“用户与密码”

# 6. 真实排课
# 导入/打开工作区，启动一次短时排课，确认生成候选课表并保存

# 7. 长时任务
# 启动长时任务，暂停、继续、刷新页面后按任务 UUID 找回

# 8. 重启恢复与重新登录
sudo systemctl restart warpweft
# 长时任务应显示“已中断（可继续）”，可继续
# 会话在内存中，重启后需要重新登录；用户仍在 users.json
```

Nginx/TLS 部署还要验证：

- HTTP 自动跳 HTTPS（如启用）；
- Basic Auth 生效（如启用）；
- `X-Forwarded-For` 后客户端列表显示真实 IP；
- 大请求/长请求不被代理提前断开。

云服务器还要从**外部机器**验证：

```bash
curl -I http://scheduler.example.edu/     # 应 301 到 HTTPS
curl -I https://scheduler.example.edu/    # 应 200，证书有效
curl -m 5 http://<公网IP>:4317/           # 应超时/拒绝，不能打开
```

- 云安全组只有 22/80/443，4317 没有入站规则；
- 服务器上 `sudo ss -ltnp` 显示 4317 只绑定 `127.0.0.1`；
- `certbot renew --dry-run` 成功，证书剩余有效期大于 30 天；
- 从手机 4G/5G 等外网实际登录一次，排除只在内网可用的假象。

## 11. 已知限制

- 单工作区整库保存，没有多用户合并；多人同时编辑会互相覆盖。
- Linux 端有账号/密码和 admin/user 两种角色；没有更细粒度的权限、登录审计或 SSO。Electron 本机桌面模式不启用登录。
- 登录会话在内存中，服务端重启后需要重新登录；账号数据在 users.json。
- 同一时间只允许一个长时任务；短时任务按队列串行/并发配置执行。
- JSON 存储适合小规模；大规模并发/多租户时应迁移数据库。
- 本指南的 systemd 方案以 Ubuntu/Debian 为主；其他发行版需相应调整包名和路径。
- 云服务器章节覆盖单机 + Nginx；云负载均衡、WAF、CDN、对象存储备份和 Kubernetes 需要按云厂商文档额外配置，尤其要正确处理真实客户端 IP。
- 云硬盘快照/镜像不是应用一致备份，不能替代停服务后的 `tar` 备份；备份保留策略和加密由运维负责。
- 公网域名备案、证书续期、安全组和 DNS 属于服务器外部资源，应用卸载脚本不会自动清理，需按 8.5.3 手工处理。
- Docker 镜像不在当前版本范围内。
