import React from 'react';
import { FEATURE_GROUPS } from '../content';
import { useSiteI18n } from '../i18n';

export function FeatureGrid() {
  const { t, pick } = useSiteI18n();

  return (
    <section className="site-section" id="features">
      <h2>{t('features.title')}</h2>
      <p className="site-section-lead">{t('features.lead')}</p>
      <div className="site-features">
        {FEATURE_GROUPS.map((group) => (
          <article className="site-feature" key={group.id}>
            <h3>{pick(group.title)}</h3>
            <ul>
              {group.items.map((item) => (
                <li key={item.zh}>{pick(item)}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
