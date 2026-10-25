import type { RunMode, SolverOutput } from './types';

export type RunPhase =
  | 'idle'
  | 'checking'
  | 'preparing'
  | 'solving'
  | 'finalizing'
  | 'completed'
  | 'failed';

export interface RunProgress {
  phase: RunPhase;
  message: string;
  startedAt?: number;
}

export const RUN_STEPS: { phase: RunPhase; label: string }[] = [
  { phase: 'checking', label: '检查' },
  { phase: 'preparing', label: '准备' },
  { phase: 'solving', label: '计算' },
  { phase: 'finalizing', label: '保存' },
  { phase: 'completed', label: '完成' },
];

export const RUN_MODE_OPTIONS: {
  value: RunMode;
  title: string;
  english: string;
  description: string;
  endpoint: string;
}[] = [
  {
    value: 'single',
    title: '单机',
    english: 'SINGLE MACHINE',
    description: '数据和 Solver 都运行在本机，适合个人教务工作站。',
    endpoint: 'http://127.0.0.1:4317',
  },
  {
    value: 'lan-server',
    title: '局域网（服务端）',
    english: 'LAN SERVER',
    description: '本机作为局域网服务端，其他电脑可连接此工作区。',
    endpoint: 'http://127.0.0.1:4317',
  },
  {
    value: 'lan-client',
    title: '局域网（客户端）',
    english: 'LAN CLIENT',
    description: '连接局域网内另一台 WarpWeft 服务端。',
    endpoint: 'http://127.0.0.1:4317',
  },
  {
    value: 'cloud',
    title: '链接云端',
    english: 'CLOUD',
    description: '连接远程部署的 WarpWeft API。',
    endpoint: 'https://',
  },
];

export const RUN_STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '未完成',
  cancelled: '已取消',
  interrupted: '已中断',
  COMPLETED: '已完成',
  FAILED: '未完成',
  TIMEOUT: '超时',
  FEASIBLE: '可行',
  OPTIMAL: '最优',
  IMPROVED: '已改进',
};

export function runStatusText(status: string): string {
  return RUN_STATUS_LABELS[status] ?? status;
}

export type ShortRunMode = 'solve' | 'repair';

export interface ShortRunRecord {
  id: string;
  createdAt: string;
  status: string;
  entries: number;
  elapsedMs: number;
  feasible: boolean;
  /** solve = 整表排课；repair = 局部重排。 */
  mode: ShortRunMode;
  /** 本次提交给求解器的时限。 */
  timeLimitSeconds: number;
  /** 启动时锁定的课时数。 */
  lockedCount: number;
  /** 启动时工作区的计划总课时，用于查看未排课时。 */
  totalPeriods: number;
  /** 启动时的运行模式，便于回看当时连接的是本机还是服务端。 */
  runMode: RunMode | null;
  /** 完整结果快照；仅在本次会话内存中保留。 */
  result: SolverOutput;
}
