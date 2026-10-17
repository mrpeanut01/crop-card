import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  buildHarvestSchedule,
  goalStatus,
  plantingSchedule,
  scheduleEnd,
  weekOf,
  type GoalPlugin,
  type ScheduleBounds,
  type SchedulePlantingInput
} from './harvestSchedule';
import { BRIEF_STORAGE_GOALS, PRESERVING_METHODS, PRESERVING_SUITABILITY } from './preserving';
import type { LifecycleVerdict } from './lifecycleTypes';

const DAY = 86_400_000;
const Y = 2026;
const bounds: ScheduleBounds = {
  seasonStartMs: Date.UTC(Y, 0, 1),
  seasonEndMs: Date.UTC(Y, 11, 31),
  firstFallFrostMs: Date.UTC(Y, 9, 15)
};

function planting(over: Partial<SchedulePlantingInput> = {}): SchedulePlantingInput {
  return {
    plantingId: 'p1',
    cropPluginId: 'basil-genovese',
    blockId: 'b1',
    windows: [{ startMs: Date.UTC(Y, 6, 1), endMs: Date.UTC(Y, 6, 21), provenance: 'plugin' }],
    ...over
  };
}

const perennial: LifecycleVerdict = { lifecycle: 'perennial-here', provenance: 'plugin' };
const tender: LifecycleVerdict = { lifecycle: 'tender-perennial', provenance: 'plugin' };

describe('weekOf', () => {
  it('is the Monday of the UTC week', () => {
    expect(weekOf(Date.UTC(2026, 9, 17))).toBe('2026-10-12');
    expect(weekOf(Date.UTC(2026, 9, 12))).toBe('2026-10-12');
    expect(weekOf(Date.UTC(2026, 9, 18, 23))).toBe('2026-10-12');
  });
});

describe('plantingSchedule', () => {
  it('without a cadence shows the first harvest window only', () => {
    const s = plantingSchedule(planting(), bounds);
    expect(s.firstWindowOnly).toBe(true);
    expect(s.cuts).toHaveLength(1);
    expect(s.cuts[0]).toMatchObject({ kind: 'window', fromMs: Date.UTC(Y, 6, 1) });
  });

  it('repeats a cadence until the first fall frost for an annual', () => {
    const s = plantingSchedule(planting({ cadence: { everyDays: { min: 21, max: 28 } } }), bounds);
    expect(s.endsAt).toBe('first-fall-frost');
    expect(s.cuts.every((c) => c.toMs <= bounds.firstFallFrostMs)).toBe(true);
    const again = s.cuts.filter((c) => c.kind === 'cadence');
    expect(again.length).toBe(
      Math.floor((bounds.firstFallFrostMs - Date.UTC(Y, 6, 1)) / (28 * DAY))
    );
    expect(again[0].fromMs).toBe(Date.UTC(Y, 6, 22));
    expect(again[0].toMs).toBe(Date.UTC(Y, 6, 29));
  });

  it('a hardy perennial keeps going to season end, a tender one stops at frost', () => {
    const cad = { everyDays: { min: 14, max: 14 } };
    const hardy = plantingSchedule(planting({ cadence: cad, lifecycle: perennial }), bounds);
    const soft = plantingSchedule(planting({ cadence: cad, lifecycle: tender }), bounds);
    expect(hardy.endsAt).toBe('season-end');
    expect(hardy.cuts.at(-1)!.toMs).toBeGreaterThan(bounds.firstFallFrostMs);
    expect(soft.cuts.at(-1)!.toMs).toBeLessThanOrEqual(bounds.firstFallFrostMs);
    expect(scheduleEnd(null)).toBe('first-fall-frost');
  });

  it('drops windows that open after the end and clips windows to the season', () => {
    const late = plantingSchedule(
      planting({
        windows: [{ startMs: Date.UTC(Y, 10, 1), endMs: Date.UTC(Y, 10, 20), provenance: 'plugin' }]
      }),
      bounds
    );
    expect(late.cuts).toHaveLength(0);
    const early = plantingSchedule(
      planting({
        windows: [
          { startMs: Date.UTC(Y - 1, 11, 20), endMs: Date.UTC(Y, 0, 10), provenance: 'fallback' }
        ]
      }),
      bounds
    );
    expect(early.cuts[0]).toMatchObject({ fromMs: bounds.seasonStartMs, provenance: 'fallback' });
  });

  it('with no harvest window there is no cut, cadence or not', () => {
    const s = plantingSchedule(
      planting({ windows: [], cadence: { everyDays: { min: 7, max: 10 } } }),
      bounds
    );
    expect(s.cuts).toEqual([]);
  });
});

describe('buildHarvestSchedule', () => {
  it('groups cuts by week in date order', () => {
    const out = buildHarvestSchedule(
      [
        planting(),
        planting({
          plantingId: 'p2',
          cropPluginId: 'chives-common',
          windows: [{ startMs: Date.UTC(Y, 5, 3), endMs: Date.UTC(Y, 5, 10), provenance: 'plugin' }]
        })
      ],
      bounds
    );
    expect(out.weeks.map((w) => w.week)).toEqual(['2026-06-01', '2026-06-29']);
    expect(out.plantings).toHaveLength(2);
  });
});

describe('goalStatus (R-7)', () => {
  const plugins: Record<string, GoalPlugin> = {
    'basil-genovese': {
      pluginId: 'basil-genovese',
      preserving: [
        { method: 'freeze', suitability: 'fair' },
        { method: 'dry', suitability: 'poor' }
      ]
    },
    'oregano-greek': {
      pluginId: 'oregano-greek',
      preserving: [{ method: 'dry', suitability: 'good' }]
    },
    'chives-common': { pluginId: 'chives-common' }
  };

  it('a fair cut is on track and names the suitability', () => {
    const s = buildHarvestSchedule([planting()], bounds);
    const [line] = goalStatus(
      [{ goal: 'pesto', target: 'a dozen portions' }],
      s.plantings,
      plugins
    );
    expect(line).toMatchObject({
      status: 'on-track',
      method: 'freeze',
      cropPluginId: 'basil-genovese',
      suitability: 'fair',
      target: 'a dozen portions'
    });
  });

  it('prefers a good crop to a fair one', () => {
    const s = buildHarvestSchedule(
      [
        planting(),
        planting({ plantingId: 'p2', cropPluginId: 'oregano-greek' }),
        planting({ plantingId: 'p3', cropPluginId: 'basil-genovese' })
      ],
      bounds
    );
    plugins['oregano-greek'].preserving = [
      { method: 'dry', suitability: 'good' },
      { method: 'freeze', suitability: 'good' }
    ];
    const [line] = goalStatus([{ goal: 'freeze' }], s.plantings, plugins);
    expect(line.cropPluginId).toBe('oregano-greek');
    plugins['oregano-greek'].preserving = [{ method: 'dry', suitability: 'good' }];
  });

  it('is short when only poor data exists, or a suitable crop has no cut', () => {
    const basil = buildHarvestSchedule([planting()], bounds);
    expect(goalStatus([{ goal: 'dry' }], basil.plantings, plugins)[0]).toMatchObject({
      status: 'short',
      reason: 'only-poor'
    });
    const noCut = buildHarvestSchedule(
      [planting({ cropPluginId: 'oregano-greek', windows: [] })],
      bounds
    );
    expect(goalStatus([{ goal: 'dry' }], noCut.plantings, plugins)[0]).toMatchObject({
      status: 'short',
      reason: 'no-cut'
    });
  });

  it('is not known without plant data, and canning always needs a recipe', () => {
    const chives = buildHarvestSchedule([planting({ cropPluginId: 'chives-common' })], bounds);
    expect(goalStatus([{ goal: 'dry' }], chives.plantings, plugins)[0]).toMatchObject({
      status: 'not-known',
      reason: 'no-data',
      provenance: 'fallback'
    });
    expect(goalStatus([{ goal: 'can-or-jelly' }], chives.plantings, plugins)[0]).toMatchObject({
      status: 'not-known',
      reason: 'needs-recipe',
      method: null
    });
  });

  it('nothing planted reads short only when the library has a crop that keeps that way', () => {
    expect(goalStatus([{ goal: 'dry' }], [], {}, [plugins['oregano-greek']])[0].reason).toBe(
      'nothing-planted'
    );
    expect(goalStatus([{ goal: 'dry' }], [], {}, [])[0].status).toBe('not-known');
  });
});

describe('goalStatus property: never on track without a suitable cut', () => {
  const method = fc.constantFrom(...PRESERVING_METHODS);
  const suit = fc.constantFrom(...PRESERVING_SUITABILITY);
  const ids = ['a', 'b', 'c', 'd'];
  const pluginArb = fc.record({
    pluginId: fc.constantFrom(...ids),
    preserving: fc.uniqueArray(fc.record({ method, suitability: suit }), {
      selector: (r) => r.method,
      maxLength: 5
    })
  });
  const plantingArb = fc.record({
    plantingId: fc.uuid(),
    cropPluginId: fc.constantFrom(...ids),
    blockId: fc.constant('b'),
    windows: fc.array(
      fc
        .tuple(fc.integer({ min: -60, max: 420 }), fc.integer({ min: 0, max: 40 }))
        .map(([start, len]) => ({
          startMs: bounds.seasonStartMs + start * DAY,
          endMs: bounds.seasonStartMs + (start + len) * DAY,
          provenance: 'plugin' as const
        })),
      { maxLength: 2 }
    ),
    cadence: fc.option(
      fc
        .tuple(fc.integer({ min: 1, max: 60 }), fc.integer({ min: 0, max: 30 }))
        .map(([min, extra]) => ({ everyDays: { min, max: min + extra } })),
      { nil: null }
    ),
    lifecycle: fc.option(
      fc.constantFrom<LifecycleVerdict>(perennial, tender, {
        lifecycle: 'annual',
        provenance: 'fallback'
      }),
      { nil: null }
    )
  });

  it('holds over random farms and goals', () => {
    fc.assert(
      fc.property(
        fc.array(plantingArb, { maxLength: 6 }),
        fc.array(pluginArb, { maxLength: 4 }),
        fc.uniqueArray(fc.constantFrom(...BRIEF_STORAGE_GOALS), { maxLength: 7 }),
        (plantings, pluginList, goals) => {
          const plugins = Object.fromEntries(pluginList.map((p) => [p.pluginId, p]));
          const schedule = buildHarvestSchedule(plantings, bounds);
          for (const s of schedule.plantings) {
            for (const c of s.cuts) {
              const end = s.endsAt === 'season-end' ? bounds.seasonEndMs : bounds.firstFallFrostMs;
              expect(c.toMs).toBeLessThanOrEqual(Math.min(end, bounds.seasonEndMs));
            }
          }
          const lines = goalStatus(
            goals.map((goal) => ({ goal })),
            schedule.plantings,
            plugins
          );
          for (const line of lines) {
            if (line.status !== 'on-track') continue;
            const cutting = schedule.plantings.some(
              (p) => p.cropPluginId === line.cropPluginId && p.cuts.length > 0
            );
            const row = plugins[line.cropPluginId!]?.preserving.find(
              (r) => r.method === line.method
            );
            expect(cutting).toBe(true);
            expect(['good', 'fair']).toContain(row?.suitability);
            expect(line.suitability).toBe(row?.suitability);
          }
        }
      ),
      { numRuns: 300 }
    );
  });
});
