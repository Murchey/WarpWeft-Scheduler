/**
 * 工作区文件的命名与格式判断。
 *
 * 工程文件只有一种格式：分片 JSON 的 ZIP（.zip）。旧的单文件
 * `.workspace.json` 在正式发版前已移除，不再保留解析与导出路径，
 * 避免维护两套格式。
 */

/** 工程包（分片 ZIP）的文件名。 */
export function workspaceArchiveFileName(name: string): string {
  const safe = (name.trim() || 'warpweft-workspace').replace(/[\/:*?"<>|]+/g, '-').replace(/\s+/g, '-');
  return safe.toLowerCase().endsWith('.zip') ? safe : safe + '.zip';
}

/** 通过 ZIP 魔数（PK\x03\x04）判断是否是工程包，不依赖扩展名。 */
export function isWorkspaceArchive(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 4) return false;
  const bytes = new Uint8Array(buffer, 0, 2);
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}
