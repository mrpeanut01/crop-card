/**
 * Phase 32F (F1-18). Pure sums over task time rows. The DB read is
 * `lib/db/taskTime.ts`.
 */

export interface MinutesRow {
  minutes: number;
  cropId?: string | null;
  userId?: string | null;
  fieldId?: string | null;
}

export type HoursKey = 'crop' | 'user' | 'field';

const KEY_OF: Record<HoursKey, (r: MinutesRow) => string | null | undefined> = {
  crop: (r) => r.cropId,
  user: (r) => r.userId,
  field: (r) => r.fieldId
};

/** Total minutes per crop, person or field. Rows without that link are
 *  left out; rows with a non-positive or non-finite minute count too. */
export function sumMinutes(rows: readonly MinutesRow[], by: HoursKey): Map<string, number> {
  const keyOf = KEY_OF[by];
  const out = new Map<string, number>();
  for (const r of rows) {
    const key = keyOf(r);
    if (!key || !Number.isFinite(r.minutes) || r.minutes <= 0) continue;
    out.set(key, (out.get(key) ?? 0) + Math.round(r.minutes));
  }
  return out;
}

export function totalMinutes(rows: readonly Pick<MinutesRow, 'minutes'>[]): number {
  let n = 0;
  for (const r of rows) if (Number.isFinite(r.minutes) && r.minutes > 0) n += Math.round(r.minutes);
  return n;
}

/** "45 min" up to an hour, then hours to the nearest quarter: "1.5 h",
 *  "2.25 h", "6 h". */
export function formatHours(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m <= 60) return m === 60 ? '1 h' : `${m} min`;
  const quarters = Math.round(m / 15) / 4;
  return `${Number.isInteger(quarters) ? quarters : String(quarters)} h`;
}

/** The whole-minute field on the Done sheet (F1-12): 1 to 720. */
export const MIN_TASK_MINUTES = 1;
export const MAX_TASK_MINUTES = 720;

export function isTaskMinutes(n: unknown): n is number {
  return (
    typeof n === 'number' && Number.isInteger(n) && n >= MIN_TASK_MINUTES && n <= MAX_TASK_MINUTES
  );
}

export const DONE_TIME_CHIPS = [
  { minutes: 15, label: '15 m' },
  { minutes: 30, label: '30 m' },
  { minutes: 60, label: '1 h' },
  { minutes: 120, label: '2 h' }
] as const;
