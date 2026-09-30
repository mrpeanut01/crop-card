/** The local calendar day of `ms`, as `YYYY-MM-DD` (the date input's format). */
export function localDayInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The instant a tray logged "sown on `day`" is saved with: now for today
 * (so it is never in the future), local noon for any other day. Null for
 * an unreadable day.
 */
export function traySownAt(day: string, nowMs: number): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  if (day === localDayInput(nowMs)) return nowMs;
  const ms = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).getTime();
  return Number.isFinite(ms) ? ms : null;
}
