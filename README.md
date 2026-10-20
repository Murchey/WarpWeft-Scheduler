# WarpWeft Scheduler

单机小规模排课 MVP：Electron/React 界面、SQLite 数据层、独立 Python Solver。

## 本地运行

```powershell
npm install
npm run validate
npm run build
npm run dev
```

安装 Python Solver 依赖：

```powershell
py -m pip install -r services/solver/requirements.txt
```

当前仓库提供可运行的桌面端垂直切片 UI、演示数据、Solver 协议和数据校验基础。Solver 首选 OR-Tools CP-SAT，通过标准 JSON 从 stdin 接收输入并向 stdout 输出结果；未安装 OR-Tools 时会回退到可诊断的贪心实现。
