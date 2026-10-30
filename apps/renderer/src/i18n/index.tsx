import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LANG, LANG_STORAGE_KEY, detectLang, isLang } from './types';
import type { Lang, MessageVars } from './types';
import { zhCN } from './locales/zh-CN';
import type { MessageKey } from './locales/zh-CN';
import { enUS } from './locales/en-US';
import { collator, fmtDate, fmtDateTime, fmtNumber, fmtTime } from './format';

export type { Lang, MessageVars } from './types';
export type { MessageKey } from './locales/zh-CN';
export {
  LANGS,
  DEFAULT_LANG,
  LANG_STORAGE_KEY,
  detectLang,
  isLang,
} from './types';
export { fmtDate, fmtDateTime, fmtNumber, fmtTime, collator } from './format';

/** 组件内使用的格式化器，自动绑定当前语言并保持引用稳定。 */
export interface Formatters {
  dateTime: (value: string | number | Date | null | undefined) => string;
  date: (value: string | number | Date | null | undefined) => string;
  time: (value: string | number | Date | null | undefined) => string;
  number: (value: number) => string;
  compare: (a: string, b: string) => number;
}

const ZH = zhCN as Record<string, string>;
const EN = enUS as Record<string, string>;

/** 把 log.reasonTimeout 这类 key 降级成 "Reason Timeout"，作为最后兜底。 */
function leafToReadable(key: string): string {
  const leaf = key.split('.').pop() ?? key;
  return leaf
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (char) => char.toUpperCase())
    .trim();
}

function interpolate(template: string, vars?: MessageVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    vars[name] === undefined ? whole : String(vars[name]),
  );
}

/**
 * 翻译回退链：当前语言 → 中文真源 → 可读化 key。
 * 永远不返回空串，因此英文覆盖不全时界面只会出现中文，不会破版。
 */
export function translate(lang: Lang, key: MessageKey, vars?: MessageVars): string {
  const table = lang === 'en-US' ? EN : ZH;
  const raw = table[key] ?? ZH[key];
  if (raw !== undefined) return interpolate(raw, vars);
  if (import.meta.env.DEV) console.warn('[i18n] missing message key:', key);
  return leafToReadable(String(key));
}

export interface I18nValue {
  lang: Lang;
  setLang: (next: Lang) => void;
  toggleLang: () => void;
  t: (key: MessageKey, vars?: MessageVars) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

/** 语言优先级：localStorage → ?lang= → 系统语言。 */
export function readInitialLang(): Lang {
  try {
    const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    // localStorage may be unavailable (private mode / disabled storage)
  }
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('lang');
    if (isLang(fromUrl)) return fromUrl;
  } catch {
    // non-browser environments
  }
  return detectLang() || DEFAULT_LANG;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dataset.locale = lang;
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      // storage full or disabled: language still applies for this session
    }
    // 让原生窗口标题与文件对话框跟随界面语言
    void window.warpweft?.setLocale?.(lang);
  }, [lang]);

  const setLang = useCallback((next: Lang) => setLangState(next), []);
  const toggleLang = useCallback(
    () => setLangState((current) => (current === 'zh-CN' ? 'en-US' : 'zh-CN')),
    [],
  );

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      setLang,
      toggleLang,
      t: (key, vars) => translate(lang, key, vars),
    }),
    [lang, setLang, toggleLang],
  );

  return React.createElement(I18nContext.Provider, { value }, children);
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}

/** 只要翻译函数时的便捷 hook。 */
export function useT(): I18nValue['t'] {
  return useI18n().t;
}

export function useFormatters(): Formatters {
  const { lang } = useI18n();
  return useMemo<Formatters>(() => {
    const instance = collator(lang);
    return {
      dateTime: (value) => fmtDateTime(value, lang),
      date: (value) => fmtDate(value, lang),
      time: (value) => fmtTime(value, lang),
      number: (value) => fmtNumber(value, lang),
      compare: (a, b) => instance.compare(a, b),
    };
  }, [lang]);
}
