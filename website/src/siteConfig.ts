/**
 * 官网部署期配置：/site/site-config.json。
 *
 * 为什么用运行时 JSON 而不是构建期注入：
 * 备案号、公告、私有实例标识都属于「买家/运维随时会改」的信息，
 * 放在 public/ 下原样复制到 dist/site/，改完刷新即生效，无需重新构建打包。
 *
 * 所有字段都可缺失：文件不存在、JSON 损坏、字段类型不对时一律回落默认值，
 * 官网必须能照常渲染 —— 配置文件是可选增强，不是启动前提。
 */

export interface SiteConfig {
  /** 顶部是否显示「用户私有配置页面，非官方」提示。 */
  privateInstance: boolean;
  /** 顶部横幅公告正文；空串表示不显示。 */
  announcement: string;
  /** 网站底部 ICP 备案号，如「京ICP备00000000号-1」；空串表示不显示。 */
  icp: string;
  /** 公安备案号（后续使用）；空串表示不显示。 */
  police: string;
}

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  privateInstance: false,
  announcement: '',
  icp: '',
  police: '',
};

/** 配置文件位置：与 base '/site/' 对齐，部署后可直接编辑 dist/site/site-config.json。 */
export const SITE_CONFIG_PATH = '/site/site-config.json';

function text(value: unknown, max = 200): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

/** 把任意 JSON 归一化成合法配置；未知字段忽略，类型错误静默回落。 */
export function normalizeSiteConfig(raw: unknown): SiteConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_SITE_CONFIG };
  const value = raw as Record<string, unknown>;
  return {
    // 只认严格的 true，避免 "false" 字符串被误判成开启。
    privateInstance: value.privateInstance === true,
    announcement: text(value.announcement, 300),
    icp: text(value.icp, 80),
    police: text(value.police, 80),
  };
}

export async function fetchSiteConfig(signal?: AbortSignal): Promise<SiteConfig> {
  try {
    const response = await fetch(SITE_CONFIG_PATH, {
      cache: 'no-cache',
      credentials: 'omit',
      signal,
    });
    if (!response.ok) return { ...DEFAULT_SITE_CONFIG };
    const contentType = response.headers.get('Content-Type') || '';
    // Nginx 的 SPA 兜底可能把未知路径回成 index.html（text/html），
    // 那种情况解析必然失败，直接回落，避免把 HTML 当配置读。
    if (contentType.includes('text/html')) return { ...DEFAULT_SITE_CONFIG };
    return normalizeSiteConfig(JSON.parse(await response.text()));
  } catch {
    // 网络失败 / 文件缺失 / JSON 语法错误 / abort：一律静默回落。
    return { ...DEFAULT_SITE_CONFIG };
  }
}
