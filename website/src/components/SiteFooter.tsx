import React from 'react';
import { useSiteI18n } from '../i18n';
import { useSiteConfig } from '../useSiteConfig';

/** 备案号链接到工信部查询页；公安备案号链接到对应省份的公安备案查询入口。 */
const ICP_URL = 'https://beian.miit.gov.cn/';

export function SiteFooter() {
  const { t } = useSiteI18n();
  const config = useSiteConfig();
  const year = new Date().getFullYear();
  const hasFiling = Boolean(config.icp || config.police);

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
      {hasFiling ? (
        <div className="site-shell site-footer-filing">
          {config.icp ? (
            <a href={ICP_URL} target="_blank" rel="noreferrer noopener">
              {config.icp}
            </a>
          ) : null}
          {config.police ? <span>{config.police}</span> : null}
        </div>
      ) : null}
    </footer>
  );
}
