import React, { useEffect, useState } from 'react';
import { useI18n, type MessageKey } from './i18n';
import { openExternalLink } from './openLink';

/**
 * JDK 下载源。只列官方来源，避免引导用户去第三方下载站。
 * 顺序 = 推荐程度：Oracle 收费但兼容性最稳，Microsoft 与 OpenJDK 免费。
 */
const JDK_SOURCES: { key: MessageKey; url: string }[] = [
  {
    key: 'java.source.oracle',
    url: 'https://www.oracle.com/java/technologies/javase/jdk21-archive-downloads.html',
  },
  { key: 'java.source.microsoft', url: 'https://learn.microsoft.com/zh-cn/java/openjdk/download' },
  { key: 'java.source.openjdk', url: 'https://jdk.java.net/21/' },
];

export interface JavaCheckDialogProps {
  /** 探测到的 Java 版本号；null 表示压根没找到 java 命令。 */
  detectedVersion: string | null;
  /** 重新探测（用户装完 JDK 后点它）。 */
  onRecheck: () => void;
  /** 稍后再说：关掉弹窗，不影响其它功能。 */
  onClose: () => void;
}

/**
 * JDK 环境检测提示。
 *
 * 排课必须跑 Java 求解器（JDK 21+）；缺了它其它功能都正常，只有排课会失败。
 * 因此这里做成**非阻断**弹窗：可关闭、可稍后再说，装完 JDK 点「重新检测」即可，
 * 不需要重启应用。
 */
export function JavaCheckDialog(props: JavaCheckDialogProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const found = Boolean(props.detectedVersion);

  // Escape 关闭，沿用 PromptDialog 的行为
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [props.onClose]);

  const recheck = () => {
    setBusy(true);
    props.onRecheck();
    // 交给外层重新探测，稍后复位按钮，避免连续点击
    window.setTimeout(() => setBusy(false), 800);
  };

  return (
    <div
      className="rule-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="java-check-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div className="rule-dialog java-check-dialog">
        <div className="rule-dialog-head">
          <div>
            <h2 id="java-check-title">{found ? t('java.titleOld') : t('java.titleMissing')}</h2>
            <p>{found ? t('java.leadOld', { version: props.detectedVersion ?? '' }) : t('java.leadMissing')}</p>
          </div>
          <button
            type="button"
            className="banner-close"
            onClick={props.onClose}
            aria-label={t('common.close')}
          >
            ×
          </button>
        </div>

        <div className="rule-dialog-body">
          <div className="java-check-links">
            {JDK_SOURCES.map((source) => (
              <a
                key={source.key}
                className="java-check-link"
                href={source.url}
                onClick={(event) => {
                  event.preventDefault();
                  void openExternalLink(source.url);
                }}
              >
                <b>{t(source.key)}</b>
                <small>{source.url}</small>
              </a>
            ))}
          </div>
          <p className="panel-note">{t('java.hintHome')}</p>
        </div>

        <div className="rule-dialog-actions">
          <button type="button" className="tt-btn tt-btn-quiet" onClick={props.onClose}>
            {t('java.later')}
          </button>
          <button type="button" className="tt-btn tt-btn-primary" onClick={recheck} disabled={busy}>
            {busy ? t('java.checking') : t('java.recheck')}
          </button>
        </div>
      </div>
    </div>
  );
}
