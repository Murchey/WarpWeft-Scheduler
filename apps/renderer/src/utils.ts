export function uid(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return prefix + '-' + random.slice(0, 8);
}

export function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/** Local calendar date as YYYY-MM-DD (not the UTC date toISOString would give). */
export function todayLocal(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return now.getFullYear() + '-' + month + '-' + day;
}
