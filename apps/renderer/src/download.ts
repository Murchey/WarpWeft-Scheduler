export type ExportStatus = 'saved' | 'downloaded' | 'canceled' | 'failed';

export interface ExportResult {
  status: ExportStatus;
  path?: string;
  error?: string;
}

interface BridgeResult {
  status?: string;
  path?: string;
  error?: string;
}

type ExportBridge = {
  saveExport?: (filename: string, data: ArrayBuffer) => Promise<BridgeResult | string>;
};

interface SavePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{
    name?: string;
    createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
  }>;
}

/**
 * Blob accepts an ArrayBuffer or an ArrayBufferView directly. Callers used to
 * pass `bytes.buffer`, which is `undefined` for an ArrayBuffer and can carry
 * unrelated neighbouring bytes for a typed-array view — both produced corrupt
 * exports.
 */
export function blobPartOf(content: ArrayBuffer | ArrayBufferView | Blob | string): BlobPart {
  if (typeof content === 'string') return content;
  if (content instanceof Blob) return content;
  if (content instanceof ArrayBuffer) return content;
  return new Uint8Array(content.buffer, content.byteOffset, content.byteLength).slice();
}

function fileExtension(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index === -1 ? '' : filename.slice(index + 1).toLowerCase();
}

function pickerAccept(type: string, filename: string): Record<string, string[]> {
  const extension = fileExtension(filename);
  const mime = type.split(';')[0] || 'application/octet-stream';
  return { [mime]: extension ? ['.' + extension] : [] };
}

async function download(content: ArrayBuffer | ArrayBufferView | Blob | string, type: string, filename: string): Promise<ExportResult> {
  let blob: Blob;
  try {
    blob = content instanceof Blob ? content : new Blob([blobPartOf(content)], { type });
  } catch (cause) {
    return { status: 'failed', error: cause instanceof Error ? cause.message : String(cause) };
  }
  const bridge = (window as unknown as { warpweft?: ExportBridge }).warpweft;
  if (bridge?.saveExport) {
    try {
      const result = await bridge.saveExport(filename, await blob.arrayBuffer());
      // Older shells returned a bare path; keep accepting it.
      if (typeof result === 'string') return result ? { status: 'saved', path: result } : { status: 'canceled' };
      if (result?.status === 'canceled') return { status: 'canceled' };
      if (result?.status === 'failed') return { status: 'failed', error: result.error || '写入文件失败' };
      return { status: 'saved', path: result?.path };
    } catch (cause) {
      return { status: 'failed', error: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  const picker = (window as unknown as SavePickerWindow).showSaveFilePicker;
  if (typeof picker === 'function') {
    try {
      const handle = await picker.call(window, {
        suggestedName: filename,
        types: [{ description: '导出文件', accept: pickerAccept(type, filename) }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { status: 'saved', path: handle.name };
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return { status: 'canceled' };
      // A blocked/invalid picker falls back to the browser download below.
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { status: 'downloaded' };
}

/**
 * One place to turn an export result into user-facing text. Cancellation is not
 * an error and produces no notice at all.
 */
export function exportMessage(result: ExportResult, what: string): { tone: 'success' | 'error'; text: string } | null {
  if (result.status === 'canceled') return null;
  if (result.status === 'failed') {
    return { tone: 'error', text: what + '保存失败：' + (result.error || '未知错误') };
  }
  if (result.status === 'saved' && result.path) {
    return { tone: 'success', text: what + '已保存到 ' + result.path };
  }
  return { tone: 'success', text: what + '已开始下载，请查看浏览器下载目录' };
}

export { download };
