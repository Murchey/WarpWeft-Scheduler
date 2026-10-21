# WarpWeft Scheduler

单机小规模排课 MVP：Electron/React 界面、本地 JSON 数据层、独立 Python Solver。

## 已实现

- 基础资料可编辑：班级、教师、学科、教室、时间段
- 教学计划可编辑：班级、学科、教师、周课时、教室类型、固定时间
- 排课前检查：重复编码、缺失引用、班级/教师课时上限、教室容量、固定时间冲突
- 本地自动排课：Electron 主进程启动本地 API，Solver 通过标准 JSON 通信
- 周课表网格：按班级/教师/教室查看，显示课程、教师、教室和冲突
- 课表调整：拖动移动/交换、锁定、撤销；重新排课时保留锁定课程
- 候选与正式版：自动保存候选，可保存为正式版
- 报表发布：导出 Excel、CSV、打印课表
- 深色/浅色主题；深色模式使用低饱和黄铜色作为强调色
- P2：教师不可用时间编辑，软约束权重调节，基础资料 Excel 导入
- 正式版版本记录与审计日志；每次发布保留可追溯的版本 ID、时间和课时数量

## 本地运行

```powershell
npm install
```

首次打开界面会要求选择运行模式：单机、局域网服务端、局域网客户端或云端。选择会保存到当前浏览器/桌面用户配置，之后可点击顶部“运行：…”按钮修改；局域网客户端和云端需要填写服务端 API 地址。

开发模式需要两个终端：

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

安装 Python Solver 依赖：

```powershell
py -m pip install -r services/solver/requirements.txt
```

生成不要求用户安装 Python 的 Windows 安装包：

```powershell
npm run dist:win
```

## 数据与打包

- 开发模式数据文件：`data/warpweft.json`
- 安装版数据文件：Electron 的 `userData/warpweft.json`
- 首次启动自动从 `database/seeds/demo.json` 写入演示数据
- Excel 导入按工作表名称识别“班级/教师/学科/教室”，导入后会触发候选课表失效并写入本地 JSON
- Electron 33 自带的 Node 20 不包含 `node:sqlite`，因此当前 MVP 使用单文件 JSON 存储；数据访问层保留了 `read()/write()` 形态，后续可替换为 SQLite 适配器
- 打包版界面由本地 HTTP 服务（`http://127.0.0.1:4317/`）提供，避免 `file://` 下 ES module 被拦截导致白屏

## Solver

Solver 首选 OR-Tools CP-SAT；未安装 OR-Tools 时自动回退到贪心实现。输入输出协议见 `packages/contracts/src.ts`，锁定课程会在重新排课时固定在原时间与教室。
