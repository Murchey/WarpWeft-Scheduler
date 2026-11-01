import React, { useState } from 'react';
import { useSiteI18n } from '../i18n';
import { useSiteConfig } from '../useSiteConfig';

/**
 * 顶部提示区：可同时出现「私有实例」与「公告」两条。
 *
 * - 私有实例：常驻提示，可折叠但不能永久关闭 —— 它的作用是让访客始终知道
 *   这个域名不是开发者官方站点，关掉就失去意义。
 * - 公告：运维填写的横幅正文，可手动关闭（关闭状态只记在本次会话内，
 *   刷新后重新出现，避免访客错过新公告）。
 */
export function SiteNotice() {
  const { t } = useSiteI18n();
  const config = useSiteConfig();
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [noticeCollapsed, setNoticeCollapsed] = useState(false);

  const showPrivate = config.privateInstance;
  const showNotice = Boolean(config.announcement) && !noticeDismissed;
  if (!showPrivate && !showNotice) return null;

  return (
    <div className="site-notice-stack">
      {showPrivate ? (
        <div className="site-notice is-private" role="status">
          <span className="site-notice-tag">{t('notice.privateTag')}</span>
          <span className="site-notice-text">{t('notice.privateBody')}</span>
          <button
            type="button"
            className="site-notice-action"
            aria-expanded={!noticeCollapsed}
            onClick={() => setNoticeCollapsed((value) => !value)}
          >
            {noticeCollapsed ? t('notice.expand') : t('notice.collapse')}
          </button>
        </div>
      ) : null}

      {showNotice && !noticeCollapsed ? (
        <div className="site-notice is-announce" role="status">
          <span className="site-notice-tag">{t('notice.announceTag')}</span>
          <span className="site-notice-text">{config.announcement}</span>
          <button
            type="button"
            className="site-notice-action"
            aria-label={t('notice.dismiss')}
            onClick={() => setNoticeDismissed(true)}
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
