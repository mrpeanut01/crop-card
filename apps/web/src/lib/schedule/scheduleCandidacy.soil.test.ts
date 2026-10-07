import { describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import { earliestOffsetDays, hardinessOf, scheduleCandidacy } from './scheduleCandidacy';
import { deterministicPlantingWindow } from '$lib/plan/plantingWindow';

const DAY = 86_400_000;
const year = 2027;
const frost = {
  lastSpringFrostMs: Date.UTC(2027, 3, 16),
  firstFallFrostMs: Date.UTC(2027, 9, 25)
};
const today = Date.UTC(2026, 9, 7);

function plugin(opts: {
  id: string;
  family: string;
  soilTempMinF?: number;
  dtm?: [number, number];
  displayName?: string;
  archetype?: string;
}): CropPlugin {
  return {
    pluginId: opts.id,
    type: 'crop',
    schemaVersion: '1.0.0',
    displayName: opts.displayName ?? opts.id,
    cropFamily: opts.family,
    archetype: opts.archetype,
    plantingGuide: opts.soilTempMinF != null ? { soilTempMinF: opts.soilTempMinF } : undefined,
    daysToMaturity: opts.dtm ? { min: opts.dtm[0], max: opts.dtm[1] } : undefined
  } as unknown as CropPlugin;
}

function windowFor(plug: CropPlugin, nowMs = today) {
  return scheduleCandidacy({
    assignments: [
      {
        stockItemId: 's1',
        blockId: 'b1',
        cropPluginId: plug.pluginId,
        varietyDisplayName: plug.displayName,
        plants: 10
      }
    ],
    pluginIndex: { [plug.pluginId]: plug },
    existingCrops: [],
    frostDates: frost,
    year,
    nowMs
  })[0];
}

const winterWheat = plugin({
  id: 'wheat-soft-red-winter',
  family: 'cereal-grain',
  soilTempMinF: 50,
  dtm: [240, 270],
  displayName: 'Wheat — Soft Red Winter',
  archetype: 'small-grain.zadoks'
});

describe('soil temperature floors the spring window (#691)', () => {
  it('never puts a 50 °F soil crop before the last frost', () => {
    for (const t of [50, 55, 60, 64]) {
      expect(earliestOffsetDays(t, 'legume')).toBeGreaterThanOrEqual(0);
      expect(earliestOffsetDays(t, 'brassica')).toBeGreaterThanOrEqual(0);
    }
    const soy = windowFor(plugin({ id: 'soy', family: 'legume', soilTempMinF: 55 }));
    expect(soy.earliestMs).toBeGreaterThanOrEqual(frost.lastSpringFrostMs);
  });

  it('a tender family with a 50 °F plugin stays tender', () => {
    const corn = plugin({ id: 'corn', family: 'corn', soilTempMinF: 50, dtm: [100, 115] });
    expect(hardinessOf(corn)).toBe('tender');
    expect(windowFor(corn).earliestMs).toBe(frost.lastSpringFrostMs + 7 * DAY);
  });

  it('keeps cool-soil and unknown-soil crops ahead of the last frost', () => {
    const peas = windowFor(plugin({ id: 'peas', family: 'legume', soilTempMinF: 40 }));
    expect(peas.earliestMs).toBeLessThan(frost.lastSpringFrostMs);
    expect(earliestOffsetDays(undefined, 'brassica')).toBe(-14);
  });

  it('the /plan planting window agrees', () => {
    const w = deterministicPlantingWindow(
      { cropFamily: 'legume', soilTempMinF: 55, dtmMaxDays: 100 },
      { lastSpring: '2027-04-16', firstFall: '2027-10-25' }
    );
    expect(w.earliest).toBe('2027-04-16');
  });
});

describe('winter small grain is sown the fall before (#691)', () => {
  it('ends the window at the previous first fall frost', () => {
    const w = windowFor(winterWheat);
    expect(w.fallSown).toBe(true);
    expect(w.latestMs).toBe(Date.UTC(2026, 9, 25));
    expect(w.earliestMs).toBe(Date.UTC(2026, 9, 8));
    expect(w.latestMs).toBeLessThan(frost.lastSpringFrostMs);
  });

  it('opens 42 days ahead of the fall frost when planning early', () => {
    const w = windowFor(winterWheat, Date.UTC(2026, 6, 1));
    expect(w.earliestMs).toBe(Date.UTC(2026, 9, 25) - 42 * DAY);
    expect(w.latestMs).toBe(Date.UTC(2026, 9, 25));
  });

  it('spring wheat stays a spring crop', () => {
    const spring = plugin({
      id: 'wheat-hard-red-spring',
      family: 'cereal-grain',
      soilTempMinF: 40,
      dtm: [90, 110],
      displayName: 'Wheat — Hard Red Spring',
      archetype: 'small-grain.zadoks'
    });
    const w = windowFor(spring);
    expect(w.fallSown).toBeUndefined();
    expect(w.earliestMs).toBeGreaterThan(Date.UTC(2027, 0, 1));
  });
});
