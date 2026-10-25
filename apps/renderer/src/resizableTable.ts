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
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic events (tests) may not have an active pointer to capture.
    }
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

/**
 * Column resizing for the plan table. Widths are keyed by column key so
 * hiding/showing a column never shifts another column's width. The first drag
 * measures every rendered header and switches the table to fixed layout.
 */
export function usePlanColumnWidths({
  widths,
  onChange,
  defaultWidths,
  minWidths,
}: {
  widths: Record<string, number> | null;
  onChange: (widths: Record<string, number> | null) => void;
  defaultWidths: Record<string, number>;
  minWidths: Record<string, number>;
}) {
  const drag = useRef<{ key: string; startX: number; start: Record<string, number> } | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const minOf = (key: string) => Math.max(32, Math.round(Number(minWidths[key]) || 56));

  const start = (key: string) => (event: React.PointerEvent<HTMLElement>) => {
    const table = event.currentTarget.closest('table');
    if (!table) return;
    const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>('thead th[data-plan-col]'));
    const measured: Record<string, number> = {};
    for (const header of headers) {
      const columnKey = header.dataset.planCol;
      if (!columnKey) continue;
      measured[columnKey] = Math.max(minOf(columnKey), Math.round(header.getBoundingClientRect().width));
    }
    if (!measured[key]) return;
    drag.current = { key, startX: event.clientX, start: measured };
    setActive(key);
    onChange(measured);
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic events (tests) may not have an active pointer to capture.
    }
    event.preventDefault();
  };

  const move = (event: React.PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current) return;
    const next = { ...current.start };
    next[current.key] = Math.max(
      minOf(current.key),
      Math.round(current.start[current.key] + event.clientX - current.startX),
    );
    onChange(next);
  };

  const end = (event: React.PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current = null;
    setActive(null);
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture may already be gone after a cancel.
    }
  };

  /** Double-click a separator: put that column back to its default width. */
  const resetColumn = (key: string) => {
    const next = { ...(widths ?? {}) };
    for (const [columnKey, width] of Object.entries(defaultWidths)) {
      if (!(columnKey in next)) next[columnKey] = width;
    }
    next[key] = defaultWidths[key] ?? minOf(key);
    onChange(next);
  };

  const resetAll = () => onChange(null);

  return { start, move, end, resetColumn, resetAll, active };
}
