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
