import React from 'react';
import { useSiteI18n } from '../i18n';
import { useTheme } from '../theme';

const NAV = [
  { href: '#overview', key: 'nav.overview' },
  { href: '#features', key: 'nav.features' },
  { href: '#shots', key: 'nav.shots' },
  { href: '#status', key: 'nav.status' },
  { href: '#deploy', key: 'nav.deploy' },
] as const;

export function SiteHeader() {
  const { t, lang, toggleLang } = useSiteI18n();
  const { mode, cycle } = useTheme();

  return (
    <header className="site-header">
      <a className="site-brand" href="/">
        <img src="/site/icon.svg" alt="" />
        <span>{t('brand.name')}</span>
      </a>
      <nav className="site-nav">
        {NAV.map((item) => (
          <a key={item.href} href={item.href}>
            {t(item.key)}
          </a>
        ))}
      </nav>
      <div className="site-header-actions">
        <button
          type="button"
          className="site-icon-button"
          onClick={cycle}
          title={mode}
          aria-label={t('theme.switch')}
        >
          {mode === 'dark' ? '☾' : mode === 'light' ? '☀' : '◐'} {t('theme.switch')}
        </button>
        <button type="button" className="site-icon-button" onClick={toggleLang}>
          {lang === 'zh-CN' ? t('lang.switch') : t('lang.switchBack')}
        </button>
        <a className="site-cta" href="/app/">
          {t('nav.enterApp')}
        </a>
      </div>
    </header>
  );
}
