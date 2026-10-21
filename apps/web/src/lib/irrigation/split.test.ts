import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { logInches, waterBalance, type WaterLog } from '$lib/weather/waterBalance';
import { GALLONS_PER_SQFT_INCH } from '$lib/weather/waterSources';
import type { StoredSchedule } from './apiSchemas';
import {
  countsFromMs,
  expandRuns,
  gallonsSplit,
  runGallons,
  runInches,
  targetGallons,
  timerLogs,
  zonedWallMs,
  type Waterer,
  type WatererTarget
} from './schedule';

// #870: the gallons split across a timer's targets (FU870-1) and the
// owner's "running since" day (FU870-4).

const NY = 'America/New_York';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** `timerLogs` and its gallons rule exactly as they were before #870, kept
 *  here so a single-target timer is proven byte-identical. */
function legacyTimerLogs(
  w: Waterer,
  runs: readonly number[],
  fieldId: string,
  nowMs: number
): WaterLog[] {
  const legacyGallons = (x: Waterer): number | null => {
    const gpm = x.schedule.gallonsPerMinute;
    if (gpm === null || gpm === undefined || x.targets.length !== 1) return null;
    return gpm * x.schedule.minutes;
  };
  const targets = w.targets.filter((t) => t.fieldId === fieldId);
  const inches = runInches(w);
  const gallons = inches === null ? legacyGallons(w) : null;
  return runs
    .filter((t) => t <= nowMs)
    .flatMap((t) =>
      targets.map((target) => ({
        occurredAtMs: t,
        blockId: target.blockId,
        inches,
        gallons,
        durationMin: w.schedule.minutes,
        provenance: 'manual' as const,
        timer: { equipmentId: w.equipmentId, label: w.label }
      }))
    );
}

const schedule = (over: Partial<StoredSchedule> = {}): StoredSchedule => ({
  days: [0, 1, 2, 3, 4, 5, 6],
  start: '06:00',
  minutes: 20,
  method: 'drip',
  inchesPerRun: null,
  gallonsPerMinute: 2,
  activeFrom: 0,
  ...over
});

const waterer = (targets: WatererTarget[], over: Partial<StoredSchedule> = {}): Waterer => ({
  equipmentId: 'eq-1',
  label: 'Drip timer',
  schedule: schedule(over),
  targets
});

const size = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.constant(0),
  fc.double({ min: 1, max: 5000, noNaN: true })
);
const share = fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 100 }));
const targetArb: fc.Arbitrary<WatererTarget> = fc.record({
  fieldId: fc.constantFrom('f1', 'f2'),
  blockId: fc.oneof(fc.constant(null), fc.constantFrom('b1', 'b2', 'b3')),
  sharePct: share,
  sqFt: size
});
const runsArb = fc
  .uniqueArray(fc.integer({ min: 0, max: 20 }), { maxLength: 8 })
  .map((hs) => hs.sort((a, b) => a - b).map((h) => Date.UTC(2026, 5, 1) + h * HOUR));

describe('a single target is byte-identical to before (golden)', () => {
  it('matches the old timer logs for every amount, size and share', () => {
    fc.assert(
      fc.property(
        targetArb,
        fc.oneof(fc.constant(null), fc.double({ min: 0.01, max: 5, noNaN: true })),
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.double({ min: 0.1, max: 500, noNaN: true })
        ),
        fc.integer({ min: 1, max: 720 }),
        runsArb,
        (target, inchesPerRun, gallonsPerMinute, minutes, runs) => {
          const w = waterer([target], { inchesPerRun, gallonsPerMinute, minutes });
          const now = Date.UTC(2026, 5, 1, 12);
          for (const field of ['f1', 'f2']) {
            expect(timerLogs(w, runs, field, now)).toStrictEqual(
              legacyTimerLogs(w, runs, field, now)
            );
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it('gives one target every gallon, whatever its size', () => {
    for (const sqFt of [null, 0, 40]) {
      const w = waterer([{ fieldId: 'f1', blockId: 'b1', sqFt, sharePct: 30 }]);
      expect(targetGallons(w)).toEqual([40]);
      expect(gallonsSplit(w.targets)).toEqual({ known: true, fractions: [1], source: 'single' });
    }
  });
});

describe('gallonsSplit (FU870-1)', () => {
  const sized = (n: number) =>
    fc.array(fc.double({ min: 1, max: 5000, noNaN: true }), { minLength: n, maxLength: n });

  it('splits by size when every target has one and none overlap', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 6 }).chain(sized), (sizes) => {
        const targets = sizes.map((sqFt, i) => ({ fieldId: 'f1', blockId: `b${i}`, sqFt }));
        const split = gallonsSplit(targets);
        expect(split.known).toBe(true);
        if (!split.known) return;
        expect(split.source).toBe('size');
        const total = sizes.reduce((a, b) => a + b, 0);
        split.fractions.forEach((f, i) => expect(f).toBeCloseTo(sizes[i] / total, 12));
        expect(split.fractions.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      })
    );
  });

  it('never falls back to an even split: one target without a size leaves it not known', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }).chain(sized),
        fc.nat(),
        fc.constantFrom(null, undefined, 0, -3, Number.NaN),
        (sizes, pick, missing) => {
          const targets = sizes.map((sqFt, i) => ({
            fieldId: 'f1',
            blockId: `b${i}`,
            sqFt: i === pick % sizes.length ? missing : sqFt
          }));
          expect(gallonsSplit(targets)).toEqual({ known: false, reason: 'no-size' });
          expect(targetGallons(waterer(targets))).toEqual(targets.map(() => null));
        }
      )
    );
  });

  it("uses the owner's typed shares over sizes and overlap, when they make a full set of 100", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 40 }), { minLength: 1, maxLength: 4 }),
        fc.array(size, { minLength: 5, maxLength: 5 }),
        (head, sizes) => {
          const used = head.reduce((a, b) => a + b, 0);
          if (used >= 100) return;
          const pcts = [...head, 100 - used];
          const targets: WatererTarget[] = pcts.map((sharePct, i) => ({
            fieldId: 'f1',
            blockId: i === 0 ? null : `b${i}`,
            sharePct,
            sqFt: sizes[i]
          }));
          const split = gallonsSplit(targets);
          expect(split).toEqual({
            known: true,
            fractions: pcts.map((p) => p / 100),
            source: 'typed'
          });
          const gallons = targetGallons(waterer(targets));
          gallons.forEach((g, i) => expect(g).toBeCloseTo((40 * pcts[i]) / 100, 9));
        }
      )
    );
  });

  it('reads a share set that is partial or does not total 100 as not known', () => {
    expect(
      gallonsSplit([
        { fieldId: 'f1', blockId: 'b1', sharePct: 60, sqFt: 10 },
        { fieldId: 'f1', blockId: 'b2', sharePct: null, sqFt: 10 }
      ])
    ).toEqual({ known: false, reason: 'shares' });
    expect(
      gallonsSplit([
        { fieldId: 'f1', blockId: 'b1', sharePct: 60, sqFt: 10 },
        { fieldId: 'f1', blockId: 'b2', sharePct: 30, sqFt: 10 }
      ])
    ).toEqual({ known: false, reason: 'shares' });
  });

  it('reads a bed inside an Area the timer also waters as not known, even after the bed moved', () => {
    expect(
      gallonsSplit([
        { fieldId: 'f1', blockId: null, sqFt: 400 },
        { fieldId: 'f1', blockId: 'b1', sqFt: 40 }
      ])
    ).toEqual({ known: false, reason: 'overlap' });
    expect(
      gallonsSplit([
        { fieldId: 'f1', blockId: null, sqFt: 400 },
        { fieldId: 'f2', blockId: 'b1', sqFt: 40, blockFieldId: 'f1' }
      ])
    ).toEqual({ known: false, reason: 'overlap' });
    expect(
      gallonsSplit([
        { fieldId: 'f1', blockId: null, sqFt: 400 },
        { fieldId: 'f2', blockId: 'b1', sqFt: 40, blockFieldId: 'f2' }
      ])
    ).toEqual({ known: true, fractions: [400 / 440, 40 / 440], source: 'size' });
  });

  it('shares out exactly the run gallons, or none at all', () => {
    fc.assert(
      fc.property(
        fc.array(targetArb, { minLength: 1, maxLength: 5 }),
        fc.double({ min: 0.1, max: 500, noNaN: true }),
        (targets, gpm) => {
          const w = waterer(targets, { gallonsPerMinute: gpm });
          const per = targetGallons(w);
          const total = runGallons(w) as number;
          if (per.every((g) => g === null)) return;
          expect(per.every((g) => g !== null)).toBe(true);
          expect((per as number[]).reduce((a, b) => a + b, 0)).toBeCloseTo(total, 6);
        }
      )
    );
  });

  it('tags every split run manual, never data (R-12)', () => {
    fc.assert(
      fc.property(fc.array(targetArb, { minLength: 1, maxLength: 5 }), runsArb, (targets, runs) => {
        const logs = timerLogs(waterer(targets), runs, 'f1', Date.UTC(2027, 0, 1));
        expect(logs.every((l) => l.provenance === 'manual')).toBe(true);
      })
    );
  });
});

describe('inches per target come from its own gallons over its own size', () => {
  const now = Date.UTC(2026, 5, 10, 18);
  const runs = [now - 2 * HOUR];

  it('gives every bed the same depth under the size split', () => {
    const w = waterer([
      { fieldId: 'f1', blockId: 'b1', sqFt: 40 },
      { fieldId: 'f1', blockId: 'b2', sqFt: 120 }
    ]);
    const logs = timerLogs(w, runs, 'f1', now);
    const depth = 40 / (GALLONS_PER_SQFT_INCH * 160);
    expect(logInches(logs[0], 40)).toBeCloseTo(depth, 9);
    expect(logInches(logs[1], 120)).toBeCloseTo(depth, 9);
  });

  it('keeps inches not known for a typed share on a bed with no size', () => {
    const w = waterer([
      { fieldId: 'f1', blockId: 'b1', sharePct: 70, sqFt: null },
      { fieldId: 'f1', blockId: 'b2', sharePct: 30, sqFt: 50 }
    ]);
    const [a, b] = timerLogs(w, runs, 'f1', now);
    expect(a.gallons).toBeCloseTo(28, 9);
    expect(logInches(a, null)).toBeNull();
    expect(logInches(b, 50)).toBeCloseTo(12 / (GALLONS_PER_SQFT_INCH * 50), 9);
  });

  it('still blocks a water verdict where the split is not known', () => {
    const hours = Array.from({ length: 170 }, (_, i) => ({
      t: Math.floor(now / HOUR) * HOUR - i * HOUR,
      inches: 0
    }));
    const unknown = waterer([
      { fieldId: 'f1', blockId: 'b1', sqFt: 40 },
      { fieldId: 'f1', blockId: 'b2', sqFt: null }
    ]);
    const balance = waterBalance({
      nowMs: now,
      areaKind: 'garden',
      areaSqFt: 400,
      target: { inches: 1, provenance: 'fallback' },
      station: { name: 'KTEST', distanceMi: 2 },
      stationRain: hours,
      gauges: [],
      logs: timerLogs(unknown, runs, 'f1', now),
      beds: [
        { id: 'b1', name: 'Bed 1', sqFt: 40, rainCover: null },
        { id: 'b2', name: 'Bed 2', sqFt: null, rainCover: null }
      ]
    });
    expect(balance.perBed.map((b) => [b.verdict, b.reason])).toEqual([
      ['unknown', 'amount-not-logged'],
      ['unknown', 'amount-not-logged']
    ]);
  });
});

describe('running since (FU870-4)', () => {
  const from = Date.UTC(2026, 5, 14, 12);
  const activeFrom = from + 5 * DAY;

  it('counts from the start of the owner day in the farm zone, else from activeFrom', () => {
    expect(countsFromMs({ activeFrom, runningSince: '2026-06-15' }, NY)).toBe(
      zonedWallMs(2026, 6, 15, 0, 0, NY)
    );
    expect(countsFromMs({ activeFrom }, NY)).toBe(activeFrom);
    expect(countsFromMs({ activeFrom, runningSince: null }, NY)).toBe(activeFrom);
    expect(countsFromMs({ activeFrom, runningSince: '2026-02-30' }, NY)).toBe(activeFrom);
  });

  it('lets runs between it and activeFrom count, and none before it', () => {
    const s = { days: [0, 1, 2, 3, 4, 5, 6], start: '06:00', activeFrom };
    const window = { fromMs: from, toMs: from + 7 * DAY, timeZone: NY };
    const withoutSince = expandRuns(s, window);
    const withSince = expandRuns({ ...s, runningSince: '2026-06-16' }, window);
    const since = zonedWallMs(2026, 6, 16, 0, 0, NY);
    expect(withoutSince.every((t) => t >= activeFrom)).toBe(true);
    expect(withSince.every((t) => t >= since)).toBe(true);
    expect(withSince.length).toBeGreaterThan(withoutSince.length);
    expect(withSince.filter((t) => t >= activeFrom)).toEqual(withoutSince);
    expect(expandRuns({ ...s, runningSince: null }, window)).toEqual(withoutSince);
  });

  it('matches activeFrom exactly when unset, for any window (unchanged behaviour)', () => {
    fc.assert(
      fc.property(fc.integer({ min: -10, max: 10 }), fc.integer({ min: 1, max: 9 }), (a, d) => {
        const s = { days: [1, 3, 5], start: '07:30', activeFrom: from + a * DAY };
        const window = { fromMs: from, toMs: from + d * DAY, timeZone: NY };
        expect(expandRuns({ ...s, runningSince: undefined }, window)).toEqual(
          expandRuns(s, window).filter((t) => t >= s.activeFrom)
        );
      })
    );
  });
});
