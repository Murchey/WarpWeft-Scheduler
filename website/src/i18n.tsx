import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { zhCN } from './locale/zh-CN';
import type { SiteKey } from './locale/zh-CN';
import { enUS } from './locale/en-US';

export type Lang = 'zh-CN' | 'en-US';

/**
 * 与产品界面共用同一个存储键（见 apps/renderer/src/i18n/types.ts），
 * 因此在官网切换语言后打开 /app/ 应用，语言保持一致。
 */
export const LANG_STORAGE_KEY = 'warpweft-locale';

const ZH = zhCN as Record<string, string>;
const EN = enUS as Record<string, string>;

/** 当前语言 → 中文真源 → key 本身，永不返回空串。 */
export function translate(lang: Lang, key: SiteKey): string {
  const table = lang === 'en-US' ? EN : ZH;
  return table[key] ?? ZH[key] ?? key;
}

/**
 * 语言优先级：localStorage → ?lang= → 系统语言。
 * 非中英系统语言一律回落简体中文，与应用 detectLang() 的策略一致。
 */
export function readInitialLang(): Lang {
  try {
    const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (saved === 'zh-CN' || saved === 'en-US') return saved;
  } catch {
    // 隐私模式下 localStorage 可能不可用
  }
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('lang');
    if (fromUrl === 'zh-CN' || fromUrl === 'en-US') return fromUrl;
  } catch {
    // 非浏览器环境
  }
  const nav = (navigator.language || '').toLowerCase();
  return nav.startsWith('en') ? 'en-US' : 'zh-CN';
}

export interface SiteI18nValue {
  lang: Lang;
  toggleLang: () => void;
  t: (key: SiteKey) => string;
  /** 从 { zh, en } 结构里取当前语言的文案。 */
  pick: (value: { zh: string; en: string }) => string;
}

const SiteI18nContext = createContext<SiteI18nValue | null>(null);

export function SiteI18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>(readInitialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dataset.locale = lang;
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      // 存储不可用时语言仍对当前会话生效
    }
  }, [lang]);

  const toggleLang = useCallback(() => {
    setLang((current) => (current === 'zh-CN' ? 'en-US' : 'zh-CN'));
  }, []);

  const value = useMemo<SiteI18nValue>(
    () => ({
      lang,
      toggleLang,
      t: (key) => translate(lang, key),
      pick: (v) => (lang === 'en-US' ? v.en : v.zh),
    }),
    [lang, toggleLang],
  );

  return React.createElement(SiteI18nContext.Provider, { value }, children);
}

export function useSiteI18n(): SiteI18nValue {
  const value = useContext(SiteI18nContext);
  if (!value) throw new Error('useSiteI18n 必须在 <SiteI18nProvider> 内使用');
  return value;
}

export function useSiteT(): SiteI18nValue['t'] {
  return useSiteI18n().t;
}
