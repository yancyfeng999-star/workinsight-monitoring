export function formatDateTime(value: string | null | undefined, empty = "—"): string {
  if (!value) return empty;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return empty;
  return date.toLocaleString("zh-CN");
}

export function formatTime(value: string | null | undefined, empty = "—"): string {
  if (!value) return empty;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return empty;
  return date.toLocaleTimeString("zh-CN");
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
