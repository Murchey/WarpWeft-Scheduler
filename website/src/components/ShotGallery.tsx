import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SCREENSHOTS } from '../content';
import { useSiteI18n } from '../i18n';

/** 滑动判定阈值：太小会误触，太大会让用户以为没反应。 */
const SWIPE_X = 50;
const SWIPE_Y = 80;

export function ShotGallery() {
  const { t, pick } = useSiteI18n();
  const [index, setIndex] = useState<number | null>(null);
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const open = index !== null;

  const close = useCallback(() => setIndex(null), []);
  const step = useCallback((delta: number) => {
    setIndex((current) => {
      if (current === null) return current;
      const next = current + delta;
      // 首尾不循环：用户能感知「到头了」，比无声绕回更清楚。
      if (next < 0 || next >= SCREENSHOTS.length) return current;
      return next;
    });
  }, []);

  // 键盘：Esc 关闭，左右方向键切换。
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      else if (event.key === 'ArrowRight') step(1);
      else if (event.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, close, step]);

  // 触摸：左右滑切换，下滑关闭（移动端看图的主流手势）。
  const onTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    if (!touch) return;
    touchRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const onTouchEnd = (event: React.TouchEvent) => {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) > SWIPE_X && Math.abs(dx) > Math.abs(dy)) {
      step(dx < 0 ? 1 : -1);
      return;
    }
    if (Math.abs(dy) > SWIPE_Y && Math.abs(dy) > Math.abs(dx)) {
      close();
    }
  };

  const shot = index === null ? null : SCREENSHOTS[index];
  const currentIndex = index ?? 0;

  return (
    <section className="site-section" id="shots">
      <h2>{t('shots.title')}</h2>
      <p className="site-section-lead">{t('shots.lead')}</p>
      <div className="site-shots">
        {SCREENSHOTS.map((item, itemIndex) => (
          <figure className="site-shot" key={item.src}>
            <button type="button" onClick={() => setIndex(itemIndex)} title={pick(item.title)}>
              <img src={item.src} alt={pick(item.title)} loading="lazy" />
            </button>
            <figcaption>{pick(item.title)}</figcaption>
          </figure>
        ))}
      </div>
      {shot ? (
        <div
          className="site-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={pick(shot.title)}
          onClick={close}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <button type="button" className="site-lightbox-close" onClick={close}>
            {t('shots.close')}
          </button>
          <img
            src={shot.src}
            alt={pick(shot.title)}
            onClick={(event) => event.stopPropagation()}
          />
          <div className="site-lightbox-bar" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => step(-1)}
              disabled={currentIndex === 0}
              aria-label={t('shots.prev')}
            >
              ‹
            </button>
            <span>
              {currentIndex + 1} / {SCREENSHOTS.length} · {pick(shot.title)}
            </span>
            <button
              type="button"
              onClick={() => step(1)}
              disabled={currentIndex === SCREENSHOTS.length - 1}
              aria-label={t('shots.next')}
            >
              ›
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
