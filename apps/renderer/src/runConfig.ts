import type { RunMode } from './types';

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
