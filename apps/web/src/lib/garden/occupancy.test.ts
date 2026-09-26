import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  ARCHETYPE_HARVEST_TAIL,
  bedOccupancyOn,
  freeFractionOf,
  frostInYearOf,
  harvestTailFor,
  maturityDays,
  occupancyChangeDays,
  occupancyIntervals,
  ONE_DAY_MS,
  plantingOccupancy,
  scrubRange,
  shortDate,
  type OccupancyPlanting
} from './occupancy';
import type { Footprint, GardenCrop, OccupancyInterval } from './types';
import { seasonFrostMs } from './design';

const day = (m: number, d: number, y = 2026) => Date.UTC(y, m - 1, d);
const FROST = { firstFallFrostMs: day(10, 24) };

const tomato: GardenCrop = {
  pluginId: 'tomato-celebrity-f1',
  displayName: 'Tomato Celebrity F1',
  cropFamily: 'solanaceae',
  archetype: 'continuous-harvest-fruit',
  daysToMaturity: { min: 70, max: 75 }
};
const lettuce: GardenCrop = {
  pluginId: 'lettuce-buttercrunch',
  displayName: 'Lettuce Buttercrunch',
  cropFamily: 'leafy-green',
  archetype: 'cut-and-come-again-leafy',
  daysToMaturity: { min: 50, max: 60 }
};
const garlic: GardenCrop = {
  pluginId: 'garlic',
  displayName: 'Garlic',
  cropFamily: 'allium',
  archetype: 'winter-squash-cure',
  daysToMaturity: { min: 90, max: 100 }
};
const grape: GardenCrop = {
  pluginId: 'grape',
  displayName: 'Grape',
  cropFamily: 'vine-fruit',
  archetype: 'perennial-vine-quality',
  daysToMaturity: { min: 100, max: 120 }
};
const crops = { [tomato.pluginId]: tomato, [lettuce.pluginId]: lettuce, [garlic.pluginId]: garlic };

function planting(over: Partial<OccupancyPlanting> = {}): OccupancyPlanting {
  return {
    cropId: 'c1',
    blockId: 'bed1',
    cropPluginId: lettuce.pluginId,
    status: 'planned',
    plantingDateMs: day(4, 1),
    harvestedAtMs: null,
    footprint: null,
    ...over
  };
}

describe('shortDate and frostInYearOf', () => {
  it('formats UTC days', () => {
    expect(shortDate(day(7, 1))).toBe('Jul 1');
    expect(shortDate(day(11, 3))).toBe('Nov 3');
  });

  it('moves the frost date into the planting year', () => {
    expect(frostInYearOf(day(10, 24, 2026), day(5, 1, 2027))).toBe(day(10, 24, 2027));
    expect(frostInYearOf(day(10, 24, 2026), day(11, 20, 2027))).toBe(day(10, 24, 2027));
  });
});

describe('a season that crosses the new year (Gulf coast)', () => {
  const GULF = { lastSpringFrostMs: day(1, 31, 2027), firstFallFrostMs: day(1, 6, 2028) };

  it('bounds a summer planting by the next January frost', () => {
    expect(frostInYearOf(GULF.firstFallFrostMs, day(10, 1, 2027), GULF.lastSpringFrostMs)).toBe(
      day(1, 6, 2028)
    );
    expect(frostInYearOf(GULF.firstFallFrostMs, day(10, 1, 2027))).toBe(day(1, 6, 2028));
  });

  it('keeps a harvest that starts just before that frost in its own season', () => {
    expect(frostInYearOf(GULF.firstFallFrostMs, day(1, 3, 2028), GULF.lastSpringFrostMs)).toBe(
      day(1, 6, 2028)
    );
  });

  it('holds tomatoes until the January frost instead of ending before they start', () => {
    const iv = plantingOccupancy(
      planting({ cropPluginId: tomato.pluginId, plantingDateMs: day(3, 1, 2027) }),
      tomato,
      GULF
    )!;
    expect(iv.harvestStartMs).toBe(day(5, 10, 2027));
    expect(iv.harvestEndMs).toBe(day(1, 6, 2028));
    expect(iv.endMs).toBeGreaterThan(iv.harvestEndMs);
  });

  it('leaves a desert season with a late-December spring frost in its own year', () => {
    const desert = { lastSpringFrostMs: day(12, 31, 2026), firstFallFrostMs: day(12, 27, 2027) };
    expect(frostInYearOf(desert.firstFallFrostMs, day(6, 1, 2027), desert.lastSpringFrostMs)).toBe(
      day(12, 27, 2027)
    );
  });

  it('bounds every date inside a season by that season’s own frost (property)', () => {
    const mmdd = fc
      .tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }))
      .map(([m, d]) => `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    fc.assert(
      fc.property(
        fc.integer({ min: 2001, max: 2099 }),
        mmdd,
        mmdd,
        fc.double({ min: 0, max: 1, noNaN: true }),
        (year, last, first, t) => {
          const f = seasonFrostMs(year, last, first);
          const span = f.firstFallFrostMs - f.lastSpringFrostMs;
          const ms = f.lastSpringFrostMs + Math.floor(t * span);
          if (ms <= f.lastSpringFrostMs || ms >= f.firstFallFrostMs) return true;
          return frostInYearOf(f.firstFallFrostMs, ms, f.lastSpringFrostMs) === f.firstFallFrostMs;
        }
      )
    );
  });

  it('matches the old same-year answer for ordinary seasons (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 364 }),
        fc.integer({ min: 2001, max: 2099 }),
        (offset, year) => {
          const f = seasonFrostMs(year, '04-15', '10-24');
          const ms = Date.UTC(year, 0, 1) + offset * ONE_DAY_MS;
          return (
            frostInYearOf(f.firstFallFrostMs, ms, f.lastSpringFrostMs) === Date.UTC(year, 9, 24)
          );
        }
      )
    );
  });
});

describe('maturityDays and harvestTailFor', () => {
  it('reads min and max, falling back to 90 days', () => {
    expect(maturityDays(lettuce)).toEqual({ min: 50, max: 60 });
    expect(maturityDays({ ...lettuce, daysToMaturity: undefined })).toEqual({ min: 90, max: 90 });
    expect(maturityDays(undefined)).toEqual({ min: 90, max: 90 });
  });

  it('uses the explicit archetype, else the family fallback', () => {
    expect(harvestTailFor(lettuce)).toBe(21);
    expect(harvestTailFor({ ...tomato, archetype: undefined })).toBe('until-frost');
    expect(harvestTailFor({ ...tomato, archetype: 'not-a-real-one' })).toBe('until-frost');
    expect(harvestTailFor(undefined)).toBe(0);
  });

  it('covers every archetype', () => {
    expect(Object.keys(ARCHETYPE_HARVEST_TAIL)).toHaveLength(10);
  });
});

describe('plantingOccupancy', () => {
  it('holds lettuce from Apr 1 to Jul 1 (60 days, 21 day cut window, 10 day turnover)', () => {
    const iv = plantingOccupancy(planting(), lettuce, FROST)!;
    expect(iv.startMs).toBe(day(4, 1));
    expect(iv.harvestStartMs).toBe(day(4, 1) + 50 * ONE_DAY_MS);
    expect(iv.harvestEndMs).toBe(day(4, 1) + 81 * ONE_DAY_MS);
    expect(iv.endMs).toBe(day(7, 1));
    expect(iv.actual).toBe(false);
  });

  it('keeps continuous-harvest fruit until first fall frost', () => {
    const iv = plantingOccupancy(
      planting({ cropPluginId: tomato.pluginId, plantingDateMs: day(5, 1) }),
      tomato,
      FROST
    )!;
    expect(iv.harvestStartMs).toBe(day(7, 10));
    expect(iv.harvestEndMs).toBe(day(10, 24));
    expect(iv.endMs).toBe(day(11, 3));
  });

  it('holds perennials for the season and single harvests to maturity', () => {
    expect(
      plantingOccupancy(planting({ plantingDateMs: day(3, 1) }), grape, FROST)!.harvestEndMs
    ).toBe(day(10, 24));
    expect(
      plantingOccupancy(planting({ plantingDateMs: day(3, 1) }), garlic, FROST)!.harvestEndMs
    ).toBe(day(3, 1) + 100 * ONE_DAY_MS);
  });

  it('lets a late crop run past frost to maturity', () => {
    const iv = plantingOccupancy(
      planting({ cropPluginId: tomato.pluginId, plantingDateMs: day(9, 1) }),
      tomato,
      FROST
    )!;
    expect(iv.harvestEndMs).toBe(day(9, 1) + 75 * ONE_DAY_MS);
  });

  it('uses a recorded harvest date', () => {
    const iv = plantingOccupancy(
      planting({ status: 'harvested', harvestedAtMs: day(5, 20) }),
      lettuce,
      FROST
    )!;
    expect(iv.actual).toBe(true);
    expect(iv.harvestEndMs).toBe(day(5, 20));
    expect(iv.harvestStartMs).toBe(day(5, 20));
    expect(iv.endMs).toBe(day(5, 30));
  });

  it('leaves unscheduled, failed and archived plantings off the timeline', () => {
    expect(plantingOccupancy(planting({ plantingDateMs: null }), lettuce, FROST)).toBeNull();
    expect(plantingOccupancy(planting({ status: 'failed' }), lettuce, FROST)).toBeNull();
    expect(plantingOccupancy(planting({ status: 'archived' }), lettuce, FROST)).toBeNull();
  });

  it('assumes 90 days for an unknown crop', () => {
    const iv = plantingOccupancy(planting({ cropPluginId: 'mystery' }), undefined, FROST)!;
    expect(iv.endMs).toBe(day(4, 1) + 100 * ONE_DAY_MS);
  });

  it('orders the interval edges', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 364 }),
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 0, max: 60 }),
        fc.constantFrom(...Object.keys(ARCHETYPE_HARVEST_TAIL)),
        fc.option(fc.integer({ min: -30, max: 300 }), { nil: null }),
        (offset, min, extra, archetype, harvestOffset) => {
          const start = day(1, 1) + offset * ONE_DAY_MS;
          const crop: GardenCrop = {
            pluginId: 'p',
            displayName: 'P',
            cropFamily: 'root',
            archetype,
            daysToMaturity: { min, max: min + extra }
          };
          const iv = plantingOccupancy(
            planting({
              plantingDateMs: start,
              harvestedAtMs: harvestOffset === null ? null : start + harvestOffset * ONE_DAY_MS
            }),
            crop,
            FROST
          )!;
          expect(iv.startMs).toBe(start);
          expect(iv.harvestStartMs).toBeGreaterThanOrEqual(iv.startMs);
          expect(iv.harvestEndMs).toBeGreaterThanOrEqual(iv.harvestStartMs);
          expect(iv.endMs).toBe(iv.harvestEndMs + 10 * ONE_DAY_MS);
        }
      )
    );
  });
});

describe('planting dates written at local midnight', () => {
  it('count on the day that was picked, whatever zone wrote them', () => {
    const virginia = plantingOccupancy(
      planting({ plantingDateMs: Date.UTC(2026, 4, 1, 4) }),
      tomato,
      FROST
    )!;
    expect(virginia.startMs).toBe(day(5, 1));
    const berlin = plantingOccupancy(
      planting({ plantingDateMs: Date.UTC(2026, 3, 30, 22) }),
      tomato,
      FROST
    )!;
    expect(berlin.startMs).toBe(day(5, 1));
    const bed = { blockId: 'bed1', widthFt: 4, lengthFt: 8 };
    const range = { startMs: day(1, 1), endMs: day(12, 31), todayMs: day(5, 1) };
    expect(bedOccupancyOn(bed, [virginia], day(5, 1), range).occupants).toHaveLength(1);
  });
});

describe('occupancyIntervals', () => {
  it('skips plantings off the timeline and sorts by bed then start', () => {
    const out = occupancyIntervals(
      [
        planting({ cropId: 'late', blockId: 'bed2', plantingDateMs: day(6, 1) }),
        planting({ cropId: 'early', blockId: 'bed2', plantingDateMs: day(3, 1) }),
        planting({ cropId: 'none', plantingDateMs: null }),
        planting({ cropId: 'a', blockId: 'bed1' })
      ],
      crops,
      FROST
    );
    expect(out.map((i) => i.cropId)).toEqual(['a', 'early', 'late']);
  });
});

function iv(
  cropId: string,
  startMs: number,
  endMs: number,
  footprint: Footprint | null = null,
  blockId = 'bed1'
): OccupancyInterval {
  return {
    cropId,
    blockId,
    startMs,
    harvestStartMs: startMs,
    harvestEndMs: endMs,
    endMs,
    footprint,
    actual: false
  };
}

const bed4x8 = { blockId: 'bed1', widthFt: 4, lengthFt: 8 };
const season = { startMs: day(1, 1), endMs: day(12, 31), todayMs: day(7, 15) };

describe('freeFractionOf', () => {
  it('measures the uncovered share of the bed', () => {
    expect(freeFractionOf(bed4x8, [])).toBe(1);
    expect(freeFractionOf(bed4x8, [null])).toBe(0);
    expect(freeFractionOf(bed4x8, [{ x_in: 0, y_in: 0, w_in: 48, l_in: 48 }])).toBe(0.5);
    expect(
      freeFractionOf(bed4x8, [
        { x_in: 0, y_in: 0, w_in: 48, l_in: 48 },
        { x_in: 0, y_in: 24, w_in: 48, l_in: 48 }
      ])
    ).toBe(0.25);
  });

  it('stays between 0 and 1 and never grows when a footprint is added', () => {
    const fpArb = fc.record({
      x_in: fc.integer({ min: -12, max: 60 }),
      y_in: fc.integer({ min: -12, max: 100 }),
      w_in: fc.integer({ min: 1, max: 60 }),
      l_in: fc.integer({ min: 1, max: 100 })
    });
    fc.assert(
      fc.property(fc.array(fpArb, { maxLength: 6 }), fpArb, (fps, extra) => {
        const f = freeFractionOf(bed4x8, fps);
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(1);
        expect(freeFractionOf(bed4x8, [...fps, extra])).toBeLessThanOrEqual(f + 1e-12);
      })
    );
  });
});

describe('bedOccupancyOn', () => {
  const lettuceIv = plantingOccupancy(planting({ blockId: 'bed2' }), lettuce, FROST)!;
  const tomatoIv = plantingOccupancy(
    planting({ cropId: 't', cropPluginId: tomato.pluginId, plantingDateMs: day(5, 1) }),
    tomato,
    FROST
  )!;

  it('matches the household scenario on July 15', () => {
    const bed1 = bedOccupancyOn(bed4x8, [tomatoIv, lettuceIv], day(7, 15), season);
    expect(bed1.occupants.map((o) => o.cropId)).toEqual(['t']);
    expect(bed1.freeFraction).toBe(0);
    expect(bed1.nextOpenMs).toBe(day(11, 3));
    expect(bed1.openSinceMs).toBeNull();

    const bed2 = bedOccupancyOn(
      { ...bed4x8, blockId: 'bed2' },
      [tomatoIv, lettuceIv],
      day(7, 15),
      season
    );
    expect(bed2.occupants).toEqual([]);
    expect(bed2.freeFraction).toBe(1);
    expect(bed2.openSinceMs).toBe(day(7, 1));
    expect(bed2.nextOpenMs).toBeNull();
  });

  it('says Open with no earlier occupant', () => {
    const r = bedOccupancyOn(bed4x8, [iv('x', day(8, 1), day(9, 1))], day(7, 15), season);
    expect(r.openSinceMs).toBeNull();
    expect(r.nextOpenMs).toBeNull();
  });

  it('treats the end day as open', () => {
    const r = bedOccupancyOn(bed4x8, [iv('x', day(3, 1), day(7, 1))], day(7, 1), season);
    expect(r.occupants).toEqual([]);
    expect(r.openSinceMs).toBe(day(7, 1));
  });

  it('follows back-to-back occupants to the next open day', () => {
    const r = bedOccupancyOn(
      bed4x8,
      [
        iv('a', day(3, 1), day(6, 1)),
        iv('b', day(6, 1), day(8, 1)),
        iv('c', day(8, 10), day(9, 1))
      ],
      day(4, 1),
      season
    );
    expect(r.nextOpenMs).toBe(day(8, 1));
  });

  it('returns null when the bed stays full past the range', () => {
    const r = bedOccupancyOn(bed4x8, [iv('a', day(3, 1), day(12, 31))], day(4, 1), season);
    expect(r.nextOpenMs).toBeNull();
  });

  it('keeps its promises for any set of intervals', () => {
    const ivArb = fc
      .tuple(fc.integer({ min: 0, max: 364 }), fc.integer({ min: 1, max: 120 }))
      .map(([s, len]) => [day(1, 1) + s * ONE_DAY_MS, day(1, 1) + (s + len) * ONE_DAY_MS] as const);
    fc.assert(
      fc.property(
        fc.array(ivArb, { maxLength: 8 }),
        fc.integer({ min: 0, max: 364 }),
        (spans, d) => {
          const intervals = spans.map(([s, e], i) => iv(`c${i}`, s, e));
          const dateMs = day(1, 1) + d * ONE_DAY_MS;
          const r = bedOccupancyOn(bed4x8, intervals, dateMs, season);
          for (const o of r.occupants) {
            expect(o.startMs <= dateMs && dateMs < o.endMs).toBe(true);
          }
          if (r.occupants.length) {
            expect(r.openSinceMs).toBeNull();
            if (r.nextOpenMs !== null) {
              expect(r.nextOpenMs).toBeGreaterThan(dateMs);
              expect(
                intervals.some((i) => i.startMs <= r.nextOpenMs! && r.nextOpenMs! < i.endMs)
              ).toBe(false);
            }
          } else {
            expect(r.nextOpenMs).toBeNull();
            if (r.openSinceMs !== null) expect(r.openSinceMs).toBeLessThanOrEqual(dateMs);
          }
        }
      )
    );
  });
});

describe('scrubRange and occupancyChangeDays', () => {
  it('runs Jan 1 to Dec 31 and widens for plantings that spill over', () => {
    expect(scrubRange(2026, [], day(7, 15) + 3_600_000)).toEqual({
      startMs: day(1, 1),
      endMs: day(12, 31),
      todayMs: day(7, 15)
    });
    const r = scrubRange(
      2026,
      [iv('a', day(11, 1), day(2, 10, 2027)), iv('b', day(3, 1, 2025), day(5, 1, 2025))],
      day(3, 1, 2030)
    );
    expect(r.startMs).toBe(day(1, 1));
    expect(r.endMs).toBe(day(2, 10, 2027));
    expect(r.todayMs).toBe(day(2, 10, 2027));
  });

  it('widens to show a frost date that falls in the next year', () => {
    const r = scrubRange(2027, [], day(7, 15, 2027), {
      lastSpringFrostMs: day(1, 31, 2027),
      firstFallFrostMs: day(1, 6, 2028)
    });
    expect(r.startMs).toBe(day(1, 1, 2027));
    expect(r.endMs).toBe(day(1, 6, 2028));
  });

  it('lists the days a bed changes', () => {
    const intervals = [
      iv('a', day(3, 1), day(6, 1)),
      iv('b', day(6, 1), day(8, 1)),
      iv('c', day(4, 1), day(5, 1), null, 'bed2')
    ];
    expect(occupancyChangeDays(intervals, 'bed1')).toEqual([day(3, 1), day(6, 1), day(8, 1)]);
    expect(occupancyChangeDays(intervals)).toHaveLength(5);
  });
});
