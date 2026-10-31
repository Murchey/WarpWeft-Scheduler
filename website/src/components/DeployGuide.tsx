import React from 'react';
import { DEPLOY_STEPS } from '../content';
import { useSiteI18n } from '../i18n';

const PATHS = [
  { path: '/', key: 'deploy.pathRoot' },
  { path: '/app/', key: 'deploy.pathApp' },
  { path: '/api/', key: 'deploy.pathApi' },
] as const;

export function DeployGuide() {
  const { t, pick } = useSiteI18n();

  return (
    <section className="site-section" id="deploy">
      <h2>{t('deploy.title')}</h2>
      <p className="site-section-lead">{t('deploy.lead')}</p>

      <div className="site-metrics" style={{ marginBottom: 20 }}>
        {PATHS.map((item) => (
          <div className="site-metric" key={item.path}>
            <b>{item.path}</b>
            <span>{t(item.key)}</span>
          </div>
        ))}
      </div>

      <div className="site-steps">
        {DEPLOY_STEPS.map((step, index) => (
          <div className="site-step" key={step.title.zh}>
            <i>{index + 1}</i>
            <div>
              <h4>{pick(step.title)}</h4>
              <p>{pick(step.body)}</p>
              {step.code ? <pre className="site-code">{step.code}</pre> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
