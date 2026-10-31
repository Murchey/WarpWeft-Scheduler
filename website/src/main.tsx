import React from 'react';
import { createRoot } from 'react-dom/client';
import { SiteI18nProvider } from './i18n';
import { applyTheme, readThemeMode } from './theme';
import { SiteApp } from './SiteApp';
import './site.css';

// 主题在挂载前同步写入，避免首帧闪白。存储键与产品界面共用。
applyTheme(readThemeMode());

const container = document.getElementById('site-root');
if (!container) throw new Error('官网挂载点 #site-root 缺失');

createRoot(container).render(
  <React.StrictMode>
    <SiteI18nProvider>
      <SiteApp />
    </SiteI18nProvider>
  </React.StrictMode>,
);
