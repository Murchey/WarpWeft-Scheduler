/**
 * i18n 基础类型。语言清单保持极小集合：产品只交付简中与英文两套界面。
 * MessageKey 由 zh-CN 词条真源推导（见 locales/zh-CN.ts），因此任何 UI 用到的
 * key 必须先在中文词条里登记，en-US 作为它的 Partial 覆盖表，缺条目自动回落中文。
 */
export type Lang = 'zh-CN' | 'en-US';

export const LANGS: Lang[] = ['zh-CN', 'en-US'];

export const DEFAULT_LANG: Lang = 'zh-CN';

export const LANG_STORAGE_KEY = 'warpweft-locale';

export type MessageVars = Record<string, string | number>;

export function isLang(value: unknown): value is Lang {
  return value === 'zh-CN' || value === 'en-US';
}

/**
 * 系统语言推断：中文环境走简中；显式英文环境走英文；
 * 其他语言（日德法等）一律回落简中，避免出现"三语混排"的中性默认。
 */
export function detectLang(): Lang {
  const nav = typeof navigator === 'undefined' ? '' : (navigator.language || '').toLowerCase();
  if (nav.startsWith('zh')) return 'zh-CN';
  if (nav.startsWith('en')) return 'en-US';
  return DEFAULT_LANG;
}
