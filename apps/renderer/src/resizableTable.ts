import { useEffect, useRef, useState } from 'react';
import type React from 'react';

function readStoredWidths(key: string, count: number): number[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== count) return null;
    const widths = parsed.map((value) => Number(value));
    return widths.every((value) => Number.isFinite(value) && value >= 24)
      ? widths.map((value) => Math.round(value))
      : null;
  } catch {
    return null;
  }
}

function persistWidths(key: string, widths: number[] | null) {
  if (typeof window === 'undefined') return;
  try {
    if (widths) window.localStorage.setItem(key, JSON.stringify(widths));
    else window.localStorage.removeItem(key);
  } catch {
    // Storage may be disabled in private windows; resizing still works.
  }
}

/**
 * Drag-to-resize column widths for one table. Widths are measured from the
 * rendered header on the first drag, then stored per table so a reload keeps
 * the layout the user chose.
 */
export function useColumnWidths(count: number, storageKey: string, minWidths: number[] = []) {
  const [widths, setWidths] = useState<number[] | null>(() => readStoredWidths(storageKey, count));
  const widthsRef = useRef<number[] | null>(widths);
  const drag = useRef<{ index: number; startX: number; start: number[] } | null>(null);

  useEffect(() => {
    widthsRef.current = widths;
  }, [widths]);

  const minOf = (index: number) => Math.max(32, Math.round(Number(minWidths[index]) || 56));

  const start = (index: number) => (event: React.PointerEvent<HTMLElement>) => {
    const table = event.currentTarget.closest('table');
    if (!table) return;
    const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>('thead th'));
    if (headers.length !== count) return;
    const measured = headers.map((header, headerIndex) =>
      Math.max(minOf(headerIndex), Math.round(header.getBoundingClientRect().width)),
    );
    drag.current = { index, startX: event.clientX, start: measured };
    widthsRef.current = measured;
    setWidths(measured);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const move = (event: React.PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current) return;
    const next = [...current.start];
    next[current.index] = Math.max(
      minOf(current.index),
      Math.round(current.start[current.index] + event.clientX - current.startX),
    );
    widthsRef.current = next;
    setWidths(next);
  };

  const end = (event: React.PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current = null;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture may already be gone after a cancel.
    }
    persistWidths(storageKey, widthsRef.current);
  };

  const reset = () => {
    drag.current = null;
    widthsRef.current = null;
    setWidths(null);
    persistWidths(storageKey, null);
  };

  const total = widths ? Math.max(24 * count, widths.reduce((sum, value) => sum + value, 0)) : 0;
  const tableStyle = widths
    ? { tableLayout: 'fixed' as const, width: total, minWidth: total }
    : undefined;

  return { widths, tableStyle, start, move, end, reset };
}

function readStoredSize(key: string): { width: number; height: number } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { width?: unknown; height?: unknown } | null;
    const width = Number(parsed?.width);
    const height = Number(parsed?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width: Math.round(width), height: Math.round(height) };
  } catch {
    return null;
  }
}

/** Drag the bottom-right grip to resize a panel; the size survives reloads. */
export function usePanelResize(
  storageKey: string,
  limits: { minWidth?: number; minHeight?: number; maxWidth?: number } = {},
) {
  const panelRef = useRef<HTMLElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(() => readStoredSize(storageKey));
  const sizeRef = useRef(size);
  const drag = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null);
  const minWidth = Math.max(240, limits.minWidth ?? 560);
  const minHeight = Math.max(160, limits.minHeight ?? 300);

  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  const start = (event: React.PointerEvent<HTMLElement>) => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    drag.current = { startX: event.clientX, startY: event.clientY, width: rect.width, height: rect.height };
    const measured = {
      width: Math.max(minWidth, Math.round(rect.width)),
      height: Math.max(minHeight, Math.round(rect.height)),
    };
    sizeRef.current = measured;
    setSize(measured);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const move = (event: React.PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current) return;
    const width = Math.max(minWidth, Math.round(current.width + event.clientX - current.startX));
    const height = Math.max(minHeight, Math.round(current.height + event.clientY - current.startY));
    const next = limits.maxWidth ? { width: Math.min(width, limits.maxWidth), height } : { width, height };
    sizeRef.current = next;
    setSize(next);
  };

  const end = (event: React.PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current = null;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture may already be gone after a cancel.
    }
    try {
      if (sizeRef.current) window.localStorage.setItem(storageKey, JSON.stringify(sizeRef.current));
    } catch {
      // Storage may be disabled; the in-memory size still works.
    }
  };

  const reset = () => {
    drag.current = null;
    sizeRef.current = null;
    setSize(null);
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Storage may be disabled.
    }
  };

  const style = size ? { width: size.width, height: size.height, maxWidth: '100%' } : undefined;
  return { panelRef, size, style, start, move, end, reset };
}
