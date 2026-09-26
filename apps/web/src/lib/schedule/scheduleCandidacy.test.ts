import { describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { Crop } from '$lib/db/crops';
import { hardinessOf, scheduleCandidacy, formatDateMs } from './scheduleCandidacy';
import { frostDatesFromMmDd } from './frostSeason';

function fakePlugin(opts: {
  id: string;
  family: string;
  soilTempMinF?: number;
  dtm?: [number, number];
}): CropPlugin {
  return {
    pluginId: opts.id,
    type: 'crop',
    schemaVersion: '1.0.0',
    displayName: opts.id,
    cropFamily: opts.family,
    plantingGuide: opts.soilTempMinF != null ? { soilTempMinF: opts.soilTempMinF } : undefined,
    daysToMaturity: opts.dtm ? { min: opts.dtm[0], max: opts.dtm[1] } : undefined
  } as unknown as CropPlugin;
}

// Plan year is always "next season" relative to whenever tests run, so the
// fixtures never become stale as the calendar rolls forward.
const PLAN_YEAR = new Date().getFullYear() + 1;
function lastSpring(year: number = PLAN_YEAR) {
  return new Date(year, 3, 15).getTime(); // Apr 15
}
function firstFall(year: number = PLAN_YEAR) {
  return new Date(year, 9, 15).getTime(); // Oct 15
}

describe('hardinessOf', () => {
  it('tender when soilTempMinF >= 65', () => {
    expect(hardinessOf(fakePlugin({ id: 'p', family: 'corn', soilTempMinF: 65 }))).toBe('tender');
    expect(hardinessOf(fakePlugin({ id: 'p', family: 'corn', soilTempMinF: 80 }))).toBe('tender');
  });
  it('half-hardy when soilTempMinF in [50, 65)', () => {
    expect(hardinessOf(fakePlugin({ id: 'p', family: 'brassica', soilTempMinF: 55 }))).toBe(
      'half-hardy'
    );
  });
  it('hardy when soilTempMinF < 50', () => {
    expect(hardinessOf(fakePlugin({ id: 'p', family: 'leafy-green', soilTempMinF: 40 }))).toBe(
      'hardy'
    );
  });
  it('falls back to family default when soil temp missing', () => {
    expect(hardinessOf(fakePlugin({ id: 'p', family: 'cucurbit' }))).toBe('tender');
    expect(hardinessOf(fakePlugin({ id: 'p', family: 'root-crop' }))).toBe('hardy');
    expect(hardinessOf(fakePlugin({ id: 'p', family: 'brassica' }))).toBe('half-hardy');
  });
  it('half-hardy default for unknown family', () => {
    expect(hardinessOf(fakePlugin({ id: 'p', family: 'mystery' }))).toBe('half-hardy');
  });
});

describe('scheduleCandidacy windows', () => {
  const frost = { lastSpringFrostMs: lastSpring(), firstFallFrostMs: firstFall() };
  const year = PLAN_YEAR;
  // Pin "now" to Jan 1 of the plan year so the today-floor doesn't interfere
  // with the agronomic-earliest assertions below. Tests that exercise the
  // floor itself set nowMs explicitly.
  const nowMs = new Date(PLAN_YEAR, 0, 1).getTime();

  it('tender variety plants 7d after last frost', () => {
    const plug = fakePlugin({ id: 'corn1', family: 'corn', soilTempMinF: 70, dtm: [85, 95] });
    const windows = scheduleCandidacy({
      assignments: [
        {
          stockItemId: 's1',
          blockId: 'b1',
          cropPluginId: 'corn1',
          varietyDisplayName: 'Bantam',
          plants: 100
        }
      ],
      pluginIndex: { corn1: plug },
      existingCrops: [],
      frostDates: frost,
      year,

      nowMs
    });
    expect(windows).toHaveLength(1);
    expect(windows[0].hardiness).toBe('tender');
    const expectedEarliest = lastSpring() + 7 * 86_400_000;
    expect(windows[0].earliestMs).toBe(expectedEarliest);
  });

  it('hardy variety plants 42d before last frost', () => {
    const plug = fakePlugin({
      id: 'spin1',
      family: 'leafy-green',
      soilTempMinF: 40,
      dtm: [40, 50]
    });
    const windows = scheduleCandidacy({
      assignments: [
        {
          stockItemId: 's1',
          blockId: 'b1',
          cropPluginId: 'spin1',
          varietyDisplayName: 'Spinach',
          plants: 200
        }
      ],
      pluginIndex: { spin1: plug },
      existingCrops: [],
      frostDates: frost,
      year,

      nowMs
    });
    expect(windows[0].hardiness).toBe('hardy');
    expect(windows[0].earliestMs).toBe(lastSpring() - 42 * 86_400_000);
  });

  it('latestMs = firstFallFrost - DTM - 14d buffer', () => {
    const plug = fakePlugin({ id: 'corn1', family: 'corn', dtm: [80, 95] });
    const windows = scheduleCandidacy({
      assignments: [
        {
          stockItemId: 's1',
          blockId: 'b1',
          cropPluginId: 'corn1',
          varietyDisplayName: 'Corn',
          plants: 100
        }
      ],
      pluginIndex: { corn1: plug },
      existingCrops: [],
      frostDates: frost,
      year,

      nowMs
    });
    const expectedLatest = firstFall() - 95 * 86_400_000 - 14 * 86_400_000;
    expect(windows[0].latestMs).toBe(expectedLatest);
    expect(windows[0].dtmDaysMax).toBe(95);
  });

  it('produces empty freeSubWindows when block is unoccupied', () => {
    const plug = fakePlugin({ id: 'corn1', family: 'corn', dtm: [80, 90] });
    const windows = scheduleCandidacy({
      assignments: [
        {
          stockItemId: 's1',
          blockId: 'b1',
          cropPluginId: 'corn1',
          varietyDisplayName: 'Corn',
          plants: 100
        }
      ],
      pluginIndex: { corn1: plug },
      existingCrops: [],
      frostDates: frost,
      year,

      nowMs
    });
    expect(windows[0].freeSubWindows).toEqual([]);
  });

  it('splits free windows around an occupied block', () => {
    const plug = fakePlugin({ id: 'corn1', family: 'corn', soilTempMinF: 50, dtm: [80, 90] });
    const existing: Crop = {
      id: 'c1',
      blockId: 'b1',
      cropPluginId: 'other',
      plantingDate: new Date(PLAN_YEAR, 4, 1).getTime(), // May 1 of plan year
      status: 'planned'
    } as unknown as Crop;
    const otherPlug = fakePlugin({ id: 'other', family: 'leafy-green', dtm: [40, 60] });
    const windows = scheduleCandidacy({
      assignments: [
        {
          stockItemId: 's1',
          blockId: 'b1',
          cropPluginId: 'corn1',
          varietyDisplayName: 'Corn',
          plants: 100
        }
      ],
      pluginIndex: { corn1: plug, other: otherPlug },
      existingCrops: [existing],
      frostDates: frost,
      year,

      nowMs
    });
    expect(windows[0].freeSubWindows).toBeDefined();
    expect((windows[0].freeSubWindows ?? []).length).toBeGreaterThan(0);
  });

  it('ignores archived / harvested existing crops', () => {
    const plug = fakePlugin({ id: 'corn1', family: 'corn', dtm: [80, 90] });
    const existing: Crop = {
      id: 'c1',
      blockId: 'b1',
      cropPluginId: 'other',
      plantingDate: new Date(PLAN_YEAR, 4, 1).getTime(),
      status: 'harvested'
    } as unknown as Crop;
    const windows = scheduleCandidacy({
      assignments: [
        {
          stockItemId: 's1',
          blockId: 'b1',
          cropPluginId: 'corn1',
          varietyDisplayName: 'Corn',
          plants: 100
        }
      ],
      pluginIndex: { corn1: plug, other: plug },
      existingCrops: [existing],
      frostDates: frost,
      year,

      nowMs
    });
    expect(windows[0].freeSubWindows).toEqual([]);
  });
});

describe('today-floor — earliestMs never falls in the past', () => {
  const frost = { lastSpringFrostMs: lastSpring(), firstFallFrostMs: firstFall() };

  it('floors earliestMs at tomorrow when "today" is past the agronomic earliest', () => {
    const plug = fakePlugin({ id: 'corn1', family: 'corn', soilTempMinF: 65, dtm: [80, 90] });
    // Simulate "today" = May 10 of the plan year (past last frost + 7d tender buffer).
    const todayMs = new Date(PLAN_YEAR, 4, 10).getTime();
    const windows = scheduleCandidacy({
      assignments: [
        {
          stockItemId: 's1',
          blockId: 'b1',
          cropPluginId: 'corn1',
          varietyDisplayName: 'Corn',
          plants: 100
        }
      ],
      pluginIndex: { corn1: plug },
      existingCrops: [],
      frostDates: frost,
      year: PLAN_YEAR,
      nowMs: todayMs
    });
    const expectedTomorrow = new Date(PLAN_YEAR, 4, 11).getTime();
    expect(windows[0].earliestMs).toBe(expectedTomorrow);
  });

  it('uses the agronomic earliest when "today" is before it', () => {
    const plug = fakePlugin({ id: 'corn1', family: 'corn', soilTempMinF: 65, dtm: [80, 90] });
    const todayMs = new Date(PLAN_YEAR, 2, 1).getTime(); // Mar 1 of plan year
    const windows = scheduleCandidacy({
      assignments: [
        {
          stockItemId: 's1',
          blockId: 'b1',
          cropPluginId: 'corn1',
          varietyDisplayName: 'Corn',
          plants: 100
        }
      ],
      pluginIndex: { corn1: plug },
      existingCrops: [],
      frostDates: frost,
      year: PLAN_YEAR,
      nowMs: todayMs
    });
    // Tender corn: last spring frost + 7d.
    const expected = lastSpring() + 7 * 86_400_000;
    expect(windows[0].earliestMs).toBe(expected);
  });

  it('keeps latestMs >= earliestMs even when "today" is past the natural latest', () => {
    const plug = fakePlugin({ id: 'corn1', family: 'corn', soilTempMinF: 65, dtm: [80, 90] });
    const todayMs = new Date(PLAN_YEAR, 10, 1).getTime(); // Nov 1 of plan year — past first fall frost
    const windows = scheduleCandidacy({
      assignments: [
        {
          stockItemId: 's1',
          blockId: 'b1',
          cropPluginId: 'corn1',
          varietyDisplayName: 'Corn',
          plants: 100
        }
      ],
      pluginIndex: { corn1: plug },
      existingCrops: [],
      frostDates: frost,
      year: PLAN_YEAR,
      nowMs: todayMs
    });
    expect(windows[0].earliestMs).toBeGreaterThan(todayMs);
    expect(windows[0].latestMs).toBeGreaterThanOrEqual(windows[0].earliestMs);
  });
});

describe('formatDateMs', () => {
  it('emits YYYY-MM-DD', () => {
    expect(formatDateMs(new Date(2026, 4, 1).getTime())).toBe('2026-05-01');
  });
});

describe('block occupancy follows the garden designer rule', () => {
  it('holds a cut-and-come-again crop through its cut window and turnover', () => {
    const frost = { lastSpringFrostMs: lastSpring(), firstFallFrostMs: firstFall() };
    const corn = fakePlugin({ id: 'corn1', family: 'corn', soilTempMinF: 65, dtm: [80, 90] });
    const lettuce = {
      ...fakePlugin({ id: 'lettuce', family: 'leafy-green', dtm: [40, 50] }),
      archetype: 'cut-and-come-again-leafy'
    } as CropPlugin;
    const plantedMs = new Date(PLAN_YEAR, 3, 20).getTime();
    const existing = {
      id: 'c1',
      blockId: 'b1',
      cropPluginId: 'lettuce',
      plantingDate: plantedMs,
      status: 'planned'
    } as unknown as Crop;
    const [w] = scheduleCandidacy({
      assignments: [
        {
          stockItemId: 's1',
          blockId: 'b1',
          cropPluginId: 'corn1',
          varietyDisplayName: 'Corn',
          plants: 10
        }
      ],
      pluginIndex: { corn1: corn, lettuce },
      existingCrops: [existing],
      frostDates: frost,
      year: PLAN_YEAR,
      nowMs: new Date(PLAN_YEAR, 0, 1).getTime()
    });
    const busyUntil = plantedMs + (50 + 21 + 10) * 86_400_000;
    expect(busyUntil).toBeGreaterThan(w.latestMs);
    for (const [start] of w.freeSubWindows ?? []) expect(start).toBeLessThan(plantedMs);
  });
});

describe('scheduleCandidacy for a season that crosses the new year', () => {
  const year = PLAN_YEAR;
  const nowMs = new Date(PLAN_YEAR, 0, 1).getTime();
  const gulf = frostDatesFromMmDd(year, '01-31', '01-06');
  const tomato = fakePlugin({ id: 'tom', family: 'solanaceae', soilTempMinF: 60, dtm: [70, 80] });

  function windowFor(existingCrops: Crop[] = []) {
    return scheduleCandidacy({
      assignments: [
        {
          stockItemId: 's1',
          blockId: 'b1',
          cropPluginId: 'tom',
          varietyDisplayName: 'Tomato',
          plants: 10
        }
      ],
      pluginIndex: { tom: tomato },
      existingCrops,
      frostDates: gulf,
      year,
      nowMs
    })[0];
  }

  it('opens a long window from late winter to fall at a Gulf-coast station', () => {
    const w = windowFor();
    expect(formatDateMs(gulf.firstFallFrostMs)).toBe(`${year + 1}-01-06`);
    expect(formatDateMs(w.earliestMs)).toBe(`${year}-01-17`);
    expect(formatDateMs(w.latestMs)).toBe(`${year}-10-04`);
    expect(w.latestMs - w.earliestMs).toBeGreaterThan(250 * 86_400_000);
  });

  it('still frees the bed after a continuous-harvest crop ends at the January frost', () => {
    const planted = new Date(year, 2, 1).getTime();
    const busy = {
      id: 'c1',
      blockId: 'b1',
      cropPluginId: 'tom',
      status: 'active',
      plantingDate: planted,
      harvestedAt: null
    } as unknown as Crop;
    const w = windowFor([busy]);
    expect(w.freeSubWindows?.length ?? 0).toBeGreaterThanOrEqual(1);
    for (const [start, end] of w.freeSubWindows ?? []) {
      expect(end).toBeGreaterThan(start);
      expect(start).toBeLessThan(planted);
    }
  });
});
