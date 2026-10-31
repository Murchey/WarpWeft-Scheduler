import React from 'react';
import { useSiteI18n } from '../i18n';

export function Hero() {
  const { t } = useSiteI18n();
  const tags = ['hero.tag.desktop', 'hero.tag.local', 'hero.tag.solver', 'hero.tag.selfhost'] as const;

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
