# WarpWeft Scheduler

单机/局域网小规模排课 MVP：Electron/React + HeroUI 商务界面、本地 JSON 数据层、独立 Java 21 Solver。

## 已实现

- 排课准备工作区：左侧子导航集中管理数据导入、班级、教师、学科、教室、周时间段、教学计划、教师时间和排课规则
- 教师不可用时间：按教师使用下拉框添加/移除时间段，排课时自动避开
- 教师负责班级：教师表可多选负责班级；留空不限，自动分配教师和排课时只使用其负责班级
- 班主任：班级表可指定班主任；班主任必须在本班至少承担一节自己可教的学科（本班没有他/她所教学科时豁免），并且仍可选择去其他班上课
- 规则页使用句子构建器（对象 + 时间 + 程度 + 参数）；「课表偏好」用 0–5 权重表示优先级，0 为不启用，数字越大越优先，不承诺目标为 0
- 规则支持影响预览、规则冲突提醒、自然语言输入和“模拟放宽”，可在不保存的情况下估算放宽一条规则能多排多少课时
- 支持按班级/教师/规则局部重排，范围外课程保留位置
- 连堂支持锁定课程：锁定课保留，剩余课时继续成对安排
- 周时间段模板：设置好其中一天，勾选其他星期，一键复制当天的节次、时段类型、开始时间、时长和名称；可选择跳过或覆盖目标日已有同节次
- 快速生成空白节次：多选星期、设置节次范围，一次搭出整周时间格
- Excel 导入抽屉：在排课准备右上角打开，不离开当前子页面
- 教学计划可编辑：班级、学科、教师、周课时、教室类型、固定时间；支持批量选择多个班级，并可直接新建学科/教师
- 排课前检查：重复编码、缺失引用、班级/教师课时上限、教室容量、固定时间冲突
- 排课规则：中文规则卡片，支持必须/尽量/避免、作用范围、影响预览和未排原因；系统硬规则锁定
- 规则已接入 Java 求解器：教师每日上限、连续上限、教师半天无课、学科每日上限、学科时间偏好、避开首末节、学科分散、硬性连堂/双节
- 本地自动排课：Electron 主进程启动本地 API，Solver 通过标准 JSON 通信
- 周课表网格：按班级/教师/教室查看，显示课程、教师、教室和冲突
- 课表预览与调整：独立全宽工作区，支持全屏、班级/教师/教室视图、拖动交换、选中后点击空白格移动、显式“交换课程”模式、锁定、撤销；冲突移动会被阻止，重新排课时保留锁定课程
- 调整影响范围：调课/代课/停课/改期/还原后显示受影响的班级、教师、节次，并可在影响弹窗中查看前后日课表
- 一键导出：课表预览和调整影响面板可直接导出当前班级/教师周课表，导出设置弹窗保留给高级选项
- 剩余容量提示：预览底部显示当前视图剩余容量；排满时提示增加时间段或教师，并说明哪些操作仍可通过交换完成
- 沉浸模式：点击“隐藏工具栏”隐藏状态栏、页头、工具栏和底部说明，只保留课表网格；右下角可恢复，Esc 可退出
- 候选与正式版：自动保存候选，可保存为正式版
- 报表发布：导出 Excel、CSV、打印课表；桌面端直接保存到系统下载目录并提示路径，浏览器回退为普通下载
- 深色/浅色主题；深色模式使用低饱和黄铜色作为强调色
- 软约束权重调节：学科分散、教师空档、教师工作量均衡、班级空档；权重用 0–5 表示优先级，0 为不启用
- 任务与历史：展开可查看当前浏览器的全部长时任务；已结束任务可删除，并可查看/复制/定位任务数据与最佳课表文件
- 服务端监控页：CPU/内存、Java 求解器状态、任务队列、排队/运行/完成状态和实时求解日志
- Linux 服务端：同一套浏览器 UI + Java Solver，可独立部署为 systemd 服务；带账号登录、管理员用户管理；部署包由 `build_appliction.bat` 选项 2 或 `npm run dist:linux` 生成
- 正式版版本记录与审计日志；每次发布保留可追溯的版本 ID、时间和课时数量

## 本地运行

```powershell
npm install
```

首次打开界面会要求选择运行模式：单机、局域网服务端、局域网客户端或云端。选择会保存到当前浏览器/桌面用户配置，之后可点击顶部“运行：…”按钮修改；局域网客户端和云端需要填写服务端 API 地址。切换模式时服务地址会自动切换（单机/局域网服务端回到本机 API，云端地址单独保留），不需要手动改 IP。

Windows 可以双击 `run_dev.bat`，按编号选择调试模式；也可以直接传编号：

```powershell
run_dev.bat 1   # Electron 桌面调试（推荐）
run_dev.bat 2   # 浏览器调试（本机 API，自动打开浏览器）
run_dev.bat 3   # 局域网服务端调试（API/Vite 监听 0.0.0.0）
run_dev.bat 4   # 浏览器调试（不自动打开）
```

也可以直接用 npm 启动 Electron：

```powershell
npm run dev:electron
```

它会构建 Solver（predev:electron）、在 5173 启动 Vite、等待就绪后启动 Electron；Electron 主进程会启动本地 API。若 4317 上已有 API，脚本会复用它，不会重复启动。只想检查环境时可运行 `node scripts/dev-electron.cjs --dry-run`。

如果 `npm install` 后仍提示 `Electron failed to install correctly`，说明 Electron 二进制只下载了一半；运行 `npm run fix:electron` 修复（使用 Electron 镜像下载）。`run_dev.bat` 的模式 1 也会自动检测并修复。

某些 IDE / DSH 终端会设置 `ELECTRON_RUN_AS_NODE=1`，直接 `electron .` 时 Electron 会按普通 Node 运行并报 `ipcMain` 未定义；`npm run dev:electron` 已自动清除该变量。手动启动桌面端时，可先执行 `set ELECTRON_RUN_AS_NODE=`。

也可以在两个终端分别启动（适合只调 API 或只调渲染层）：

```powershell
# 终端 1：本地 API + Solver
npm run dev:api

# 终端 2：Vite 界面
npm run dev
```

也可以构建后直接运行桌面端：

```powershell
npm run build
npm run desktop
```

运行环境需要 **Java 21**（`JAVA_HOME` 或 PATH 中的 `java`）。Oracle JDK 21、Microsoft Build of OpenJDK 21、Eclipse Temurin 21 均可；安装版运行只需要 Java 21 运行时，构建 jar 需要 JDK（含 javac）。首次构建会自动获取 Jackson 2.17.2 依赖到 `services/solver-java/lib`（jar 已在 `.gitignore` 中，不提交）。构建 Java 求解器：

```powershell
npm run build:solver
```

生成 Windows 安装包（仍需用户安装 JDK 21）：

推荐双击项目根目录的 [build_appliction.bat](build_appliction.bat)，选择 `[1] 编译本地版本`；也可以执行 `npm run dist:win`，效果相同。脚本会依次构建 Java Solver、渲染进程、Electron 免安装应用和 NSIS 安装包，产物统一放在项目根目录 `dist/`：

- `dist/WarpWeft Scheduler Setup <版本>.exe`：安装包，安装包和应用 exe 均使用 `assets/icon.ico`
- `dist/win-unpacked/`：免安装应用
- `dist/index.html`、`dist/assets/`：打包进应用的渲染进程文件

脚本里的 `[2] 编译 Linux 服务端` 会生成 `dist/linux-server/warpweft-linux-server-<版本>.tar.gz` 和 SHA256 校验文件；也可以直接执行：

```powershell
npm run dist:linux
```

Linux 部署包包含 systemd 单元、安装/卸载/验证脚本和 Nginx 示例，不需要在服务器上安装 Electron 或执行 `npm install`。完整安装、TLS、备份和排障步骤见 [guideline.md](guideline.md)，本地服务端/UI 对照见 [docs/linux-server-parity.md](docs/linux-server-parity.md)。

## 数据与打包

- 开发模式数据文件：`data/warpweft.json`
- 安装版数据文件：Electron 的 `userData/warpweft.json`
- 首次启动创建空工作区，不会向软件界面注入演示或测试数据；`database/seeds/demo.json` 仅供 Solver 自动化测试使用
- 演示数据为周一至周五每天 3 节（15 个时间格），保留机动空档；如果实际工作区排满，预览会显示空档数并提示增加时间段/教师，或改用交换课程
- Excel 导入支持学校、班级、教师、学科、教室、时间段和教学计划；班级表新增“班主任”列，教师表新增“负责班级”列；简化模式模板不需要“教室”表；入口集中在“排课准备 → 数据导入”抽屉，基础资料按名称复用，教学计划整体替换，导入后候选课表失效
- 简化模式：默认每班一间自动固定教室，不要求教室 sheet/教室类型；完整模式保留教室容量、类型和冲突排课。两种模式可在设置或导入面板切换
- 服务端默认监听 `127.0.0.1`；Linux 局域网部署建议经 Nginx 反代，或通过服务端页/`server-config.json` 切换监听，并配置防火墙/访问控制
- Electron 33 自带的 Node 20 不包含 `node:sqlite`，因此当前 MVP 使用单文件 JSON 存储；数据访问层保留了 `read()/write()` 形态，后续可替换为 SQLite 适配器
- 打包版界面由本地 HTTP 服务（`http://127.0.0.1:4317/`）提供，避免 `file://` 下 ES module 被拦截导致白屏

## Solver

生产求解器为 `services/solver-java`，要求 Java 21。它使用贪心 + 随机重启 + 局部搜索生成可行课表，支持班级/教师/教室冲突、教室容量与类型、固定时间、教师不可用时间、教师负责班级、班主任本班课约束、锁定课程、自习/课后服务类型和班级空档软约束；完整/简化模式由 roomMode 控制。输入输出协议见 `packages/contracts/src.ts`。

求解器源码按 模型 / 规则 / 引擎 / 协议 四个包组织：`com.warpweft.solver.model`（Slot/Room/Plan/Entry/Task/Placement/SolverData）、`rules`（Rule + 硬规则可行性 + 规则罚分）、`engine`（State + 搜索）、`protocol`（JSON 解析与结果构造）；入口 `WarpWeftSolver` 只负责转发 stdin/stdout。

规则冲突分析在仓库内 `server/fullsolver/`：它以本求解器为可行性判定器，输出不可约冲突集（MUS）或最小势冲突集，两者仅通过 solver input/output JSON 通信。
单机和局域网服务端使用同一套 Java 求解器。服务端模式会记录任务队列、耗时、结果和 Java 求解日志；UI 在“服务端”页展示本机 CPU/内存、Java 版本和实时日志。HTTP API 位于 `server/api/`；`/api/health` 返回 `schemaVersion`、`appVersion`、`solverProtocol` 和 `capabilities`，客户端与服务端数据版本不一致时会阻断保存/排课并提示升级。

## 服务端模式

选择「局域网（服务端）」后，导航栏会出现 **服务端** 页面，展示：

- CPU 使用率、内存、进程运行时间和 Java 版本
- Java 求解器是否就绪
- **局域网共享**：监听模式（仅本机 / 局域网）、允许连接的电脑数、并发求解数、队列容量、每台电脑的在跑/排队上限、任务超时、可选网段白名单；保存后立即生效
- **已连接电脑**：短 id、IP、最近活动、在跑/排队任务数，可断开
- **任务队列**：排队/运行/完成/取消/失败、客户端、耗时、结果，可取消运行中或排队中的任务
- **用户与密码**（仅 Linux 管理员可见）：新增用户、改角色、启用/停用、重置密码、删除；Electron 客户端不显示
- 实时求解日志（包含 Java 求解阶段和最终状态）

**Linux 服务端默认启用账号登录**：除健康检查和登录接口外，API 需要 Bearer token；管理员可在 Linux 服务端页面或 `sudo warpweft user add/passwd` 添加用户、重置密码。**Electron 本机桌面版不启用登录**，连接 Linux 时只显示登录框，不显示用户管理。默认不做 TLS，公网必须经 Nginx TLS/VPN；局域网内仍建议配合「允许网段」使用。

默认只监听 `127.0.0.1`；在「服务端 → 局域网共享」把监听模式切到「局域网」并保存即可，无需环境变量或重启应用（`WARPVEFT_HOST` 仍保留给开发脚本做临时覆盖）。详细说明、限额含义、接口与排障见 [docs/lan-server.md](docs/lan-server.md)。
## 手动测试数据

`tests/test_data/` 提供三套 Excel 数据集和一份导入模板：

- `基础数据-小规模.xlsx`：2 个班级、3 位教师、2 间教室、15 个时间段、18 课时
- `完整周数据.xlsx`：4 个班级、7 位教师、5 间教室、20 个时间段、60 课时
- `异常数据-教室容量不足.xlsx`：用于验证容量校验
- `导入模板.xlsx`：空白导入模板

在“排课准备 → 数据导入”抽屉中直接选择 .xlsx；导入时勾选“导入前清空当前工作区”可得到与数据集一致的数据。

## 设计与改造文档

- [排课约束与准备流程改造设计](docs/constraint-ux-redesign.md)