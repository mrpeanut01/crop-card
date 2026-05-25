import { describe, expect, it } from 'vitest';
import type { HarvestEvent } from '$lib/db/harvestEvents';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { PlantingRecord } from '$lib/db/blocks';
import { eventsForHarvest, eventsForPlanting, eventsInRange, upcomingEvents } from './engine';

const corn: CropPlugin = {
  pluginId: 'corn-bb',
  type: 'crop',
  displayName: 'Bloody Butcher',
  version: '1.0.0',
  cropFamily: 'corn',
  harvestStyle: 'row-grain-pollinated',
  bloomWindow: { daysFromPlantingMin: 55, daysFromPlantingMax: 75, beeAttractive: false },
  daysToMaturity: { min: 90, max: 100 }
};

const pumpkin: CropPlugin = {
  pluginId: 'pumpkin-ezg',
  type: 'crop',
  displayName: 'EZ Gro',
  version: '1.0.0',
  cropFamily: 'cucurbit',
  harvestStyle: 'cure-then-store',
  bloomWindow: { continuous: true, beeAttractive: true },
  daysToMaturity: { min: 120, max: 130 }
};

const cover: CropPlugin = {
  pluginId: 'rye-cover',
  type: 'crop',
  displayName: 'Cereal Rye',
  version: '1.0.0',
  cropFamily: 'cover-grass',
  harvestStyle: 'cover-crop-termination',
  bloomWindow: { monthsOfYear: [5, 6], beeAttractive: false }
};

function planting(crop: CropPlugin, plantingDate: number): PlantingRecord {
  return {
    id: 'planting-1',
    blockId: 'block-1',
    cropPluginId: crop.pluginId,
    varietyDisplayName: crop.displayName,
    plantingDate
  };
}

describe('eventsForPlanting', () => {
  it('emits planting + emergence + harvest for any crop with DTM', () => {
    const t0 = Date.UTC(2026, 4, 5);
    const events = eventsForPlanting(planting(corn, t0), corn);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('planting');
    expect(kinds).toContain('emergence');
    expect(kinds).toContain('harvest-window');
  });

  it('emits both V2-V3 and V4-V6 spray windows for corn', () => {
    const t0 = Date.UTC(2026, 4, 5);
    const events = eventsForPlanting(planting(corn, t0), corn);
    const sprays = events.filter((e) => e.kind === 'spray-window');
    expect(sprays).toHaveLength(2);
    const stages = sprays.map((e) => e.detail?.stage).sort();
    expect(stages).toEqual(['V2-V3', 'V4-V6']);
  });

  it('emits stage-window events for the corn V/R-stage table', () => {
    const t0 = Date.UTC(2026, 4, 5);
    const events = eventsForPlanting(planting(corn, t0), corn);
    const stageEvents = events.filter((e) => e.kind === 'stage-window');
    // Family default for corn carries 12 stages (VE..R6).
    expect(stageEvents.length).toBeGreaterThanOrEqual(8);
    const codes = stageEvents.map((e) => e.detail?.stageCode);
    expect(codes).toContain('R1');
    expect(codes).toContain('R3');
    expect(codes).toContain('R6');
    // Every stage-window detail carries `system: 'vr-corn'`.
    for (const e of stageEvents) {
      expect(e.detail?.system).toBe('vr-corn');
    }
  });

  it('emits two harvest-window events for dual-purpose corn (R3 + R6)', () => {
    const dualPurposeCorn: CropPlugin = {
      pluginId: 'corn-dual',
      type: 'crop',
      displayName: 'Dual Corn',
      version: '1.3.0',
      cropFamily: 'corn',
      harvestStyle: 'row-grain-pollinated',
      bloomWindow: { daysFromPlantingMin: 55, daysFromPlantingMax: 75, beeAttractive: false },
      cornType: 'dual-purpose',
      daysToMaturity: { min: 90, max: 100 },
      growthStageTable: {
        system: 'vr-corn',
        referenceDtmDays: 95,
        stages: [
          { code: 'R3', name: 'Milk', daysFromPlanting: { min: 78, max: 88 } },
          { code: 'R6', name: 'Black layer', daysFromPlanting: { min: 110, max: 130 } }
        ],
        harvestTargets: [
          { stageCode: 'R3', label: 'Sweet eating', useCase: 'fresh-eating' },
          { stageCode: 'R6', label: 'Dent', useCase: 'milling' }
        ]
      }
    };
    const t0 = Date.UTC(2026, 4, 5);
    const events = eventsForPlanting(planting(dualPurposeCorn, t0), dualPurposeCorn);
    const harvests = events.filter((e) => e.kind === 'harvest-window');
    expect(harvests).toHaveLength(2);
    const stageCodes = harvests.map((e) => e.detail?.stageCode).sort();
    expect(stageCodes).toEqual(['R3', 'R6']);
    const r3 = harvests.find((e) => e.detail?.stageCode === 'R3')!;
    const r6 = harvests.find((e) => e.detail?.stageCode === 'R6')!;
    expect(r3.endMs).toBeLessThan(r6.startMs);
  });

  it('emits a single harvest-window when a sweet-only variety has only R3', () => {
    const sweetCorn: CropPlugin = {
      pluginId: 'corn-sweet',
      type: 'crop',
      displayName: 'Sweet',
      version: '1.3.0',
      cropFamily: 'corn',
      harvestStyle: 'row-grain-pollinated',
      bloomWindow: { daysFromPlantingMin: 55, daysFromPlantingMax: 75, beeAttractive: false },
      cornType: 'sweet',
      daysToMaturity: { min: 70, max: 80 },
      growthStageTable: {
        system: 'vr-corn',
        referenceDtmDays: 75,
        stages: [{ code: 'R3', name: 'Milk', daysFromPlanting: { min: 65, max: 75 } }],
        harvestTargets: [{ stageCode: 'R3', label: 'Sweet eating', useCase: 'fresh-eating' }]
      }
    };
    const t0 = Date.UTC(2026, 4, 5);
    const events = eventsForPlanting(planting(sweetCorn, t0), sweetCorn);
    const harvests = events.filter((e) => e.kind === 'harvest-window');
    expect(harvests).toHaveLength(1);
    expect(harvests[0].detail?.stageCode).toBe('R3');
  });

  it('emits Three Sisters companion triggers only for corn plantings', () => {
    const cornEvents = eventsForPlanting(planting(corn, Date.UTC(2026, 4, 5)), corn);
    const pumpkinEvents = eventsForPlanting(planting(pumpkin, Date.UTC(2026, 4, 5)), pumpkin);
    expect(cornEvents.some((e) => e.kind === 'companion-trigger')).toBe(true);
    expect(pumpkinEvents.some((e) => e.kind === 'companion-trigger')).toBe(false);
  });

  it('emits Clethodim window for cucurbits but not corn', () => {
    const cornEvents = eventsForPlanting(planting(corn, Date.UTC(2026, 4, 5)), corn);
    const pumpkinEvents = eventsForPlanting(planting(pumpkin, Date.UTC(2026, 4, 5)), pumpkin);
    expect(cornEvents.some((e) => /Clethodim/.test(e.title))).toBe(false);
    expect(pumpkinEvents.some((e) => /Clethodim/.test(e.title))).toBe(true);
  });

  it('emits cover-termination event for cover crops', () => {
    const events = eventsForPlanting(planting(cover, Date.UTC(2025, 8, 1)), cover);
    expect(events.some((e) => e.kind === 'cover-termination')).toBe(true);
  });
});

describe('FR-18 cover-crop termination tied to next cash-crop date', () => {
  it('anchors window 14–21 days before the next cash-crop planting in the same block', () => {
    const coverPlant = planting(cover, Date.UTC(2025, 8, 1)); // Sep 1, 2025
    const cornNext = {
      id: 'planting-corn',
      blockId: coverPlant.blockId,
      cropPluginId: corn.pluginId,
      varietyDisplayName: corn.displayName,
      plantingDate: Date.UTC(2026, 4, 1) // May 1, 2026
    };
    const events = eventsForPlanting(coverPlant, cover, {
      blockPlantings: [coverPlant, cornNext]
    });
    const term = events.find((e) => e.kind === 'cover-termination');
    expect(term).toBeDefined();
    const windowStartDays = (cornNext.plantingDate - term!.startMs) / 86400000;
    const windowEndDays = (cornNext.plantingDate - term!.endMs) / 86400000;
    expect(windowStartDays).toBeCloseTo(21, 0);
    expect(windowEndDays).toBeCloseTo(14, 0);
    expect(term!.detail?.nextCashCropPlantingId).toBe('planting-corn');
  });

  it('falls back to generic +180 day offset when no follow-up planting exists', () => {
    const coverPlant = planting(cover, Date.UTC(2025, 8, 1));
    const events = eventsForPlanting(coverPlant, cover, { blockPlantings: [coverPlant] });
    const term = events.find((e) => e.kind === 'cover-termination');
    expect(term).toBeDefined();
    expect(term!.body).toMatch(/generic spring/i);
  });
});

describe('FR-10 orchard seasonal tasks', () => {
  const apple: CropPlugin = {
    pluginId: 'apple',
    type: 'crop',
    displayName: 'Apple',
    version: '1.0.0',
    cropFamily: 'orchard',
    harvestStyle: 'tree-fruit-multi-pick',
    bloomWindow: { monthsOfYear: [4, 5], beeAttractive: true },
    orchardSeasonalTasks: [
      {
        key: 'dormant-oil',
        dayOfYear: 75,
        windowDays: 14,
        title: 'Dormant oil spray window'
      },
      {
        key: 'bloom-fungicide',
        dayOfYear: 120,
        windowDays: 14,
        title: 'Bloom fungicide'
      }
    ]
  };

  it('emits one orchard-task per plugin task per season-year (3 years)', () => {
    const events = eventsForPlanting(planting(apple, Date.UTC(2026, 0, 15)), apple);
    const orchard = events.filter((e) => e.kind === 'orchard-task');
    // 2 task templates × 3 years = 6 events
    expect(orchard).toHaveLength(6);
  });

  it('skips non-orchard crops', () => {
    const events = eventsForPlanting(planting(corn, Date.UTC(2026, 4, 5)), corn);
    expect(events.some((e) => e.kind === 'orchard-task')).toBe(false);
  });
});

describe('FR-08 eventsForHarvest curing reminders', () => {
  const cornWithCuring: CropPlugin = {
    ...corn,
    postHarvestCuring: {
      method: 'Rack cure',
      durationWeeks: { min: 2, max: 4 },
      targetMoisturePercent: { min: 14, max: 15 }
    }
  };

  function harvest(at: number): HarvestEvent {
    return {
      id: 'h1',
      blockId: 'block-1',
      cropPluginId: cornWithCuring.pluginId,
      occurredAt: at,
      lotNumber: 'lot-1'
    };
  }

  it('emits curing-progress + curing-ready bracketing the duration window', () => {
    const t0 = Date.UTC(2026, 9, 1);
    const events = eventsForHarvest(harvest(t0), cornWithCuring);
    expect(events).toHaveLength(2);
    const inProgress = events.find((e) => e.kind === 'curing-progress')!;
    const ready = events.find((e) => e.kind === 'curing-ready')!;
    expect(inProgress.startMs).toBe(t0);
    expect((inProgress.endMs - t0) / 86400000).toBeCloseTo(14, 0); // 2 weeks
    expect((ready.endMs - t0) / 86400000).toBeCloseTo(28, 0); // 4 weeks
  });

  it('emits no events when the crop has no postHarvestCuring data', () => {
    expect(eventsForHarvest(harvest(Date.UTC(2026, 9, 1)), corn)).toEqual([]);
  });
});

describe('eventsInRange + upcomingEvents', () => {
  it('filters by inclusive start/end overlap with the requested range', () => {
    const t0 = Date.UTC(2026, 4, 5);
    const events = eventsForPlanting(planting(corn, t0), corn);
    const inRange = eventsInRange(events, t0 + 18 * 86400000, t0 + 22 * 86400000);
    expect(inRange.some((e) => e.title.includes('V2'))).toBe(true);
    expect(inRange.some((e) => e.title.includes('Harvest'))).toBe(false);
  });

  it('upcomingEvents returns sorted, future-only events within the window', () => {
    const t0 = Date.UTC(2026, 4, 5);
    const events = eventsForPlanting(planting(corn, t0), corn);
    const upcoming = upcomingEvents(events, 30, t0);
    for (let i = 1; i < upcoming.length; i++) {
      expect(upcoming[i].startMs).toBeGreaterThanOrEqual(upcoming[i - 1].startMs);
    }
    expect(upcoming.every((e) => e.endMs >= t0)).toBe(true);
  });
});
