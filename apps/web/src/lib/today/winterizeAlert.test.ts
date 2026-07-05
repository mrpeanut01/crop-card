import { describe, expect, it } from 'vitest';
import { deriveWinterizeAlerts, startOfSeason, type SprayerWinterizeInput } from './winterizeAlert';

const NOW = new Date('2026-07-04T12:00:00Z').getTime();
const SEASON_START = startOfSeason(NOW);
const LAST_SEASON = new Date('2025-08-01T00:00:00Z').getTime();
const THIS_SEASON = new Date('2026-05-01T00:00:00Z').getTime();

function sprayer(over: Partial<SprayerWinterizeInput> = {}): SprayerWinterizeInput {
  return {
    id: 's1',
    label: 'CORN sprayer',
    calibratedGpa: 15,
    ...over
  };
}

describe('deriveWinterizeAlerts (UC-45 spring reminder)', () => {
  it('flags a sprayer sprayed this season that was never winterized', () => {
    const out = deriveWinterizeAlerts([sprayer({ lastSprayedAt: THIS_SEASON })], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].sprayerId).toBe('s1');
    expect(out[0].neverWinterized).toBe(true);
  });

  it('flags a sprayer whose winterizedAt predates the current season', () => {
    const out = deriveWinterizeAlerts(
      [sprayer({ lastSprayedAt: THIS_SEASON, winterizedAt: LAST_SEASON })],
      NOW
    );
    expect(out).toHaveLength(1);
    expect(out[0].neverWinterized).toBe(false);
  });

  it('does not flag a sprayer winterized within the current season', () => {
    const out = deriveWinterizeAlerts(
      [sprayer({ lastSprayedAt: THIS_SEASON, winterizedAt: SEASON_START + 1000 })],
      NOW
    );
    expect(out).toHaveLength(0);
  });

  it('does not flag a sprayer with no current-season activity', () => {
    const out = deriveWinterizeAlerts([sprayer({ lastSprayedAt: LAST_SEASON })], NOW);
    expect(out).toHaveLength(0);
  });

  it('activity via decon or calibration also triggers the reminder', () => {
    expect(deriveWinterizeAlerts([sprayer({ lastDeconAt: THIS_SEASON })], NOW)).toHaveLength(1);
    expect(deriveWinterizeAlerts([sprayer({ calibrationDate: THIS_SEASON })], NOW)).toHaveLength(1);
  });

  it('surfaces uncalibrated flag when calibration is missing', () => {
    const out = deriveWinterizeAlerts(
      [sprayer({ lastSprayedAt: THIS_SEASON, calibratedGpa: null })],
      NOW
    );
    expect(out[0].uncalibrated).toBe(true);
  });

  it('a fully-idle sprayer with no activity produces no alert', () => {
    const out = deriveWinterizeAlerts([sprayer({})], NOW);
    expect(out).toHaveLength(0);
  });

  it('handles multiple sprayers independently', () => {
    const out = deriveWinterizeAlerts(
      [
        sprayer({ id: 'a', lastSprayedAt: THIS_SEASON }),
        sprayer({ id: 'b', lastSprayedAt: THIS_SEASON, winterizedAt: SEASON_START + 1 }),
        sprayer({ id: 'c', lastSprayedAt: LAST_SEASON })
      ],
      NOW
    );
    expect(out.map((a) => a.sprayerId)).toEqual(['a']);
  });
});
