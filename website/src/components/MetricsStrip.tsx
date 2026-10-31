import React from 'react';
import { METRICS } from '../content';
import { useSiteI18n } from '../i18n';

export function MetricsStrip() {
  const { t, pick } = useSiteI18n();

  return (
    <section className="site-section" id="metrics">
      <h2>{t('metrics.title')}</h2>
      <p className="site-section-lead">{t('metrics.lead')}</p>
      <div className="site-metrics">
        {METRICS.map((metric) => (
          <div className="site-metric" key={metric.value}>
            <b>{metric.value}</b>
            <span>{pick(metric.label)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
