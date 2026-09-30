/**
 * Phase 32E (E1-11). Occupancy start, PHI and spray windows, pollination
 * timing (bloom) and every other planting event stay on the in-ground date
 * whatever the "Seed or seedling?" answer. Only the harvest estimate moves,
 * and only for a transplant whose days to maturity count from seeding and
 * whose indoor sowing is on record.
 */
import { describe, expect, it } from 'vitest';
import type { PlantingRecord } from '$lib/db/blocks';
import type { CropPlugin } from '$lib/plugins/schemas';
import { eventsForPlanting } from '$lib/calendar/engine';
import { plantingOccupancy, type OccupancyPlanting } from '$lib/garden/occupancy';
import type { GardenCrop } from '$lib/garden/types';

const DAY = 86_400_000;
const planted = Date.UTC(2026, 4, 10);
const sown = Date.UTC(2026, 2, 20);

function crop(dtmFrom?: 'direct-seed' | 'transplant'): CropPlugin {
  return {
    pluginId: 'squash-test',
    type: 'crop',
    displayName: 'Squash',
    version: '1.0.0',
    cropFamily: 'cucurbit',
    harvestStyle: 'cure-then-store',
    bloomWindow: { daysFromPlantingMin: 40, daysFromPlantingMax: 60, beeAttractive: true },
    daysToMaturity: { min: 80, max: 90 },
    preHarvestIntervalDays: 7,
    plantingGuide: dtmFrom ? { dtmFrom } : {}
  } as CropPlugin;
}

const ANSWERS: Array<Pick<PlantingRecord, 'establishment' | 'sownIndoorsAt'>> = [
  {},
  { establishment: null, sownIndoorsAt: null },
  { establishment: 'direct-seed', sownIndoorsAt: null },
  { establishment: 'transplant', sownIndoorsAt: null },
  { establishment: 'transplant', sownIndoorsAt: sown },
  { establishment: 'direct-seed', sownIndoorsAt: sown }
];

function record(extra: Pick<PlantingRecord, 'establishment' | 'sownIndoorsAt'>): PlantingRecord {
  return {
    id: 'p1',
    blockId: 'b1',
    cropPluginId: 'squash-test',
    varietyDisplayName: 'Squash',
    plantingDate: planted,
    ...extra
  };
}

const shifts = (a: Pick<PlantingRecord, 'establishment' | 'sownIndoorsAt'>, dtmFrom?: string) =>
  a.establishment === 'transplant' && a.sownIndoorsAt != null && dtmFrom === 'direct-seed';

describe('calendar engine', () => {
  for (const dtmFrom of [undefined, 'direct-seed', 'transplant'] as const) {
    it(`keeps every non-harvest event on the in-ground date (dtmFrom ${dtmFrom ?? 'unset'})`, () => {
      const baseline = eventsForPlanting(record({}), crop(dtmFrom));
      for (const a of ANSWERS) {
        const events = eventsForPlanting(record(a), crop(dtmFrom));
        expect(events.filter((e) => e.kind !== 'harvest-window')).toEqual(
          baseline.filter((e) => e.kind !== 'harvest-window')
        );
        const harvest = events.find((e) => e.kind === 'harvest-window')!;
        const base = baseline.find((e) => e.kind === 'harvest-window')!;
        const shift = shifts(a, dtmFrom) ? sown - planted : 0;
        expect(harvest.startMs).toBe(Math.max(planted, base.startMs + shift));
        expect(harvest.endMs).toBe(Math.max(planted, base.endMs + shift));
      }
    });
  }

  it('pins the planting event itself to the in-ground date', () => {
    const events = eventsForPlanting(
      record({ establishment: 'transplant', sownIndoorsAt: sown }),
      crop('direct-seed')
    );
    expect(events.find((e) => e.kind === 'planting')?.startMs).toBe(planted);
  });
});

describe('garden occupancy', () => {
  const garden: GardenCrop = {
    pluginId: 'squash-test',
    displayName: 'Squash',
    cropFamily: 'cucurbit',
    archetype: 'winter-squash-cure',
    daysToMaturity: { min: 80, max: 90 },
    plantingGuide: { dtmFrom: 'direct-seed' }
  };
  const base: OccupancyPlanting = {
    cropId: 'p1',
    blockId: 'b1',
    cropPluginId: 'squash-test',
    status: 'active',
    plantingDateMs: planted,
    harvestedAtMs: null,
    footprint: null
  };
  const opts = { firstFallFrostMs: Date.UTC(2026, 9, 24) };

  it('starts on the in-ground date for every answer', () => {
    for (const a of ANSWERS) {
      const iv = plantingOccupancy(
        { ...base, establishment: a.establishment, sownIndoorsAtMs: a.sownIndoorsAt },
        garden,
        opts
      )!;
      expect(iv.startMs).toBe(planted);
    }
  });

  it('ends earlier only for a recorded indoor start whose DTM counts from seeding', () => {
    const plain = plantingOccupancy(base, garden, opts)!;
    const unanswered = plantingOccupancy(
      { ...base, establishment: null, sownIndoorsAtMs: sown },
      garden,
      opts
    )!;
    expect(unanswered).toEqual(plain);
    const started = plantingOccupancy(
      { ...base, establishment: 'transplant', sownIndoorsAtMs: sown },
      garden,
      opts
    )!;
    expect(started.harvestStartMs).toBe(sown + 80 * DAY);
    expect(started.harvestEndMs).toBeLessThan(plain.harvestEndMs);
    expect(started.startMs).toBe(plain.startMs);
  });
});
