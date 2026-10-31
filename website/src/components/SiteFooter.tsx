import React from 'react';
import { useSiteI18n } from '../i18n';

export function SiteFooter() {
  const { t } = useSiteI18n();
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="site-shell site-footer-inner">
        <span>
          {t('brand.title')} · {t('brand.name')} — {t('footer.built')}
        </span>
        <span>
          {t('footer.docs')} · © {year} {t('footer.rights')}
        </span>
      </div>
    </footer>
  );
}
