/**
 * Calendar helpers for the demo farm (client-safe, no DB). Every visitor
 * gets a farm that looks live on the day they arrive, so all demo dates are
 * computed from `now` in the farm's zone.
 */

import { suggestPlanningYear, type PlanningFrost } from '$lib/season/planningYear';

export const DEMO_TIME_ZONE = 'America/New_York';
export const DEMO_LAT_LON = { lat: 39.11, lon: -77.56 } as const;

/** Frost dates as a Leesburg grower would type them (`MM-DD`). */
export const DEMO_FROST = {
  lastFrost: '04-20',
  firstFrost: '10-18',
  lastHardFrost: '04-02',
  firstHardFrost: '11-05'
} as const;

export const DEMO_PLANNING_FROST: PlanningFrost = {
  lastSpring: DEMO_FROST.lastFrost,
  firstFall: DEMO_FROST.firstFrost
};

/** Before this day the last season is complete and the next one is being
 *  planned; from it on, the calendar year is the season in the ground. */
export const SEASON_START_MMDD = '02-15';

export const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function wallClock(ms: number, timeZone: string) {
  const parts = partsFormatter(timeZone).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second')
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** The `YYYY-MM-DD` day `ms` falls on in `timeZone`. */
export function ymdOf(ms: number, timeZone: string = DEMO_TIME_ZONE): string {
  const w = wallClock(ms, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

export function parseYmd(ymd: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new Error(`not a YYYY-MM-DD date: ${ymd}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** UTC midnight of a calendar day: how date-only values (planting dates,
 *  tasks picked by day) are stored. */
export function utcDayMs(ymd: string): number {
  const { year, month, day } = parseYmd(ymd);
  return Date.UTC(year, month - 1, day);
}

export function ymdFromUtcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDaysYmd(ymd: string, days: number): string {
  return ymdFromUtcDay(utcDayMs(ymd) + days * DAY_MS);
}

export function daysBetweenYmd(from: string, to: string): number {
  return Math.round((utcDayMs(to) - utcDayMs(from)) / DAY_MS);
}

/** `year` plus a month-day. Feb 29 in a common year becomes Feb 28. */
export function ymdInYear(year: number, mmdd: string): string {
  const [mm, dd] = mmdd.split('-').map(Number);
  const last = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  return `${year}-${pad(mm)}-${pad(Math.min(dd, last))}`;
}

/** Shifts a day by whole months, clamping to the month's last day. */
export function addMonthsYmd(ymd: string, months: number): string {
  const { year, month, day } = parseYmd(ymd);
  const idx = year * 12 + (month - 1) + months;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad(m)}-${pad(Math.min(day, last))}`;
}

function offsetMs(ms: number, timeZone: string): number {
  const w = wallClock(ms, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - (ms - (((ms % 1000) + 1000) % 1000));
}

/** The instant a wall-clock time on `ymd` happens in `timeZone`. A time
 *  skipped by a spring-forward change lands an hour later. */
export function zonedMs(
  ymd: string,
  hour: number,
  minute = 0,
  timeZone: string = DEMO_TIME_ZONE
): number {
  const { year, month, day } = parseYmd(ymd);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = offsetMs(guess, timeZone);
  let t = guess - first;
  const second = offsetMs(t, timeZone);
  if (second !== first) t = guess - second;
  return t;
}

export interface DemoSeason {
  now: number;
  /** Today in the farm's zone. */
  today: string;
  year: number;
  /** The season whose crops are in the ground, or just finished. */
  current: number;
  /** The year /plan opens on (rolls over eight weeks before first frost). */
  planningYear: number;
  /** Next season's spring plantings are already on the plan. */
  nextSeasonPlanned: boolean;
}

export function demoSeason(now: number): DemoSeason {
  const today = ymdOf(now);
  const year = parseYmd(today).year;
  const current = today.slice(5) < SEASON_START_MMDD ? year - 1 : year;
  const planningYear = suggestPlanningYear(new Date(now), DEMO_PLANNING_FROST);
  return {
    now,
    today,
    year,
    current,
    planningYear,
    nextSeasonPlanned: planningYear > current
  };
}

/** mulberry32: a small deterministic PRNG. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable 32-bit hash of a string, for seeding `prng` per item. */
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
