import { describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { ScheduleWindow } from './scheduleCandidacy';
import { evaluateSuccessionFit, splitQuantityForSuccession } from './succession';

function fakeWindow(opts: { startMs: number; endMs: number }): ScheduleWindow {
  return {
    stockItemId: 's',
    blockId: 'b',
    earliestMs: opts.startMs,
    latestMs: opts.endMs,
    hardiness: 'half-hardy',
    dtmDaysMax: 60,
    freeSubWindows: []
  };
}

function fakePlug(family: string, dtm: number): CropPlugin {
  return {
    pluginId: 'p',
    type: 'crop',
    schemaVersion: '1.0.0',
    displayName: 'p',
    cropFamily: family,
    daysToMaturity: { min: dtm, max: dtm + 5 }
  } as unknown as CropPlugin;
}

describe('evaluateSuccessionFit', () => {
  // 6-month window — March 1 through Sept 1
  const start = new Date(2026, 2, 1).getTime();
  const end = new Date(2026, 8, 1).getTime();
  const longWindow = fakeWindow({ startMs: start, endMs: end });

  it('lettuce in a long window → eligible with 14d spacing', () => {
    const fit = evaluateSuccessionFit(longWindow, fakePlug('leafy-green', 45), 'b', 's');
    expect(fit.eligible).toBe(true);
    expect(fit.suggestedIntervalDays).toBe(14);
    expect(fit.maxPlantings).toBeGreaterThanOrEqual(2);
  });

  it('cucurbits never succession (family-keyed)', () => {
    const fit = evaluateSuccessionFit(longWindow, fakePlug('cucurbit', 80), 'b', 's');
    expect(fit.eligible).toBe(false);
    expect(fit.reason).toMatch(/don't succession/);
  });

  it('tomatoes (solanaceae) never succession', () => {
    const fit = evaluateSuccessionFit(longWindow, fakePlug('solanaceae', 75), 'b', 's');
    expect(fit.eligible).toBe(false);
  });

  it('lettuce in a too-short window → not eligible', () => {
    // 40-day window can only fit one 45-day-DTM lettuce.
    const tight = fakeWindow({ startMs: start, endMs: start + 40 * 86_400_000 });
    const fit = evaluateSuccessionFit(tight, fakePlug('leafy-green', 45), 'b', 's');
    expect(fit.eligible).toBe(false);
    expect(fit.reason).toMatch(/season too short/);
  });

  it('clamps maxPlantings to 6 even when math says more', () => {
    // 365-day window, 14-day DTM → would be ~22 plantings; we clamp to 6.
    const yearLong = fakeWindow({ startMs: start, endMs: start + 365 * 86_400_000 });
    const fit = evaluateSuccessionFit(yearLong, fakePlug('leafy-green', 30), 'b', 's');
    expect(fit.maxPlantings).toBe(6);
  });

  it('no plugin → skipped', () => {
    const fit = evaluateSuccessionFit(longWindow, undefined, 'b', 's');
    expect(fit.eligible).toBe(false);
    expect(fit.reason).toMatch(/no plugin info/);
  });

  it('unknown family → no spacing declared → not eligible', () => {
    const fit = evaluateSuccessionFit(longWindow, fakePlug('mystery-family', 60), 'b', 's');
    expect(fit.eligible).toBe(false);
    expect(fit.reason).toMatch(/don't succession/);
  });
});

describe('splitQuantityForSuccession', () => {
  it('even split when quantity divides cleanly', () => {
    expect(splitQuantityForSuccession(60, 3)).toEqual([20, 20, 20]);
  });
  it('largest-remainder front-loads the extras', () => {
    expect(splitQuantityForSuccession(7, 3)).toEqual([3, 2, 2]);
    expect(splitQuantityForSuccession(10, 3)).toEqual([4, 3, 3]);
  });
  it('handles 1 planting', () => {
    expect(splitQuantityForSuccession(50, 1)).toEqual([50]);
  });
  it('handles 0 plantings', () => {
    expect(splitQuantityForSuccession(50, 0)).toEqual([]);
  });
  it('sum equals total for many splits', () => {
    const total = 137;
    const split = splitQuantityForSuccession(total, 6);
    expect(split.reduce((a, b) => a + b, 0)).toBe(total);
  });
});
