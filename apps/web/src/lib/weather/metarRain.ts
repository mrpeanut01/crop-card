/**
 * Hourly rain from raw METAR reports (Phase 32E, E4-2). Pure and
 * client-safe. The decoding rule is quoted in
 * `apps/web/scripts/water-sources.json` (FMH-1 `Prrrr`, `PNO`):
 *
 * - `Prrrr` in the remarks is hundredths of an inch since the last routine
 *   report; `P0000` is a trace and counts as 0.
 * - `PNO` means the gauge is out, so the hour is unknown.
 * - A routine report from an automated station (`AO1`/`AO2`) with no `P`
 *   group counts as 0; any other routine report without one is unknown.
 * - SPECI reports are ignored for rain. An hour with no routine report is
 *   unknown.
 */

import { HOUR_MS } from './leafWet';

export interface RainHour {
  /** Start of the hour the rain fell in, ms epoch (UTC, whole hour). */
  t: number;
  /** Inches, or null when the report says the gauge was out. */
  inches: number | null;
}

export interface MetarObservation {
  ms: number;
  raw: string;
}

export interface MetarRain {
  speci: boolean;
  automated: boolean;
  /** Inches since the last routine report; null = unknown. */
  inches: number | null;
}

const PRECIP_GROUP = /(?:^|\s)P(\d{4})(?=\s|$)/;
const SENSOR_OUT = /(?:^|\s)PNO(?=\s|$)/;
const AUTOMATED = /(?:^|\s)AO[12]A?(?=\s|$)/;

export function parseMetarRain(raw: string): MetarRain {
  const text = raw.trim().replace(/=$/, '').trim();
  const speci = /^SPECI\b/.test(text);
  const rmk = text.indexOf(' RMK ');
  const remarks = rmk >= 0 ? text.slice(rmk + 5) : '';
  const automated = AUTOMATED.test(remarks);
  if (SENSOR_OUT.test(remarks)) return { speci, automated, inches: null };
  const m = PRECIP_GROUP.exec(remarks);
  if (m) return { speci, automated, inches: Number(m[1]) / 100 };
  return { speci, automated, inches: automated ? 0 : null };
}

function minuteOf(ms: number): number {
  return new Date(ms).getUTCMinutes();
}

function minuteGap(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 60 - d);
}

/**
 * The station's routine reports go out at one fixed minute each hour. The
 * most common minute among non-SPECI reports is taken as that minute, and a
 * report within two minutes of it is routine. A routine report closes the
 * hour that ends at the nearest whole hour.
 */
export function routineRainHours(obs: readonly MetarObservation[]): RainHour[] {
  const parsed = obs
    .filter((o) => Number.isFinite(o.ms) && typeof o.raw === 'string' && o.raw.trim() !== '')
    .map((o) => ({ ms: o.ms, rain: parseMetarRain(o.raw) }))
    .filter((o) => !o.rain.speci);
  if (parsed.length === 0) return [];
  const counts = new Map<number, number>();
  for (const o of parsed) counts.set(minuteOf(o.ms), (counts.get(minuteOf(o.ms)) ?? 0) + 1);
  let modal = 0;
  let best = -1;
  for (const [minute, n] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
    if (n > best) {
      best = n;
      modal = minute;
    }
  }
  const byHour = new Map<number, { gap: number; inches: number | null }>();
  for (const o of parsed) {
    const gap = minuteGap(minuteOf(o.ms), modal);
    if (gap > 2) continue;
    const t = Math.round(o.ms / HOUR_MS) * HOUR_MS - HOUR_MS;
    const prev = byHour.get(t);
    if (prev && prev.gap <= gap) continue;
    byHour.set(t, { gap, inches: o.rain.inches });
  }
  return [...byHour.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, v]) => ({ t, inches: v.inches }));
}
