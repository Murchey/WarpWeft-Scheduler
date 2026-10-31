import React from 'react';
import { DOWNLOAD_URL } from '../content';
import { useSiteI18n } from '../i18n';

export function Hero() {
  const { t } = useSiteI18n();
  const tags = ['hero.tag.desktop', 'hero.tag.local', 'hero.tag.solver', 'hero.tag.selfhost'] as const;
  // 下载链接由 VITE_DOWNLOAD_URL 构建期注入；未配置时不渲染按钮，避免出现死链。
  const downloadHref = DOWNLOAD_URL;

  return (
    <section className="site-hero" id="overview">
      <span className="site-kicker">{t('hero.kicker')}</span>
      <h1>{t('brand.title')}</h1>
      <p>{t('hero.lead')}</p>
      <div className="site-hero-actions">
        <a className="site-cta" href="/app/">
          {t('hero.ctaApp')}
        </a>
        <a className="site-cta ghost" href="#deploy">
          {t('hero.ctaDeploy')}
        </a>
        {downloadHref ? (
          <a className="site-cta ghost" href={downloadHref} rel="noopener">
            {t('hero.ctaDownload')}
          </a>
        ) : null}
      </div>
      <div className="site-tags">
        {tags.map((key) => (
          <span className="site-tag" key={key}>
            {t(key)}
          </span>
        ))}
      </div>
      <p className="site-status-note">{t('hero.note')}</p>
    </section>
  );
}
