/**
 * 剪贴板写入。Clipboard API 在非安全上下文或被拒绝时会失败，
 * 此时降级为隐藏 textarea + execCommand；两路都失败返回 false，
 * 由调用方提示用户手动复制（不再使用 window.prompt —— Electron 不支持它）。
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 权限被拒或非安全上下文：继续走降级方案
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '0';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
