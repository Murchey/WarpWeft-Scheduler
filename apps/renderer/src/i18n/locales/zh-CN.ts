import { navMessages } from '../domains/nav';
import { commonMessages } from '../domains/common';
import { settingsMessages } from '../domains/settings';
import { projectMessages } from '../domains/project';

/**
 * 中文词条是唯一真源。所有 UI key 必须在这里（或 domains/* 中）登记，
 * MessageKey 由此推导，en-US 只是它的部分覆盖表。
 */
export const zhCN = {
  ...navMessages,
  ...commonMessages,
  ...settingsMessages,
  ...projectMessages,
} as const;

export type MessageKey = keyof typeof zhCN;

export type Dict = typeof zhCN;
