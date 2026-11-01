import React, { useEffect, useState } from 'react';
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
  const [menuOpen, setMenuOpen] = useState(false);

  // 窄屏抽屉：锁滚动 + Esc 关闭，避免打开后背景还能滑动。
  useEffect(() => {
    if (!menuOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // 视口变宽后自动收起，避免桌面端残留一个打开状态的抽屉。
  useEffect(() => {
    if (!menuOpen) return undefined;
    const query = window.matchMedia('(min-width: 861px)');
    const onChange = () => {
      if (query.matches) setMenuOpen(false);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [menuOpen]);

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
          {mode === 'dark' ? '☾' : mode === 'light' ? '☀' : '◐'}
          <span className="site-label"> {t('theme.switch')}</span>
        </button>
        <button type="button" className="site-icon-button" onClick={toggleLang}>
          <span className="site-label">{lang === 'zh-CN' ? t('lang.switch') : t('lang.switchBack')}</span>
          <span className="site-label-compact" aria-hidden="true">
            {lang === 'zh-CN' ? 'EN' : '中'}
          </span>
        </button>
        <a className="site-cta site-cta-header" href="#status">
          {t('nav.enterApp')}
        </a>
        <button
          type="button"
          className="site-menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="site-mobile-menu"
          aria-label={menuOpen ? t('nav.closeMenu') : t('nav.openMenu')}
          onClick={() => setMenuOpen((value) => !value)}
        >
          <i aria-hidden="true" className={menuOpen ? 'is-open' : ''} />
        </button>
      </div>

      {menuOpen ? (
        <div className="site-mobile-menu" id="site-mobile-menu">
          <nav>
            {NAV.map((item) => (
              <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>
                {t(item.key)}
              </a>
            ))}
          </nav>
          <a className="site-cta" href="#status" onClick={() => setMenuOpen(false)}>
            {t('nav.enterApp')}
          </a>
        </div>
      ) : null}
    </header>
  );
}
