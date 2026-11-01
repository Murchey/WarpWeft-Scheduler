import { useEffect, useState } from 'react';
import { fetchSiteConfig, DEFAULT_SITE_CONFIG, type SiteConfig } from './siteConfig';

/**
 * 读取部署配置。首帧先用默认值（不阻塞渲染），拿到后替换。
 * 配置文件缺失或损坏时保持默认值，官网照常显示。
 */
export function useSiteConfig(): SiteConfig {
  const [config, setConfig] = useState<SiteConfig>(DEFAULT_SITE_CONFIG);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    void fetchSiteConfig(controller.signal).then((next) => {
      if (alive) setConfig(next);
    });
    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  return config;
}
