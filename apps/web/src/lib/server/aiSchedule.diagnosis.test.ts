import { describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import { diagnoseScheduleProblem, type ScheduleInput } from './aiSchedule';
import { scheduleCandidacy } from '$lib/schedule/scheduleCandidacy';
import type { PollinationConstraint } from '$lib/plan/types';

const PLAN_YEAR = new Date().getFullYear() + 1;
const frostDates = {
  lastSpringFrostMs: new Date(PLAN_YEAR, 3, 15).getTime(),
  firstFallFrostMs: new Date(PLAN_YEAR, 9, 15).getTime()
};

function corn(id: string, dtmMax = 90): CropPlugin {
  return {
    pluginId: id,
    type: 'crop',
    schemaVersion: '1.0.0',
    displayName: id,
    cropFamily: 'corn',
    daysToMaturity: { min: dtmMax - 10, max: dtmMax },
    plantingGuide: { soilTempMinF: 65 }
  } as unknown as CropPlugin;
}

function staggerPair(
  a: string,
  b: string,
  displayA: string,
  displayB: string
): PollinationConstraint {
  return {
    kind: 'must-stagger',
    pair: [a, b],
    pairDisplayNames: [displayA, displayB],
    blockIds: ['b1', 'b2'],
    blockNames: ['B1', 'B2'],
    distanceFt: 50,
    requiredIsolationFeet: 250,
    staggerDays: 14,
    note: 'stagger 14d'
  };
}

describe('diagnoseScheduleProblem', () => {
  it('flags family pressure when N corn varieties need more stagger than the window allows', () => {
    // 6 corn varieties with DTM 105d = window ~Apr 22 → Jun 13 (~52 days
    // before factoring today-floor). Required spread = (6-1)*14 = 70 days.
    // Pressure > 1.
    const assignments = Array.from({ length: 6 }, (_, i) => ({
      stockItemId: `s${i + 1}`,
      blockId: `b${(i % 3) + 1}`,
      cropPluginId: `corn-${i + 1}`,
      varietyDisplayName: `Corn ${String.fromCharCode(65 + i)}`,
      plants: 100 * (i + 1)
    }));
    const pluginIndex = Object.fromEntries(
      assignments.map((a) => [a.cropPluginId, corn(a.cropPluginId, 105)])
    );
    const constraints: PollinationConstraint[] = [];
    for (let i = 0; i < assignments.length; i++) {
      for (let j = i + 1; j < assignments.length; j++) {
        constraints.push(
          staggerPair(
            assignments[i].stockItemId,
            assignments[j].stockItemId,
            assignments[i].varietyDisplayName,
            assignments[j].varietyDisplayName
          )
        );
      }
    }
    const input: ScheduleInput = {
      assignments,
      pluginIndex,
      existingCrops: [],
      pollinationConstraints: constraints,
      companionGroups: [],
      frostDates,
      year: PLAN_YEAR
    };
    const windows = scheduleCandidacy({ ...input, nowMs: new Date(PLAN_YEAR, 0, 1).getTime() });
    const dx = diagnoseScheduleProblem(input, windows);

    expect(dx.summary).toMatch(/6 corn varieties/);
    expect(dx.summary).toMatch(/14 days/);
    // Smallest-quantity variety is named.
    expect(dx.suggestions.some((s) => s.includes('Corn A'))).toBe(true);
    // Drop / skip-succession / rotation suggestions all present.
    expect(dx.suggestions.some((s) => /drop/i.test(s))).toBe(true);
    expect(dx.suggestions.some((s) => /succession/i.test(s))).toBe(true);
    expect(dx.suggestions.some((s) => /rotation/i.test(s))).toBe(true);
  });

  it('emits a generic-failure summary when no family pressure is detected', () => {
    const assignments = [
      {
        stockItemId: 's1',
        blockId: 'b1',
        cropPluginId: 'corn-1',
        varietyDisplayName: 'Bantam',
        plants: 100
      }
    ];
    const input: ScheduleInput = {
      assignments,
      pluginIndex: { 'corn-1': corn('corn-1', 90) },
      existingCrops: [],
      pollinationConstraints: [],
      companionGroups: [],
      frostDates,
      year: PLAN_YEAR
    };
    const windows = scheduleCandidacy({ ...input, nowMs: new Date(PLAN_YEAR, 0, 1).getTime() });
    const dx = diagnoseScheduleProblem(input, windows);

    expect(dx.summary).toMatch(/wasn't a single big constraint/);
    expect(dx.suggestions.length).toBeGreaterThan(0);
    expect(dx.suggestions.some((s) => /chat/i.test(s) || /Re-schedule/i.test(s))).toBe(true);
  });

  it('does not flag pressure when family count is low (e.g. 2 corn varieties)', () => {
    const assignments = [
      {
        stockItemId: 's1',
        blockId: 'b1',
        cropPluginId: 'corn-1',
        varietyDisplayName: 'A',
        plants: 100
      },
      {
        stockItemId: 's2',
        blockId: 'b2',
        cropPluginId: 'corn-2',
        varietyDisplayName: 'B',
        plants: 100
      }
    ];
    const input: ScheduleInput = {
      assignments,
      pluginIndex: { 'corn-1': corn('corn-1', 90), 'corn-2': corn('corn-2', 90) },
      existingCrops: [],
      pollinationConstraints: [staggerPair('s1', 's2', 'A', 'B')],
      companionGroups: [],
      frostDates,
      year: PLAN_YEAR
    };
    const windows = scheduleCandidacy({ ...input, nowMs: new Date(PLAN_YEAR, 0, 1).getTime() });
    const dx = diagnoseScheduleProblem(input, windows);
    // 2 varieties × 14d = 14d required vs ~75d window — comfortable, no pressure.
    expect(dx.summary).toMatch(/wasn't a single big constraint/);
  });
});
