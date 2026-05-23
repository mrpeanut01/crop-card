import { describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import { buildDeterministicSchedule, type ScheduleInput } from './aiSchedule';
import { scheduleCandidacy } from '$lib/schedule/scheduleCandidacy';
import { evaluateSuccessionFit } from '$lib/schedule/succession';
import type { PollinationConstraint } from '$lib/plan/types';

const ONE_DAY_MS = 86_400_000;

function plug(
  id: string,
  family: string,
  dtm: [number, number] = [80, 90],
  soilTempMinF = 65
): CropPlugin {
  return {
    pluginId: id,
    type: 'crop',
    schemaVersion: '1.0.0',
    displayName: id,
    cropFamily: family,
    daysToMaturity: { min: dtm[0], max: dtm[1] },
    plantingGuide: { soilTempMinF }
  } as unknown as CropPlugin;
}

// Plan year is always next season so the fixtures stay forward-dated as the
// real calendar advances. The today-floor in scheduleCandidacy will compare
// against Date.now(); pinning frost dates to next year keeps "now" before
// the agronomic earliest for these tests.
const PLAN_YEAR = new Date().getFullYear() + 1;
const frostDates = {
  lastSpringFrostMs: new Date(PLAN_YEAR, 3, 15).getTime(), // Apr 15
  firstFallFrostMs: new Date(PLAN_YEAR, 9, 15).getTime() // Oct 15
};

describe('buildDeterministicSchedule — must-stagger enforcement', () => {
  const pluginIndex: Record<string, CropPlugin> = {
    'corn-a': plug('corn-a', 'corn'),
    'corn-b': plug('corn-b', 'corn'),
    'corn-c': plug('corn-c', 'corn')
  };
  const assignments = [
    {
      stockItemId: 's1',
      blockId: 'b1',
      cropPluginId: 'corn-a',
      varietyDisplayName: 'A',
      plants: 100
    },
    {
      stockItemId: 's2',
      blockId: 'b2',
      cropPluginId: 'corn-b',
      varietyDisplayName: 'B',
      plants: 100
    },
    {
      stockItemId: 's3',
      blockId: 'b3',
      cropPluginId: 'corn-c',
      varietyDisplayName: 'C',
      plants: 100
    }
  ];
  const pollinationConstraints: PollinationConstraint[] = [
    {
      kind: 'must-stagger',
      pair: ['s1', 's2'],
      pairDisplayNames: ['A', 'B'],
      blockIds: ['b1', 'b2'],
      blockNames: ['B1', 'B2'],
      distanceFt: 50,
      requiredIsolationFeet: 250,
      staggerDays: 14,
      note: 'stagger 14d'
    },
    {
      kind: 'must-stagger',
      pair: ['s2', 's3'],
      pairDisplayNames: ['B', 'C'],
      blockIds: ['b2', 'b3'],
      blockNames: ['B2', 'B3'],
      distanceFt: 60,
      requiredIsolationFeet: 250,
      staggerDays: 14,
      note: 'stagger 14d'
    },
    {
      kind: 'must-stagger',
      pair: ['s1', 's3'],
      pairDisplayNames: ['A', 'C'],
      blockIds: ['b1', 'b3'],
      blockNames: ['B1', 'B3'],
      distanceFt: 80,
      requiredIsolationFeet: 250,
      staggerDays: 14,
      note: 'stagger 14d'
    }
  ];

  const input: ScheduleInput = {
    assignments,
    pluginIndex,
    existingCrops: [],
    pollinationConstraints,
    companionGroups: [],
    frostDates,
    year: 2026
  };

  it('staggers three crossing varieties by at least 14d each', () => {
    const windows = scheduleCandidacy(input);
    const fits = windows.map((w) =>
      evaluateSuccessionFit(
        w,
        pluginIndex[
          assignments.find((a) => a.stockItemId === w.stockItemId && a.blockId === w.blockId)!
            .cropPluginId
        ],
        w.blockId,
        w.stockItemId
      )
    );

    const scheduled = buildDeterministicSchedule(input, windows, fits);
    const byStock = new Map<string, number>();
    for (const p of scheduled) byStock.set(p.stockItemId, p.plantingDateMs);

    expect(byStock.size).toBe(3);
    const d1 = byStock.get('s1')!;
    const d2 = byStock.get('s2')!;
    const d3 = byStock.get('s3')!;
    expect(Math.abs(d2 - d1)).toBeGreaterThanOrEqual(14 * ONE_DAY_MS - ONE_DAY_MS);
    expect(Math.abs(d3 - d1)).toBeGreaterThanOrEqual(14 * ONE_DAY_MS - ONE_DAY_MS);
    expect(Math.abs(d3 - d2)).toBeGreaterThanOrEqual(14 * ONE_DAY_MS - ONE_DAY_MS);
  });

  it('does NOT stagger when no must-stagger constraint exists', () => {
    const noStagger: ScheduleInput = { ...input, pollinationConstraints: [] };
    const windows = scheduleCandidacy(noStagger);
    const fits = windows.map((w) =>
      evaluateSuccessionFit(
        w,
        pluginIndex[
          assignments.find((a) => a.stockItemId === w.stockItemId && a.blockId === w.blockId)!
            .cropPluginId
        ],
        w.blockId,
        w.stockItemId
      )
    );
    const scheduled = buildDeterministicSchedule(noStagger, windows, fits);
    const dates = scheduled.map((p) => p.plantingDateMs);
    expect(dates.every((d) => d === dates[0])).toBe(true);
  });

  it('honors companion-group anchor + offset', () => {
    const corn = plug('corn-anchor', 'corn');
    const bean = plug('bean-helper', 'legume');
    const squash = plug('squash-helper', 'cucurbit');
    const input: ScheduleInput = {
      assignments: [
        {
          stockItemId: 's-corn',
          blockId: 'b1',
          cropPluginId: 'corn-anchor',
          varietyDisplayName: 'Corn',
          plants: 100
        },
        {
          stockItemId: 's-bean',
          blockId: 'b1',
          cropPluginId: 'bean-helper',
          varietyDisplayName: 'Bean',
          plants: 100
        },
        {
          stockItemId: 's-squash',
          blockId: 'b1',
          cropPluginId: 'squash-helper',
          varietyDisplayName: 'Squash',
          plants: 100
        }
      ],
      pluginIndex: {
        'corn-anchor': corn,
        'bean-helper': bean,
        'squash-helper': squash
      },
      existingCrops: [],
      pollinationConstraints: [],
      companionGroups: [
        {
          groupId: 'b1:s-corn',
          anchorFamily: 'corn',
          members: [
            { stockItemId: 's-corn', role: 'anchor', daysFromAnchor: 0 },
            { stockItemId: 's-bean', role: 'companion', daysFromAnchor: 14 },
            { stockItemId: 's-squash', role: 'companion', daysFromAnchor: 35 }
          ]
        }
      ],
      frostDates,
      year: PLAN_YEAR
    };
    const windows = scheduleCandidacy(input);
    const fits = windows.map((w) =>
      evaluateSuccessionFit(
        w,
        input.pluginIndex[
          input.assignments.find((a) => a.stockItemId === w.stockItemId && a.blockId === w.blockId)!
            .cropPluginId
        ],
        w.blockId,
        w.stockItemId
      )
    );
    const scheduled = buildDeterministicSchedule(input, windows, fits);
    const byStock = new Map<string, number>();
    for (const p of scheduled) byStock.set(p.stockItemId, p.plantingDateMs);

    const corn1 = byStock.get('s-corn')!;
    const bean1 = byStock.get('s-bean')!;
    const squash1 = byStock.get('s-squash')!;
    expect(Math.round((bean1 - corn1) / ONE_DAY_MS)).toBe(14);
    expect(Math.round((squash1 - corn1) / ONE_DAY_MS)).toBe(35);
  });
});
