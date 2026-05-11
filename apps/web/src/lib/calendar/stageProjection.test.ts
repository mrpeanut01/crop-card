import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { GrowthStageTable } from '$lib/plugins/schemas';
import {
  projectStages,
  currentStage,
  projectHarvestTargets,
  projectPerennialStages,
  projectPerennialHarvestTargets
} from './stageProjection';

const DAY_MS = 86_400_000;

const cornVRTable: GrowthStageTable = {
  system: 'vr-corn',
  referenceDtmDays: 95,
  stages: [
    { code: 'VE', name: 'Emergence', daysFromPlanting: { min: 5, max: 10 }, bodyKind: 'vegetative' },
    { code: 'V2', name: '2-leaf', daysFromPlanting: { min: 14, max: 21 }, bodyKind: 'vegetative' },
    { code: 'V4', name: '4-leaf', daysFromPlanting: { min: 24, max: 32 }, bodyKind: 'vegetative' },
    { code: 'V6', name: '6-leaf', daysFromPlanting: { min: 32, max: 42 }, bodyKind: 'vegetative' },
    { code: 'VT', name: 'Tasseling', daysFromPlanting: { min: 55, max: 65 }, bodyKind: 'reproductive' },
    { code: 'R1', name: 'Silking', daysFromPlanting: { min: 60, max: 70 }, bodyKind: 'reproductive' },
    { code: 'R3', name: 'Milk', daysFromPlanting: { min: 78, max: 88 }, bodyKind: 'reproductive' },
    { code: 'R6', name: 'Black layer', daysFromPlanting: { min: 110, max: 130 }, bodyKind: 'ripening' }
  ],
  harvestTargets: [
    { stageCode: 'R3', label: 'Sweet eating', useCase: 'fresh-eating' },
    { stageCode: 'R6', label: 'Dent', useCase: 'milling' }
  ]
};

describe('projectStages', () => {
  const t0 = Date.UTC(2026, 4, 1);

  it('projects unscaled offsets when no actualDtm passed', () => {
    const stages = projectStages(t0, cornVRTable);
    expect(stages).toHaveLength(8);
    const r3 = stages.find((s) => s.code === 'R3')!;
    expect(Math.round((r3.startMs - t0) / DAY_MS)).toBe(78);
    expect(Math.round((r3.endMs - t0) / DAY_MS)).toBe(88);
  });

  it('scales day offsets by actualDtm midpoint / referenceDtmDays', () => {
    // Sweet corn: ref=95, actual midpoint=75 → scale ≈ 0.789
    const stages = projectStages(t0, cornVRTable, { min: 70, max: 80 });
    const r3 = stages.find((s) => s.code === 'R3')!;
    const expectedMin = Math.round(78 * (75 / 95));
    const expectedMax = Math.round(88 * (75 / 95));
    expect(Math.round((r3.startMs - t0) / DAY_MS)).toBe(expectedMin);
    expect(Math.round((r3.endMs - t0) / DAY_MS)).toBe(expectedMax);
  });

  it('marks R3 and R6 as harvest target stages on corn', () => {
    const stages = projectStages(t0, cornVRTable);
    expect(stages.find((s) => s.code === 'R3')!.isHarvestTargetStage).toBe(true);
    expect(stages.find((s) => s.code === 'R6')!.isHarvestTargetStage).toBe(true);
    expect(stages.find((s) => s.code === 'V2')!.isHarvestTargetStage).toBe(false);
  });

  it('preserves bodyKind and inspect copy on each stage', () => {
    const tableWithInspect: GrowthStageTable = {
      ...cornVRTable,
      stages: cornVRTable.stages.map((s) => ({ ...s, inspect: `inspect-${s.code}` }))
    };
    const stages = projectStages(t0, tableWithInspect);
    for (const s of stages) {
      expect(s.inspect).toBe(`inspect-${s.code}`);
      expect(s.bodyKind).toBeDefined();
    }
  });
});

describe('currentStage', () => {
  const t0 = Date.UTC(2026, 4, 1);
  const projected = projectStages(t0, cornVRTable);

  it('returns the latest stage that has started', () => {
    const now = t0 + 65 * DAY_MS; // Day 65 — VT (55-65) just ending, R1 (60-70) active
    const cur = currentStage(projected, now);
    expect(cur.current?.code).toBe('R1');
    expect(cur.next?.code).toBe('R3');
    expect(cur.daysIntoCurrent).toBe(5);
  });

  it('returns no current before first stage starts', () => {
    const now = t0 + 2 * DAY_MS; // Day 2 — before VE (5-10)
    const cur = currentStage(projected, now);
    expect(cur.current).toBeUndefined();
    expect(cur.next?.code).toBe('VE');
    expect(cur.daysToNext).toBe(3);
  });

  it('returns no next once past the last stage start', () => {
    const now = t0 + 200 * DAY_MS;
    const cur = currentStage(projected, now);
    expect(cur.current?.code).toBe('R6');
    expect(cur.next).toBeUndefined();
  });

  it('handles empty projected list', () => {
    expect(currentStage([], Date.now())).toEqual({});
  });
});

describe('projectHarvestTargets', () => {
  const t0 = Date.UTC(2026, 4, 1);

  it('emits one window per harvest target', () => {
    const projected = projectStages(t0, cornVRTable);
    const harvests = projectHarvestTargets(projected, cornVRTable);
    expect(harvests).toHaveLength(2);
    expect(harvests.map((h) => h.stageCode).sort()).toEqual(['R3', 'R6']);
  });

  it('R3 sweet-eating window precedes R6 dent window', () => {
    const projected = projectStages(t0, cornVRTable);
    const harvests = projectHarvestTargets(projected, cornVRTable);
    const r3 = harvests.find((h) => h.stageCode === 'R3')!;
    const r6 = harvests.find((h) => h.stageCode === 'R6')!;
    expect(r3.endMs).toBeLessThan(r6.startMs);
  });

  it('preserves label and useCase for each target', () => {
    const projected = projectStages(t0, cornVRTable);
    const harvests = projectHarvestTargets(projected, cornVRTable);
    const r3 = harvests.find((h) => h.stageCode === 'R3')!;
    expect(r3.label).toBe('Sweet eating');
    expect(r3.useCase).toBe('fresh-eating');
  });

  it('skips harvest targets whose stageCode is not in projected stages', () => {
    const orphanTable: GrowthStageTable = {
      ...cornVRTable,
      harvestTargets: [{ stageCode: 'NOPE', label: 'orphan' }]
    };
    const projected = projectStages(t0, cornVRTable);
    expect(projectHarvestTargets(projected, orphanTable)).toHaveLength(0);
  });
});

describe('projectPerennialStages', () => {
  const grapeTemplate = {
    stages: [
      { code: 'dormant', name: 'Dormant', dayOfYearStart: 1, dayOfYearEnd: 60, bodyKind: 'dormant' as const },
      { code: 'bud-break', name: 'Bud break', dayOfYearStart: 90, dayOfYearEnd: 120, bodyKind: 'vegetative' as const },
      { code: 'bloom', name: 'Bloom', dayOfYearStart: 140, dayOfYearEnd: 165, bodyKind: 'reproductive' as const },
      { code: 'harvest', name: 'Harvest', dayOfYearStart: 240, dayOfYearEnd: 290, bodyKind: 'ripening' as const }
    ],
    harvestStageCode: 'harvest',
    harvestLabel: 'Juice'
  };

  it('projects against the requested calendar year', () => {
    const stages = projectPerennialStages(grapeTemplate, 2026);
    expect(stages).toHaveLength(4);
    const harvest = stages.find((s) => s.code === 'harvest')!;
    expect(new Date(harvest.startMs).getFullYear()).toBe(2026);
  });

  it('marks the harvest stage as harvest-target', () => {
    const stages = projectPerennialStages(grapeTemplate, 2026);
    const targets = projectPerennialHarvestTargets(grapeTemplate, stages);
    expect(targets).toHaveLength(1);
    expect(targets[0].label).toBe('Juice');
  });
});

describe('projectStages — fast-check properties', () => {
  it('output entries are ordered by startMs ascending', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) }),
        (plant) => {
          const stages = projectStages(plant, cornVRTable);
          for (let i = 1; i < stages.length; i++) {
            expect(stages[i].startMs).toBeGreaterThanOrEqual(stages[i - 1].startMs);
          }
        }
      )
    );
  });

  it('every projected stage has endMs >= startMs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) }),
        fc.integer({ min: 30, max: 200 }),
        fc.integer({ min: 30, max: 200 }),
        (plant, dtmMin, dtmAdd) => {
          const stages = projectStages(plant, cornVRTable, { min: dtmMin, max: dtmMin + dtmAdd });
          for (const s of stages) expect(s.endMs).toBeGreaterThanOrEqual(s.startMs);
        }
      )
    );
  });

  it('harvest target windows fall within [plantingDate, plantingDate + dtm.max + 30d] for sweet corn', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) }),
        fc.integer({ min: 70, max: 90 }),
        (plant, dtmMid) => {
          const stages = projectStages(plant, cornVRTable, { min: dtmMid - 5, max: dtmMid + 5 });
          const harvests = projectHarvestTargets(stages, cornVRTable);
          for (const h of harvests) {
            expect(h.startMs).toBeGreaterThanOrEqual(plant);
            expect(h.endMs).toBeLessThanOrEqual(plant + (dtmMid + 5 + 60) * DAY_MS);
          }
        }
      )
    );
  });
});
