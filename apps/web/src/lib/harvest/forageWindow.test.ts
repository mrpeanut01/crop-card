import { describe, expect, it } from 'vitest';
import { forageCutWindow, plantingHarvestKey } from './forageWindow';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('forageCutWindow — #230 cut-cycle gating (#270)', () => {
  const lastPickMs = Date.UTC(2026, 4, 1);

  it('returns null when not forage', () => {
    expect(
      forageCutWindow({
        isForage: false,
        lastPickMs,
        cutIntervalDays: { min: 28, max: 35 }
      })
    ).toBeNull();
  });

  it('returns null when no prior pick (pre-first-cut → caller falls back to dtm)', () => {
    expect(
      forageCutWindow({
        isForage: true,
        lastPickMs: undefined,
        cutIntervalDays: { min: 28, max: 35 }
      })
    ).toBeNull();
  });

  it('returns null when plugin declares no cut interval', () => {
    expect(
      forageCutWindow({
        isForage: true,
        lastPickMs,
        cutIntervalDays: undefined
      })
    ).toBeNull();
  });

  it('keys window off lastPickMs + cutIntervalDays when forage has been mowed', () => {
    const w = forageCutWindow({
      isForage: true,
      lastPickMs,
      cutIntervalDays: { min: 28, max: 35 }
    });
    expect(w).not.toBeNull();
    expect(w!.windowStartMs).toBe(lastPickMs + 28 * DAY_MS);
    expect(w!.windowEndMs).toBe(lastPickMs + 35 * DAY_MS);
  });

  it('point-interval (min === max) collapses to a single-day window', () => {
    const w = forageCutWindow({
      isForage: true,
      lastPickMs,
      cutIntervalDays: { min: 30, max: 30 }
    });
    expect(w!.windowStartMs).toBe(w!.windowEndMs);
  });
});

describe('plantingHarvestKey — #272 planting-scoped key', () => {
  it('uses cropId when present (planting-scoped)', () => {
    expect(
      plantingHarvestKey({ cropId: 'planting_abc', blockId: 'b1', cropPluginId: 'alfalfa' })
    ).toBe('planting:planting_abc');
  });

  it('falls back to legacy composite key when cropId is null', () => {
    expect(plantingHarvestKey({ cropId: null, blockId: 'b1', cropPluginId: 'alfalfa' })).toBe(
      'legacy:b1|alfalfa'
    );
  });

  it('falls back to legacy composite key when cropId is undefined', () => {
    expect(plantingHarvestKey({ cropId: undefined, blockId: 'b1', cropPluginId: 'alfalfa' })).toBe(
      'legacy:b1|alfalfa'
    );
  });

  it('distinct plantings of the same crop in the same block get distinct keys (#272 regression)', () => {
    const k1 = plantingHarvestKey({
      cropId: 'planting_2024_alfalfa',
      blockId: 'north-10',
      cropPluginId: 'alfalfa-1'
    });
    const k2 = plantingHarvestKey({
      cropId: 'planting_2026_alfalfa',
      blockId: 'north-10',
      cropPluginId: 'alfalfa-1'
    });
    expect(k1).not.toBe(k2);
  });
});
