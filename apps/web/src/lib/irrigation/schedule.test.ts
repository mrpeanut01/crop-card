import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dateTimeFormat } from '$lib/intlCache';
import { IRRIGATION_SKIP_REASONS } from '$lib/db/schema';
import { IRRIGATION_SKIP_REASON_VALUES, irrigationScheduleSchema } from './apiSchemas';
import {
  expandRuns,
  nextRun,
  sameProgram,
  scheduleOf,
  timerLogs,
  withoutSkipped,
  zonedWallMs,
  type Waterer
} from './schedule';

const NY = 'America/New_York';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 168 * HOUR;

function wall(ms: number, timeZone: string) {
  const parts = dateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { weekday: wd, hhmm: `${get('hour')}:${get('minute')}` };
}

/** Every quarter hour in the window (start times and every zone offset
 *  here are whole quarter hours) whose wall clock reads the start time on a
 *  scheduled day; a repeated hour keeps its first instant, even when that
 *  first instant falls just before the window opens (the scan starts two
 *  hours early so a window cut between the two 01:00s of a fall-back night
 *  sees the same run set as the whole week). */
function bruteForce(days: number[], start: string, fromMs: number, toMs: number, tz: string) {
  const out: number[] = [];
  const step = 15 * 60_000;
  let prev: number | undefined;
  for (let t = Math.ceil((fromMs - 2 * HOUR) / step) * step; t < toMs; t += step) {
    const w = wall(t, tz);
    if (w.hhmm !== start || !days.includes(w.weekday)) continue;
    if (prev !== undefined && t - prev < 2 * HOUR) continue;
    prev = t;
    if (t >= fromMs) out.push(t);
  }
  return out;
}

const zones = fc.constantFrom(
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Australia/Sydney',
  'Asia/Kolkata',
  'UTC'
);
const startTimes = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.constantFrom(0, 15, 30, 45))
  .map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
const dayLists = fc.uniqueArray(fc.integer({ min: 0, max: 6 }), { minLength: 1, maxLength: 7 });
// Windows around the 2026 and 2027 DST changes in both hemispheres.
const anchors = [
  Date.UTC(2026, 2, 8),
  Date.UTC(2026, 10, 1),
  Date.UTC(2026, 3, 5),
  Date.UTC(2026, 9, 4),
  Date.UTC(2026, 2, 29),
  Date.UTC(2026, 9, 25),
  Date.UTC(2027, 0, 1)
];
const windowStarts = fc
  .tuple(fc.constantFrom(...anchors), fc.integer({ min: -4 * 24, max: 4 * 24 }))
  .map(([a, h]) => a + h * HOUR + 17 * 60_000);

describe('zonedWallMs', () => {
  it('maps a normal wall time to its instant', () => {
    expect(zonedWallMs(2026, 6, 15, 6, 0, NY)).toBe(Date.UTC(2026, 5, 15, 10, 0));
  });

  it('keeps the earlier instant in the repeated fall-back hour', () => {
    expect(zonedWallMs(2026, 11, 1, 1, 30, NY)).toBe(Date.UTC(2026, 10, 1, 5, 30));
  });

  it('moves a time skipped by spring forward an hour later', () => {
    const t = zonedWallMs(2026, 3, 8, 2, 30, NY);
    expect(t).toBe(Date.UTC(2026, 2, 8, 7, 30));
    expect(wall(t, NY).hhmm).toBe('03:30');
  });
});

describe('expandRuns', () => {
  it('gives Mon, Wed and Fri at 6:00 inside one week', () => {
    const from = Date.UTC(2026, 5, 14, 12);
    const runs = expandRuns(
      { days: [1, 3, 5], start: '06:00' },
      { fromMs: from, toMs: from + WEEK, timeZone: NY }
    );
    expect(runs.map((r) => wall(r, NY))).toEqual([
      { weekday: 1, hhmm: '06:00' },
      { weekday: 3, hhmm: '06:00' },
      { weekday: 5, hhmm: '06:00' }
    ]);
  });

  it('never counts runs from before the schedule was set up', () => {
    const from = Date.UTC(2026, 5, 14, 12);
    const all = expandRuns(
      { days: [0, 1, 2, 3, 4, 5, 6], start: '06:00' },
      { fromMs: from, toMs: from + WEEK, timeZone: NY }
    );
    const later = expandRuns(
      { days: [0, 1, 2, 3, 4, 5, 6], start: '06:00', activeFrom: all[3] },
      { fromMs: from, toMs: from + WEEK, timeZone: NY }
    );
    expect(later).toEqual(all.slice(3));
  });

  it('a window that opens between the two 01:00s of a fall-back night has no run (earlier instant wins)', () => {
    const LA = 'America/Los_Angeles';
    const from = 1793521020000; // 2026-11-01 01:17 PDT, 43 min before 01:00 PST
    const runs = expandRuns(
      { days: [0], start: '01:00' },
      { fromMs: from, toMs: from + WEEK, timeZone: LA }
    );
    expect(runs).toEqual(bruteForce([0], '01:00', from, from + WEEK, LA));
    expect(runs.some((r) => wall(r, LA).hhmm === '01:00' && r < from + DAY)).toBe(false);
  });

  it('matches a quarter-hour scan across DST changes and the week boundary', () => {
    fc.assert(
      fc.property(dayLists, startTimes, windowStarts, zones, (days, start, from, tz) => {
        const to = from + WEEK;
        const runs = expandRuns({ days, start }, { fromMs: from, toMs: to, timeZone: tz });
        const scan = bruteForce(days, start, from, to, tz);
        const gapRuns = runs.filter((r) => wall(r, tz).hhmm !== start);
        expect(runs.filter((r) => !gapRuns.includes(r))).toEqual(scan);
        for (const r of gapRuns) {
          expect(r).toBeGreaterThanOrEqual(from);
          expect(r).toBeLessThan(to);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('keeps runs sorted, unique, inside the window and on scheduled days', () => {
    fc.assert(
      fc.property(dayLists, startTimes, windowStarts, zones, (days, start, from, tz) => {
        const runs = expandRuns({ days, start }, { fromMs: from, toMs: from + WEEK, timeZone: tz });
        for (let i = 1; i < runs.length; i++) expect(runs[i]).toBeGreaterThan(runs[i - 1]);
        for (const r of runs) {
          expect(r).toBeGreaterThanOrEqual(from);
          expect(r).toBeLessThan(from + WEEK);
        }
        expect(runs.length).toBeGreaterThanOrEqual(days.length - 1);
        expect(runs.length).toBeLessThanOrEqual(days.length + 1);
      }),
      { numRuns: 200 }
    );
  });

  it('splits cleanly at any boundary: two halves give the whole', () => {
    fc.assert(
      fc.property(
        dayLists,
        startTimes,
        windowStarts,
        zones,
        fc.integer({ min: 1, max: 167 }),
        (days, start, from, tz, cutH) => {
          const to = from + WEEK;
          const cut = from + cutH * HOUR;
          const whole = expandRuns({ days, start }, { fromMs: from, toMs: to, timeZone: tz });
          const a = expandRuns({ days, start }, { fromMs: from, toMs: cut, timeZone: tz });
          const b = expandRuns({ days, start }, { fromMs: cut, toMs: to, timeZone: tz });
          expect([...a, ...b]).toEqual(whole);
        }
      ),
      { numRuns: 200 }
    );
  });
});

const drip: Waterer = {
  equipmentId: 'eq-1',
  label: 'Drip timer',
  schedule: {
    days: [1, 3, 5],
    start: '06:00',
    minutes: 20,
    method: 'drip',
    inchesPerRun: 0.4,
    activeFrom: 0
  },
  targets: [{ fieldId: 'f1', blockId: null }]
};

describe('timer logs and skips', () => {
  const from = Date.UTC(2026, 5, 14, 12);
  const runs = expandRuns(drip.schedule, { fromMs: from, toMs: from + WEEK, timeZone: NY });

  it('turns each past run into a manual watering with the typed amount', () => {
    const logs = timerLogs(drip, runs, 'f1', from + WEEK);
    expect(logs).toHaveLength(3);
    expect(logs[0]).toMatchObject({
      blockId: null,
      inches: 0.4,
      durationMin: 20,
      provenance: 'manual',
      timer: { equipmentId: 'eq-1', label: 'Drip timer' }
    });
  });

  it('leaves future runs out and other Areas alone', () => {
    expect(timerLogs(drip, runs, 'f1', runs[0])).toHaveLength(1);
    expect(timerLogs(drip, runs, 'f2', from + WEEK)).toEqual([]);
  });

  it('keeps the amount unknown with no inches, and gallons only for one target', () => {
    const noAmount = { ...drip, schedule: { ...drip.schedule, inchesPerRun: null } };
    expect(timerLogs(noAmount, runs, 'f1', from + WEEK)[0]).toMatchObject({
      inches: null,
      gallons: null
    });
    const gpm = { ...noAmount, schedule: { ...noAmount.schedule, gallonsPerMinute: 2 } };
    expect(timerLogs(gpm, runs, 'f1', from + WEEK)[0]).toMatchObject({ gallons: 40 });
    const twoBeds = {
      ...gpm,
      targets: [
        { fieldId: 'f1', blockId: 'b1' },
        { fieldId: 'f1', blockId: 'b2' }
      ]
    };
    const logs = timerLogs(twoBeds, runs, 'f1', from + WEEK);
    expect(logs).toHaveLength(6);
    expect(logs.every((l) => l.gallons === null)).toBe(true);
  });

  it('drops a skipped run and moves the next run on', () => {
    expect(withoutSkipped(runs, [runs[1]])).toEqual([runs[0], runs[2]]);
    const next = nextRun(drip, { nowMs: from, timeZone: NY, skippedAt: [] });
    expect(next).toBe(runs[0]);
    expect(nextRun(drip, { nowMs: from, timeZone: NY, skippedAt: [runs[0]] })).toBe(runs[1]);
  });
});

describe('schedule parsing', () => {
  it('reads a stored schedule and ignores anything else', () => {
    expect(scheduleOf({ schedule: drip.schedule })).toEqual(drip.schedule);
    expect(scheduleOf({ schedule: { days: [9] } })).toBeNull();
    expect(scheduleOf(undefined)).toBeNull();
  });

  it('refuses repeated days, bad times and over-long runs', () => {
    const ok = { days: [1], start: '06:00', minutes: 20, method: 'drip' };
    expect(irrigationScheduleSchema.safeParse(ok).success).toBe(true);
    expect(irrigationScheduleSchema.safeParse({ ...ok, days: [1, 1] }).success).toBe(false);
    expect(irrigationScheduleSchema.safeParse({ ...ok, start: '24:00' }).success).toBe(false);
    expect(irrigationScheduleSchema.safeParse({ ...ok, minutes: 721 }).success).toBe(false);
  });

  it('sees a reordered day list as the same program', () => {
    expect(sameProgram({ ...drip.schedule, days: [5, 1, 3] }, drip.schedule)).toBe(true);
    expect(sameProgram({ ...drip.schedule, minutes: 25 }, drip.schedule)).toBe(false);
  });

  it('keeps the skip reasons equal to the table enum', () => {
    expect([...IRRIGATION_SKIP_REASON_VALUES]).toEqual([...IRRIGATION_SKIP_REASONS]);
  });
});

describe('a full day of runs', () => {
  it('runs every day once a day', () => {
    const from = Date.UTC(2026, 0, 5);
    expect(
      expandRuns(
        { days: [0, 1, 2, 3, 4, 5, 6], start: '05:00' },
        { fromMs: from, toMs: from + DAY, timeZone: 'UTC' }
      )
    ).toEqual([from + 5 * HOUR]);
  });
});
