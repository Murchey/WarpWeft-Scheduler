type ExportBridge = { saveExport?: (filename: string, data: ArrayBuffer) => Promise<string> };

async function download(content: BlobPart, type: string, filename: string): Promise<string | null> {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const bridge = (window as unknown as { warpweft?: ExportBridge }).warpweft;
  if (bridge?.saveExport) {
    return bridge.saveExport(filename, await blob.arrayBuffer());
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return null;
}

export { download };
