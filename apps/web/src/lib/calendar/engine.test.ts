import { describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { PlantingRecord } from '$lib/db/blocks';
import { eventsForPlanting, eventsInRange, upcomingEvents } from './engine';

const corn: CropPlugin = {
  pluginId: 'corn-bb',
  type: 'crop',
  displayName: 'Bloody Butcher',
  version: '1.0.0',
  cropFamily: 'corn',
  daysToMaturity: { min: 90, max: 100 }
};

const pumpkin: CropPlugin = {
  pluginId: 'pumpkin-ezg',
  type: 'crop',
  displayName: 'EZ Gro',
  version: '1.0.0',
  cropFamily: 'cucurbit',
  daysToMaturity: { min: 120, max: 130 }
};

const cover: CropPlugin = {
  pluginId: 'rye-cover',
  type: 'crop',
  displayName: 'Cereal Rye',
  version: '1.0.0',
  cropFamily: 'cover-grass'
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
