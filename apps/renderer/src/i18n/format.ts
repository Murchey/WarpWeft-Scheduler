import type { Lang } from './types';
import { DEFAULT_LANG } from './types';

/**
 * 日期与数字格式统一入口。此前 20 余处直接调用 toLocaleString('zh-CN')，
 * 英文模式会输出中式的 "2026/10/30 18:57"，这里按语言切换 Intl locale。
 * 本模块只依赖 Intl，不依赖 React，避免与 i18n/index 形成循环引用。
 */
const INTL_LOCALE: Record<Lang, string> = { 'zh-CN': 'zh-CN', 'en-US': 'en-US' };

/**
 * 默认语言读自 <html lang>，由 I18nProvider 同步维护。
 * 这样既有调用点无需逐个传 lang 即可自动跟随界面语言。
 */
export function currentLang(): Lang {
  if (typeof document === 'undefined') return DEFAULT_LANG;
  return document.documentElement.lang === 'en-US' ? 'en-US' : DEFAULT_LANG;
}

const DATE_TIME: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

function toDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 完整日期时间。空值返回空串，非法时间也返回空串（不打印 Invalid Date）。 */
export function fmtDateTime(
  value: string | number | Date | null | undefined,
  lang: Lang = currentLang(),
  options: Intl.DateTimeFormatOptions = DATE_TIME,
): string {
  if (value === null || value === undefined || value === '') return '';
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(INTL_LOCALE[lang], options).format(date);
}

/** 只到分钟，用于日志与列表。 */
export function fmtTime(value: string | number | Date | null | undefined, lang: Lang = currentLang()): string {
  return fmtDateTime(value, lang, { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** 日期（不含时间）。 */
export function fmtDate(value: string | number | Date | null | undefined, lang: Lang = currentLang()): string {
  return fmtDateTime(value, lang, { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** 千分位数字。 */
export function fmtNumber(value: number, lang: Lang = currentLang()): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(INTL_LOCALE[lang], { maximumFractionDigits: 2 }).format(value);
}

/** 按语言排序用的比较器，取代散落的 localeCompare(a, b, 'zh-CN')。 */
export function collator(lang: Lang = currentLang()): Intl.Collator {
  return new Intl.Collator(INTL_LOCALE[lang], { numeric: true, sensitivity: 'base' });
}
