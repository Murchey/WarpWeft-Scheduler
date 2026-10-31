/**
 * 官网结构化内容。
 *
 * 长段落与列表直接以 { zh, en } 成对存放，不走 key 拼接：功能条目需要保留
 * README 的原文顺序与措辞，拆成扁平 key=value 反而更难维护。
 * 界面上的短文案（按钮、标签）在 locale/ 下，由 i18n.ts 的 t() 取用。
 */

import dashboard from './images/dashboard.png';
import planMatrix from './images/plan-matrix.png';
import rulesCreate from './images/rules-create.png';
import timetableWeek from './images/timetable-week2.png';
import adjustments from './images/adjustments-editor.png';
import exportWeek from './images/export-week.png';
import serverPage from './images/linux-server-page.png';
import stats from './images/stats.png';

export interface Bilingual {
  zh: string;
  en: string;
}

export interface FeatureGroup {
  id: string;
  title: Bilingual;
  items: Bilingual[];
}

/** 功能亮点：摘自 README「已实现」清单，按主题归组，中文保留原文。 */
export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: 'data',
    title: { zh: '数据建模与排课准备', en: 'Data modelling and preparation' },
    items: [
      {
        zh: '排课准备工作区：左侧子导航集中管理数据导入、班级、教师、学科、教室、周时间段、教学计划、教师时间和排课规则',
        en: 'One preparation workspace: import, classes, teachers, subjects, rooms, time slots, plans, availability and rules',
      },
      {
        zh: '教学计划可编辑：班级、学科、教师、周课时、教室类型、固定时间、连堂节数、单双周配对组；支持批量选择多个班级',
        en: 'Editable teaching plans with fixed slots, consecutive-period groups and alternate-week pairing',
      },
      {
        zh: '课次级固定时间：一门课可以只固定其中一节，其余节次由求解器安排；固定时段在构造、修复和随机重启中都是硬保护',
        en: 'Pin a single period of a course; fixed slots are hard-protected throughout the search',
      },
      {
        zh: '连堂与配对：计划可声明 2–4 节连堂；单周 / 双周两条计划填同一个「配对组」后必须落在同一时间格',
        en: '2–4 period blocks and alternate-week pairing that must land on the same slot',
      },
      {
        zh: '周时间段模板：设置好其中一天，勾选其他星期，一键复制当天的节次、时段类型、开始时间、时长和名称',
        en: 'Copy one day of periods to the rest of the week in a single action',
      },
      {
        zh: '教师不可用时间与负责班级：按教师添加/移除不可用时间段，排课时自动避开；负责班级留空不限',
        en: 'Teacher unavailability and responsible classes are honoured automatically',
      },
      {
        zh: '班主任：班级表可指定班主任；班主任必须在本班至少承担一节自己可教的学科（本班没有该学科时豁免）',
        en: 'Head teachers must teach at least one lesson in their own class',
      },
      {
        zh: 'Excel 导入抽屉：在排课准备右上角打开，不离开当前子页面；教师时间可批量导入',
        en: 'Excel import drawer that never navigates away from the current page',
      },
      {
        zh: '批量设置：教学计划、教师、学科均支持多选后批量修改字段',
        en: 'Bulk editing across plans, teachers and subjects',
      },
    ],
  },
  {
    id: 'rules',
    title: { zh: '规则与约束引擎', en: 'Rules and constraints' },
    items: [
      {
        zh: '规则页使用句子构建器（对象 + 时间 + 程度 + 参数）；「课表偏好」用 0–5 权重表示优先级',
        en: 'Sentence builder for rules; preferences expressed as 0–5 weights',
      },
      {
        zh: '规则支持影响预览、规则冲突提醒、自然语言输入和「模拟放宽」，可在不保存的情况下估算放宽一条规则能多排多少课时',
        en: 'Impact preview, conflict warnings, natural-language input and "what-if" relaxation',
      },
      {
        zh: '排课规则：中文规则卡片，支持必须/尽量/避免、作用范围、影响预览和未排原因；系统硬规则锁定',
        en: 'Chinese rule cards with must/prefer/avoid scopes and unplaced reasons',
      },
      {
        zh: '规则已接入 Java 求解器：教师每日上限、连续上限、教师半天无课、学科每日上限、学科时间偏好、避开首末节、同学科不连排、学科分散、硬性连堂/双节',
        en: 'Nine constraint families wired into the Java solver',
      },
      {
        zh: '软约束权重调节：学科分散、教师空档、教师工作量均衡、班级空档、学科时段偏好',
        en: 'Tunable soft-constraint weights',
      },
      {
        zh: '排课前检查：重复编码、缺失引用、班级/教师课时上限、教室容量、固定时间冲突',
        en: 'Pre-solve checks for duplicates, dangling references, caps, capacity and conflicts',
      },
    ],
  },
  {
    id: 'solver',
    title: { zh: '求解、重排与任务', en: 'Solving, re-solving and jobs' },
    items: [
      {
        zh: '本地自动排课：Electron 主进程启动本地 API，Solver 通过标准 JSON 通信',
        en: 'Fully local solving; the solver talks JSON over stdin/stdout',
      },
      {
        zh: '支持按班级/教师/规则局部重排，范围外课程保留位置',
        en: 'Partial re-solving by class, teacher or rule keeps everything else in place',
      },
      {
        zh: '连堂支持锁定课程：锁定课保留，剩余课时继续成对安排',
        en: 'Locked lessons survive re-solving',
      },
      {
        zh: '自动分配教师：按学科/年级/负责班级匹配，并检查周课时、每日上限、可用时段',
        en: 'Automatic teacher assignment with workload and availability checks',
      },
      {
        zh: '课表检测新增：多节固定时间是否落在指定时段、连堂是否成组',
        en: 'Timetable inspection for fixed slots and block integrity',
      },
      {
        zh: '任务与历史：长时任务可查看进度与最佳课表文件；短时计算可查看逐节结果',
        en: 'Long-running jobs with checkpoints plus per-step short-run history',
      },
    ],
  },
  {
    id: 'timetable',
    title: { zh: '课表查看、调代课与导出', en: 'Timetables, adjustments and export' },
    items: [
      {
        zh: '周课表网格：按班级/教师/教室查看，显示课程、教师、教室和冲突',
        en: 'Weekly grid by class, teacher or room with conflict highlighting',
      },
      {
        zh: '课表预览与调整：支持全屏、拖动交换、选中后点击空白格移动、显式「交换课程」模式、锁定、撤销',
        en: 'Drag to swap, move into empty cells, explicit swap mode, lock and undo',
      },
      {
        zh: '调整影响范围：调课/对调/代课/停课/改期/还原后显示受影响的班级、教师、节次',
        en: 'Every change reports which classes, teachers and periods it affects',
      },
      {
        zh: '跨日对调：把所选日期的同班课程与未来不同星期的同班课程互换，支持撤销与审计',
        en: 'Swap lessons across weeks with undo and audit trails',
      },
      {
        zh: '课表导出排版：按单元格内容自动加高行、加宽星期列，并隐藏没有课的日子',
        en: 'Exported spreadsheets auto-size rows and columns',
      },
      {
        zh: '批量导出：一次导出全部班级/教师课表，可合并为一个多工作表文件或每张课表保存为独立文件',
        en: 'Batch export to one workbook or one file per timetable',
      },
      {
        zh: '报表发布：导出 Excel、CSV、打印课表；桌面端直接保存到系统下载目录',
        en: 'Excel, CSV and print output',
      },
      {
        zh: '沉浸模式：隐藏工具栏与页头，只保留课表网格；Esc 可退出',
        en: 'Distraction-free mode for the timetable grid',
      },
    ],
  },
  {
    id: 'server',
    title: { zh: '服务端、账号与审计', en: 'Server, accounts and audit' },
    items: [
      {
        zh: 'Linux 服务端：同一套浏览器 UI + Java Solver，可独立部署为 systemd 服务；带账号登录、管理员用户管理',
        en: 'Deploy as a systemd service with account login and admin user management',
      },
      {
        zh: '服务端监控页：CPU/内存、Java 求解器状态、任务队列、排队/运行/完成状态和实时求解日志',
        en: 'Live CPU, memory, solver state, queue and logs',
      },
      {
        zh: '局域网共享：监听模式、允许连接的电脑数、并发求解数、队列容量、任务超时与网段白名单',
        en: 'LAN sharing with client caps, concurrency limits and CIDR allowlists',
      },
      {
        zh: '候选与正式版：自动保存候选，可保存为正式版；每次发布保留可追溯的版本 ID、时间和课时数量',
        en: 'Candidate and released versions with traceable version ids',
      },
      {
        zh: '正式版版本记录与审计日志',
        en: 'Release history and audit log',
      },
    ],
  },
  {
    id: 'ui',
    title: { zh: '界面与本地可用性', en: 'Interface and local-first' },
    items: [
      {
        zh: '深色/浅色主题；深色模式使用低饱和黄铜色作为强调色',
        en: 'Light and dark themes with a restrained brass accent',
      },
      {
        zh: '数据留在本机：开发模式为仓库内 JSON，安装版在 Electron 用户数据目录，不依赖云端',
        en: 'Your data stays on the machine: local JSON, no cloud dependency',
      },
      {
        zh: '中英双语界面，界面语言与主题偏好在官网与应用之间保持一致',
        en: 'Chinese and English UI, with language and theme shared between site and app',
      },
    ],
  },
];

export interface Metric {
  value: string;
  label: Bilingual;
}

export const METRICS: Metric[] = [
  { value: '6.1s', label: { zh: '120 班 / 3600 课时求解', en: '120 classes / 3600 lessons solved' } },
  { value: '45', label: { zh: '班级（实测工作区）', en: 'classes in the sample workspace' } },
  { value: '149', label: { zh: '教师', en: 'teachers' } },
  { value: '1620', label: { zh: '待排课时', en: 'lessons to place' } },
];

export interface Screenshot {
  src: string;
  title: Bilingual;
  alt: string;
}

export const SCREENSHOTS: Screenshot[] = [
  {
    src: dashboard,
    title: { zh: '工作台：数据规模与今日课表', en: 'Dashboard: scale and today' },
    alt: 'WarpWeft 工作台',
  },
  {
    src: planMatrix,
    title: { zh: '教学计划表格：课时汇总与批量编辑', en: 'Teaching plan table' },
    alt: 'WarpWeft 教学计划表格',
  },
  {
    src: rulesCreate,
    title: { zh: '规则构建器：句子式规则与影响预览', en: 'Rule builder' },
    alt: 'WarpWeft 规则构建器',
  },
  {
    src: timetableWeek,
    title: { zh: '周课表：班级/教师/教室三视图', en: 'Weekly timetable' },
    alt: 'WarpWeft 周课表',
  },
  {
    src: adjustments,
    title: { zh: '调代课：影响范围与撤销', en: 'Adjustments and substitutions' },
    alt: 'WarpWeft 调代课',
  },
  {
    src: exportWeek,
    title: { zh: '导出 Excel：按课表网格排版', en: 'Excel export preview' },
    alt: 'WarpWeft 导出 Excel',
  },
  {
    src: stats,
    title: { zh: '统计报表：课时、教师与班级分布', en: 'Workload reports' },
    alt: 'WarpWeft 统计报表',
  },
  {
    src: serverPage,
    title: { zh: '服务端：CPU/内存、队列与日志', en: 'Server monitoring' },
    alt: 'WarpWeft 服务端监控',
  },
];

/** 桌面版下载链接：由 VITE_DOWNLOAD_URL 构建期注入，未注入时为空串。 */
export const DOWNLOAD_URL: string = typeof __SITE_DOWNLOAD_URL__ === 'string' ? __SITE_DOWNLOAD_URL__ : '';

/** 站点规范地址：由 VITE_SITE_ORIGIN 构建期注入，用于 canonical/og:url。 */
export const SITE_ORIGIN: string = typeof __SITE_ORIGIN__ === 'string' ? __SITE_ORIGIN__ : '';

export interface DeployStep {
  title: Bilingual;
  body: Bilingual;
  code?: string;
}

/** 部署步骤：刻意做到「只改一行 server_name」。 */
export const DEPLOY_STEPS: DeployStep[] = [
  {
    title: { zh: '解压并安装', en: 'Unpack and install' },
    body: {
      zh: '部署包自带 Node 侧全部依赖与 Java 求解器，目标机不需要 npm install，也不需要安装 Electron。',
      en: 'The package bundles every Node dependency and the Java solver — no npm install and no Electron on the server.',
    },
    code: 'sudo tar -xzf warpweft-linux-server-0.1.0.tar.gz\ncd warpweft && sudo bash linux_server/install.sh',
  },
  {
    title: { zh: '把子域名写进 Nginx', en: 'Point your subdomain at it' },
    body: {
      zh: '复制示例配置后，只需要修改 server_name 这一行：根路径是官网，/app/ 是需要登录的应用，/api/ 是后端接口。',
      en: 'Copy the sample config and change exactly one line — server_name. / is this site, /app/ is the app behind login, /api/ is the backend.',
    },
    code: 'sudo cp /opt/warpweft/linux_server/nginx.conf.example /etc/nginx/conf.d/warpweft.conf\n# 只改这一行：server_name warpweft.example.edu;\nsudo nginx -t && sudo systemctl reload nginx',
  },
  {
    title: { zh: '申请证书并创建账号', en: 'Add TLS and create an account' },
    body: {
      zh: '公网访问必须启用 TLS。账号由管理员用命令行创建，除健康检查与登录接口外的所有接口都需要登录。',
      en: 'Public access requires TLS. An admin creates accounts from the CLI; everything except health and login requires a session.',
    },
    code: 'sudo certbot --nginx -d warpweft.example.edu --redirect\nsudo warpweft user add admin --admin',
  },
  {
    title: { zh: '验证', en: 'Verify' },
    body: {
      zh: '验证脚本会核对运行中的服务与安装包清单（版本、schema、渲染资源与哈希），避免 UI 与 API 版本不一致。',
      en: 'The verify script cross-checks the running service against the package manifest so UI and API versions cannot drift.',
    },
    code: 'sudo bash /opt/warpweft/linux_server/verify.sh',
  },
];
