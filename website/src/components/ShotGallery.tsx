import React, { useEffect, useState } from 'react';
import { SCREENSHOTS } from '../content';
import { useSiteI18n } from '../i18n';

export function ShotGallery() {
  const { t, pick } = useSiteI18n();
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActive(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active]);

  return (
    <section className="site-section" id="shots">
      <h2>{t('shots.title')}</h2>
      <p className="site-section-lead">{t('shots.lead')}</p>
      <div className="site-shots">
        {SCREENSHOTS.map((shot) => (
          <figure className="site-shot" key={shot.src} style={{ margin: 0 }}>
            <button type="button" onClick={() => setActive(shot.src)} title={pick(shot.title)}>
              <img src={shot.src} alt={shot.alt} loading="lazy" />
            </button>
            <figcaption>{pick(shot.title)}</figcaption>
          </figure>
        ))}
      </div>
      {active ? (
        <div
          className="site-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setActive(null)}
        >
          <button type="button" className="site-lightbox-close" onClick={() => setActive(null)}>
            {t('shots.close')}
          </button>
          <img src={active} alt="" />
        </div>
      ) : null}
    </section>
  );
}
