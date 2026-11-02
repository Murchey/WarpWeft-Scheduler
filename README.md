# WarpWeft Scheduler

单机 / 局域网小规模排课系统。Electron + React 商务界面、本地 JSON 数据层、独立 Java 21 求解器；可选 Linux 服务端供多人共享。

- **数据留在本机**：不依赖云端，工作区是可备份的单文件 JSON / ZIP
- **规则可解释**：中文句子式规则构建器，支持影响预览与「模拟放宽」试算
- **求解可追溯**：固定时间硬保护、锁定课程、局部重排、候选与正式版分离
- **两种形态**：Windows 桌面单机；或 Linux 服务端 + 桌面客户端
- **GPLv3 开源**，允许商用与二次分发（详见文末许可证）

本文分两部分：**第一部分给使用者**（教务 / IT 运维），**第二部分给开发者**（贡献者），按需跳读。

---

# 第一部分 · 使用者

## 你能用它做什么

### 排课准备

- 排课准备工作区：左侧子导航集中管理数据导入、班级、教师、学科、教室、周时间段、教学计划、教师时间和排课规则
- Excel 导入抽屉：在排课准备右上角打开，不离开当前子页面；支持学校、班级、教师、学科、教室、时间段和教学计划
- 教师不可用时间：按教师添加 / 移除时间段，排课时自动避开；可用 Excel 模板批量导入
- 教师负责班级：教师表可多选负责班级；留空不限，自动分配教师和排课时只使用其负责班级
- 班主任：班级表可指定班主任；班主任必须在本班至少承担一节自己可教的学科（本班没有该学科时豁免），并仍可去其他班上课
- 教学计划可编辑：班级、学科、教师、周课时、教室类型、固定时间（可多选）、连堂节数、单双周配对组；支持批量选中多个班级
- 课次级固定时间：一门课可以只固定其中一节（例如 3 节书香阅读固定周五第 5 节），其余节次由求解器安排；固定时段全程硬保护
- 连堂与配对：计划可声明 2–4 节连堂；单周 / 双周两条计划填同一个「配对组」后必须落在同一时间格（如语数间周）
- 学科时段偏好：可设上午 / 下午偏好（主科上午、副科下午），作为软目标参与求解
- 周时间段模板：设置好其中一天，勾选其他星期一键复制；也可快速生成空白节次搭出整周
- 批量设置：教学计划、教师、学科均支持多选后批量修改字段
- 排课前检查：重复编码、缺失引用、班级 / 教师课时上限、教室容量、固定时间冲突

### 规则与约束

- 规则页使用句子构建器（对象 + 时间 + 程度 + 参数）；「课表偏好」用 0–5 权重表示优先级
- 规则支持影响预览、规则冲突提醒、自然语言输入和「模拟放宽」，可不保存就估算放宽一条规则能多排多少课时
- 中文规则卡片：支持必须 / 尽量 / 避免、作用范围、影响预览和未排原因
- 已接入求解器的约束族：教师每日上限、连续上限、教师半天无课、学科每日上限、学科时间偏好、避开首末节、同学科不连排、学科分散、硬性连堂 / 双节
- 软约束权重可调：学科分散、教师空档、教师工作量均衡、班级空档、学科时段偏好

### 排课、重排与任务

- 本地自动排课：Electron 主进程启动本地 API，求解器通过标准 JSON 通信
- 支持按班级 / 教师 / 规则局部重排，范围外课程保留位置；锁定课保留，剩余课时继续成对安排
- 自动分配教师：按学科 / 年级 / 负责班级匹配，并检查周课时、每日上限、可用时段
- 长时任务：可查看进度与最佳课表文件，支持暂停、继续、断线后按任务 UUID 找回
- 任务与历史：可查看 / 复制 / 定位任务数据与最佳课表文件；短时计算可查看逐节结果

### 课表查看、调代课与导出

- 周课表网格：按班级 / 教师 / 教室查看，显示课程、教师、教室和冲突
- 课表预览与调整：全屏、拖动交换、选中后点击空白格移动、显式「交换课程」模式、锁定、撤销
- 调整影响范围：调课 / 对调 / 代课 / 停课 / 改期 / 还原后显示受影响的班级、教师、节次
- 跨日对调：把所选日期的同班课程与未来不同星期的同班课程互换，支持撤销与审计
- 一键导出 Excel / CSV / 打印课表；批量导出全部班级 / 教师课表，可合并为一个多工作表文件或每张课表独立文件
- 课表导出排版：按单元格内容自动加高行、加宽星期列，隐藏没有课的日子
- 沉浸模式：隐藏工具栏与页头只保留课表网格，Esc 退出
- 候选与正式版：自动保存候选，可保存为正式版；每次发布保留可追溯的版本 ID、时间和课时数量

### 界面与数据

- 深色 / 浅色 / 跟随系统主题
- 中英双语界面，语言与主题偏好在官网与应用之间共享
- 简化模式 / 完整模式：简化模式默认每班一间自动固定教室；完整模式保留教室容量、类型与冲突排课

## 快速开始

### Windows 桌面版（推荐单机使用）

1. 获取安装包 `WarpWeft Scheduler Setup <版本>.exe` 并安装
2. 安装 **Java 21 运行时**（Oracle JDK 21、Microsoft Build of OpenJDK 21、Eclipse Temurin 21 均可）
3. 启动后选择运行模式：**单机**（推荐）、局域网服务端、局域网客户端或云端
4. 在「排课准备 → 数据导入」导入 Excel，或手工录入
5. 切到「排课任务」发起排课，完成后在「课表预览」查看与导出

> 从源码构建见第二部分。

### Linux 服务端（多人共享）

Linux 服务端只做三件事：**产品官网、运行状态监控、供桌面客户端调用的 API 运算**。它**不提供网页版排课界面**——排课、导入、调代课等全部功能在桌面客户端完成。

| 路径 | 内容 | 是否需要登录 |
| --- | --- | --- |
| `/` | 产品介绍官网（公开） | 否 |
| `/site/` | 官网资源（含运行状态面板） | 否 |
| `/api/` | 后端接口 | 是（`/api/health`、`/api/auth/login` 除外） |
| `/app/` | 不提供，返回 404 | — |

部署要点：

1. 上传部署包并安装：`sudo bash linux_server/install.sh`
2. 复制 Nginx 示例，**只改一行 `server_name`**：`sudo cp /opt/warpweft/linux_server/nginx.conf.example /etc/nginx/conf.d/warpweft.conf`
3. 创建账号：`sudo warpweft user add admin --admin`，普通用户用 `sudo warpweft user add <用户名>`
4. 公网部署必须启用 TLS：`sudo certbot --nginx -d <你的域名> --redirect`
5. 验证：`sudo bash /opt/warpweft/linux_server/verify.sh`

完整安装、TLS、备份、升级、卸载与排障见 **[guideline.md](guideline.md)**。

### 官网运行状态面板

官网的「运行状态」区块可登录账号查看：

- **管理员**：CPU / 内存 / 运行时长 / 求解器状态、任务队列、运行中与已完成任务、求解日志、已连接电脑列表、服务端限额（可改）
- **普通用户（教师）**：同上的负载与任务，但**看不到内网 IP、监听地址、求解器路径**，日志在服务端脱敏

「未启用账号登录」提示表示服务器把 `WARPVEFT_AUTH` 设成了 `0`；改回 `1` 并重启即可出现登录框。

### 自定义官网信息（备案号 / 公告 / 私有实例）

编辑 `/opt/warpweft/dist/site/site-config.json`，**改完刷新即生效，无需重新构建或重启**：

~~~json
{
  "privateInstance": true,
  "announcement": "本周六 22:00 起服务器维护，预计 2 小时。",
  "icp": "京ICP备00000000号-1",
  "police": ""
}
~~~

| 字段 | 作用 |
| --- | --- |
| `privateInstance` | `true` 时顶部常驻提示「这是用户私有配置的页面，非开发者官方网页」（只认严格 `true`） |
| `announcement` | 顶部横幅公告，空串不显示；超 300 字截断 |
| `icp` | 页脚 ICP 备案号，自动链 beian.miit.gov.cn |
| `police` | 页脚公安备案号（预留） |

⚠️ 该文件位于 `dist/` 内，**升级安装包时会被覆盖**，升级前请备份。完整说明见 guideline.md 6.1.2。

## 试用数据

`tests/test_data/` 提供 Excel 数据集与导入模板：

- `基础数据-小规模.xlsx`：2 个班级、3 位教师、2 间教室、15 个时间段、18 课时
- `完整周数据.xlsx`：4 个班级、7 位教师、5 间教室、20 个时间段、60 课时
- `异常数据-教室容量不足.xlsx`：用于验证容量校验
- `导入模板.xlsx`、横向 / 纵向课表模板

在「排课准备 → 数据导入」抽屉选择 .xlsx；勾选「导入前清空当前工作区」可得到与数据集一致的数据。

## 许可证

本项目以 **GNU General Public License v3.0** 发布，全文见 [LICENSE](LICENSE)。

你可以自由使用、修改和分发本软件（含商用）；但分发修改版时必须同样以 GPLv3 开源并提供对应源代码。软件按「现状」提供，不附带任何担保。应用内「设置 → 关于 → 许可证」显示的就是这一条款。

---

# 第二部分 · 开发者

## 仓库结构

~~~text
apps/renderer/src/     React 渲染层（Electron 与浏览器共用）
apps/desktop/          Electron 主进程与 preload
server/api/            Node HTTP API（Windows 与 Linux 共用，改后必须重打 Linux 包）
linux_server/          Linux 入口、systemd 单元、安装/卸载/验证脚本、Nginx 示例
services/solver-java/  Java 21 求解器（贪心 + 随机重启 + 局部搜索）
server/fullsolver/     规则冲突分析（MUS / 最小势冲突集），仅经 JSON 与求解器通信
packages/              contracts（协议）、constraints、validation、adjustments、import-export、theme、inspection
website/               产品官网（独立 Vite 入口，base 固定 /site/）
data-schema.json       工作区数据 schema
docs/                  设计与改造文档
tests/                 node --test 用例与 Excel 测试数据
~~~

## 本地开发

~~~powershell
npm install
~~~

Windows 推荐用 `run_dev.bat` 按编号选调试模式：

~~~powershell
run_dev.bat 1   # Electron 桌面调试（推荐）
run_dev.bat 2   # 浏览器调试（本机 API，自动打开浏览器）
run_dev.bat 3   # 局域网服务端调试（API/Vite 监听 0.0.0.0）
run_dev.bat 4   # 浏览器调试（不自动打开）
~~~

或直接启动 Electron（会先构建 Solver、启动 Vite，再启动 Electron）：

~~~powershell
npm run dev:electron
~~~

分步调试（只调 API 或只调渲染层）：

~~~powershell
npm run dev:api   # 终端 1：本地 API + Solver
npm run dev       # 终端 2：Vite 界面
~~~

构建后直接运行桌面端：

~~~powershell
npm run build
npm run desktop
~~~

**环境要求**：Java 21（`JAVA_HOME` 或 PATH 中的 `java`）。运行安装版只需 JRE 21；构建 jar 需要 JDK（含 javac）。首次构建会自动获取 Jackson 依赖到 `services/solver-java/lib`（该目录不入版本库）。

常见问题：

- `Electron failed to install correctly`：二进制下载不完整，运行 `npm run fix:electron` 修复（走 Electron 镜像）。
- `ELECTRON_RUN_AS_NODE=1`（某些 IDE / 终端会设置）：Electron 会当普通 Node 跑并报 `ipcMain` 未定义。手动启动前先 `set ELECTRON_RUN_AS_NODE=`；`npm run dev:electron` 已自动清除。

## Java 求解器

生产求解器为 `services/solver-java`，要求 Java 21。它用贪心 + 随机重启 + 局部搜索生成可行课表，支持班级 / 教师 / 教室冲突、教室容量与类型、固定时间、教师不可用时间、教师负责班级、班主任本班课约束、锁定课程、自习 / 课后服务类型和班级空档软约束；完整 / 简化模式由 roomMode 控制。

源码按四个包组织：`model`（Slot/Room/Plan/Entry/Task/Placement/SolverData）、`rules`（Rule + 硬规则可行性 + 规则罚分）、`engine`（State + 搜索）、`protocol`（JSON 解析与结果构造）；入口 `WarpWeftSolver` 只转发 stdin/stdout。输入输出协议见 `packages/contracts/src.ts`。

~~~powershell
npm run build:solver    # 构建求解器 jar
npm run solver          # 直接跑一次 jar
~~~

规则冲突分析在 `server/fullsolver/`：以本求解器为可行性判定器，输出不可约冲突集（MUS）或最小势冲突集，两者仅通过 solver input/output JSON 通信。

## 数据层

- 开发模式数据文件：`data/warpweft.json`；安装版：Electron 的 `userData/warpweft.json`
- 首次启动创建空工作区，不注入演示数据；`database/seeds/demo.json` 仅供 Solver 自动化测试
- Electron 33 自带的 Node 20 不含 `node:sqlite`，因此当前用单文件 JSON 存储；数据访问层保留 `read()/write()` 形态，后续可换 SQLite 适配器
- 多工程：`data/warpweft.json` 永远是活动工作区，切换工程 = 把快照写入它；工程库在 `data/projects/`
- 服务端默认监听 `127.0.0.1`；Linux 局域网部署建议经 Nginx 反代

## 服务端与 API

- HTTP API 位于 `server/api/`，Windows 与 Linux 共用；`/api/health` 返回 `schemaVersion`、`appVersion`、`solverProtocol` 与 `capabilities`，客户端与服务端数据版本不一致时会阻断保存 / 排课并提示升级
- **Linux 服务端默认启用账号登录**：除 `/api/health` 与 `/api/auth/login` 外，API 需要 Bearer token；Electron 桌面版不启用登录
- 监控只读接口（`/api/server/{overview,stats,logs,clients}`）对所有已登录账号开放，但非管理员拿的是脱敏视图（无内网 IP、监听地址、求解器路径，日志在服务端脱敏）
- 写操作（`PUT /api/server/config`、断开客户端）仅限管理员
- **桌面端「服务端」页**（运行模式选「局域网服务端」时出现）：CPU / 内存、Java 求解器状态、局域网共享限额（监听模式、连接电脑数、并发求解数、队列容量、任务超时、网段白名单）、已连接电脑、任务队列与实时求解日志
- **用户管理仅 `admin` 角色可见**：新增用户、改角色、启用 / 停用、重置密码、删除；Electron 客户端不显示用户管理，账号也可用 `sudo warpweft user add / passwd / list / disable` 在服务器上管理；最后一位管理员不能删除、禁用或降级

## 测试

~~~powershell
npm test              # node --test，覆盖 API / 求解器 / 导入导出 / 打包
npm run validate      # 演示数据校验
~~~

改后端（`server/api/`）后**必须重打 Linux 包**，否则 `verify.sh` 的清单哈希比对会失败。

## 打包与发布

~~~powershell
npm run dist:win      # Windows 安装包 + 免安装应用（等同 build_appliction.bat 选项 1）
npm run dist:linux    # Linux 服务端部署包 tar.gz + SHA256
~~~

产物按目标分目录存放，**互不覆盖**：

~~~text
dist/
├── index.html、assets/、icon.svg   应用渲染层（Electron 与 Linux 包共用）
├── site/                           官网产物
├── linux/                          Linux 服务端部署包（tar.gz + SHA256）
└── windows/                        Windows 安装包 + win-unpacked/
~~~

- `dist/windows/`：`WarpWeft Scheduler Setup <版本>.exe`、`win-unpacked/`
- `dist/linux/`：`warpweft-linux-server-<版本>.tar.gz` 与 `.sha256`

**构建不会互相覆盖**：`npm run build` 只清理应用自身产物（`scripts/clean-app-dist.cjs`），不动 `dist/site`、`dist/linux`、`dist/windows`；因此先打 Linux 还是先打 Windows 都行。`electron-builder` 的 `files` 已排除这三个目录，打包产物不会被递归装进安装包。

Linux 部署包自带 Node 侧全部依赖、Java 求解器、systemd 单元、安装 / 卸载 / 验证脚本、Nginx 示例，**以及产品官网静态站点（dist/site，含 site-config.json）**，服务器上**不需要 npm install，也不需要 Electron**，装完即可直接访问官网与运行状态面板。构建脚本会对站点文件做硬断言，缺任何一个都不产出包。安装后 `verify.sh` 会核对运行中服务与安装包清单（版本、schema、capabilities、资源哈希），避免 UI 与 API 版本漂移。

## 官网（website/）

官网是独立于应用的 Vite 入口：

~~~powershell
npm run dev:site      # 本地预览 http://127.0.0.1:5174/site/
npm run build:site    # 产出 dist/site/（应用仍是 npm run build，产出 dist/）
~~~

**两条构建的顺序不再受限**：早期应用构建会清空整个 `dist/`，现在 `emptyOutDir` 已关闭、改由 `clean-app-dist.cjs` 精确清理，先建应用还是先建官网都可以。`npm run dist:linux` 内部仍按「应用 → 官网」串行执行。`npm run build:site` 只清空自己的 `dist/site/`。

约定（踩过的坑）：

- 官网 `base` 固定为 `/site/`，**不能改成 `./`**——否则官网资源解析成 `/assets/*`，与应用 bundle 抢同一 URL 前缀，Nginx 无法分流。
- 官网配色复用 `packages/theme/tokens.css`，与 `apps/renderer/src/style.css` 实际生效令牌由 `tests/design-tokens.test.cjs` 守护漂移。
- 官网语言与主题偏好跟应用共用 `warpweft-locale` / `warpweft-theme`，一处切换两处生效。
- 新增官网截图放 `website/src/images/`。**不要新建名为 `shots/` 或 `screenshots/` 的目录**：`.gitignore` 的这两条是非锚定目录模式，任何层级同名目录都会被忽略，截图会静默不进版本库。提交前用 `git check-ignore -v website/src/images/*.png` 自检（应无输出）。
- 站点可构建期注入下载链接与规范地址：`VITE_DOWNLOAD_URL`、`VITE_SITE_ORIGIN`；未注入时不渲染下载按钮、不输出 canonical，避免死链。
- 官网移动端为响应式布局，断点 860 / 640 / 480 / 360px，截图灯箱支持左右滑动切换与下滑关闭。

## 设计与改造文档

- [排课约束与准备流程改造设计](docs/constraint-ux-redesign.md)
- [局域网服务端说明](docs/lan-server.md)
- [Linux 服务端与本地功能对照](docs/linux-server-parity.md)
- [多工程文件体系](docs/projects.md)
- [教学计划表格与放大预览](docs/plan-table-ux.md)
- [算法模型升级记录](docs/algorithm-model-upgrade-2026-10-25.md)
