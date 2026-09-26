/**
 * Per-user display preferences: time zone and unit system.
 *
 * Every stored value stays in US units; conversion happens only when a
 * value is rendered (or, through `UnitInput`, when a non-safety form value
 * is entered). Pesticide label rates are shown label-unit first with the
 * metric equivalent alongside (`formatLabelRate`), because the label is
 * the legal document and the dilution/calibration math is built on it.
 */

import { DEFAULT_TIME_ZONE, type DisplayUnits } from './profile';

export interface Prefs {
  timeZone: string;
  units: DisplayUnits;
}

export const DEFAULT_PREFS: Prefs = { timeZone: DEFAULT_TIME_ZONE, units: 'us' };

// ─── Dates ──────────────────────────────────────────────────────────────

export type DateStyle =
  'date' | 'date-short' | 'date-long' | 'weekday' | 'month-day' | 'time' | 'datetime';

const STYLES: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  date: { month: 'short', day: 'numeric', year: 'numeric' },
  'date-short': { month: 'numeric', day: 'numeric', year: '2-digit' },
  'date-long': { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
  weekday: { weekday: 'short' },
  'month-day': { month: 'short', day: 'numeric' },
  time: { hour: 'numeric', minute: '2-digit' },
  datetime: { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
};

type Instant = Date | number | string;

function toDate(value: Instant): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A moment in time (a spray event's recordedAt, a login, a token's
 *  last use) rendered in the user's zone. */
export function formatInstant(
  value: Instant | null | undefined,
  prefs: Prefs,
  style: DateStyle = 'datetime',
  extra: Intl.DateTimeFormatOptions = {}
): string {
  if (value === null || value === undefined) return '—';
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleString('en-US', { ...STYLES[style], ...extra, timeZone: prefs.timeZone });
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar date (a planting date, a frost date, a `YYYY-MM-DD` string)
 *  rendered as the same day everywhere. Never shifted by the user's zone:
 *  May 1 is May 1 in Honolulu too. Full ISO timestamps are taken at their
 *  UTC day, which is how the app stores date-only values. */
export function formatCalendarDate(
  value: string | Date | number | null | undefined,
  style: Exclude<DateStyle, 'time' | 'datetime'> = 'date',
  extra: Intl.DateTimeFormatOptions = {}
): string {
  if (value === null || value === undefined || value === '') return '—';
  let d: Date | null;
  if (typeof value === 'string') {
    const m = YMD.exec(value.slice(0, 10));
    d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : toDate(value);
  } else {
    d = toDate(value);
  }
  if (!d) return '—';
  return d.toLocaleDateString('en-US', { ...STYLES[style], ...extra, timeZone: 'UTC' });
}

/** The `YYYY-MM-DD` day an instant falls on in `timeZone`. */
export function ymdInZone(value: Instant, timeZone: string): string {
  const d = toDate(value) ?? new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Today's date for the user, as `YYYY-MM-DD`. Use for date-input
 *  defaults; `new Date().toISOString().slice(0, 10)` is the UTC day and
 *  reads as tomorrow on a US evening. */
export function todayYmd(prefs: Pick<Prefs, 'timeZone'>, now: Instant = Date.now()): string {
  return ymdInZone(now, prefs.timeZone);
}

/** Short zone name for the instant, e.g. "EDT". */
export function zoneAbbrev(prefs: Pick<Prefs, 'timeZone'>, at: Instant = Date.now()): string {
  const d = toDate(at) ?? new Date();
  return (
    new Intl.DateTimeFormat('en-US', { timeZone: prefs.timeZone, timeZoneName: 'short' })
      .formatToParts(d)
      .find((p) => p.type === 'timeZoneName')?.value ?? prefs.timeZone
  );
}

// ─── Units ──────────────────────────────────────────────────────────────

export type Quantity =
  | 'area'
  | 'weight'
  | 'weightSmall'
  | 'weightPerArea'
  | 'volume'
  | 'volumePerArea'
  | 'flOzPerArea'
  | 'temperature'
  | 'temperatureDelta'
  | 'speed'
  | 'precip'
  | 'length'
  | 'distance'
  | 'perArea';

interface UnitDef {
  us: string;
  metric: string;
  toMetric: (v: number) => number;
  fromMetric: (v: number) => number;
  digits: { us: number; metric: number };
}

const scale = (k: number, digits: UnitDef['digits'], us: string, metric: string): UnitDef => ({
  us,
  metric,
  toMetric: (v) => v * k,
  fromMetric: (v) => v / k,
  digits
});

const ACRES_PER_HA = 2.471053814671653;

export const UNITS: Record<Quantity, UnitDef> = {
  area: scale(1 / ACRES_PER_HA, { us: 2, metric: 2 }, 'ac', 'ha'),
  weight: scale(0.45359237, { us: 0, metric: 0 }, 'lb', 'kg'),
  weightSmall: scale(28.349523125, { us: 1, metric: 0 }, 'oz', 'g'),
  weightPerArea: scale(0.45359237 * ACRES_PER_HA, { us: 0, metric: 0 }, 'lb/ac', 'kg/ha'),
  volume: scale(3.785411784, { us: 1, metric: 1 }, 'gal', 'L'),
  volumePerArea: scale(3.785411784 * ACRES_PER_HA, { us: 1, metric: 0 }, 'gal/ac', 'L/ha'),
  flOzPerArea: scale(29.5735295625 * ACRES_PER_HA, { us: 1, metric: 0 }, 'fl oz/ac', 'mL/ha'),
  temperature: {
    us: '°F',
    metric: '°C',
    toMetric: (f) => ((f - 32) * 5) / 9,
    fromMetric: (c) => (c * 9) / 5 + 32,
    digits: { us: 0, metric: 0 }
  },
  temperatureDelta: scale(5 / 9, { us: 0, metric: 0 }, '°F', '°C'),
  speed: scale(1.609344, { us: 0, metric: 0 }, 'mph', 'km/h'),
  precip: scale(25.4, { us: 2, metric: 1 }, 'in', 'mm'),
  length: scale(2.54, { us: 1, metric: 1 }, 'in', 'cm'),
  distance: scale(0.3048, { us: 0, metric: 0 }, 'ft', 'm'),
  perArea: scale(ACRES_PER_HA, { us: 0, metric: 0 }, '/ac', '/ha')
};

export function unitLabel(q: Quantity, prefs: Pick<Prefs, 'units'>): string {
  return UNITS[q][prefs.units];
}

/** Converts a stored US value to the user's system. */
export function toDisplay(value: number, q: Quantity, prefs: Pick<Prefs, 'units'>): number {
  return prefs.units === 'metric' ? UNITS[q].toMetric(value) : value;
}

/** Converts a value the user typed in their system back to stored US. */
export function fromDisplay(value: number, q: Quantity, prefs: Pick<Prefs, 'units'>): number {
  return prefs.units === 'metric' ? UNITS[q].fromMetric(value) : value;
}

function round(v: number, digits: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export interface FormatOpts {
  digits?: number;
  /** Omit the unit suffix (for table cells under a unit header). */
  bare?: boolean;
}

/** "12.5 ac" or "5.06 ha". Null/NaN renders as an em dash. */
export function formatQuantity(
  value: number | null | undefined,
  q: Quantity,
  prefs: Pick<Prefs, 'units'>,
  opts: FormatOpts = {}
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const def = UNITS[q];
  const digits = opts.digits ?? def.digits[prefs.units];
  const n = round(toDisplay(value, q, prefs), digits);
  if (opts.bare) return n;
  const unit = def[prefs.units];
  return unit.startsWith('°') || unit.startsWith('/') ? `${n}${unit}` : `${n} ${unit}`;
}

/** Label-unit first, metric alongside for metric users:
 *  "22 fl oz/ac (1,608 mL/ha)". Use for anything read off a pesticide
 *  label or fed to the dilution/calibration kernel. */
export function formatLabelRate(
  value: number | null | undefined,
  q: Quantity,
  prefs: Pick<Prefs, 'units'>,
  opts: FormatOpts = {}
): string {
  const us = formatQuantity(value, q, { units: 'us' }, opts);
  if (prefs.units !== 'metric' || us === '—') return us;
  return `${us} (${formatQuantity(value, q, prefs)})`;
}
