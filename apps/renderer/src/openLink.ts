/**
 * 打开外部链接：桌面端走系统浏览器（preload 桥），网页端走新标签页。
 *
 * 为什么不直接 <a target="_blank">：Electron 里 target="_blank" 会再开一个
 * Electron 窗口而不是系统浏览器，用户没法正常下载 JDK。
 */
export async function openExternalLink(url: string): Promise<void> {
  const bridge = window.warpweft;
  if (bridge && typeof bridge.openExternal === 'function') {
    await bridge.openExternal(url);
    return;
  }
  // 浏览器环境：noopener 避免新页面拿到 window.opener
  window.open(url, '_blank', 'noopener,noreferrer');
}
