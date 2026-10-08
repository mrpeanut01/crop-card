import { describe, expect, it } from 'vitest';
import {
  deriveWinterizeAlerts,
  endOfSpringWindow,
  startOfSeason,
  type SprayerWinterizeInput
} from './winterizeAlert';

const NOW = new Date('2026-04-15T12:00:00Z').getTime();
const SEASON_START = startOfSeason(NOW, 'America/New_York');
const LAST_SEASON = new Date('2025-08-01T00:00:00Z').getTime();
const THIS_SEASON = new Date('2026-03-01T00:00:00Z').getTime();

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

  it('leaves out a sprayer new this season: nothing to winterize yet', () => {
    const fresh = sprayer({ id: 'new', calibrationDate: THIS_SEASON });
    const old = sprayer({ id: 'old', lastSprayedAt: THIS_SEASON });
    const out = deriveWinterizeAlerts([fresh, old], NOW, new Set(['old']));
    expect(out.map((a) => a.sprayerId)).toEqual(['old']);
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

  it('activity via decon also triggers the reminder', () => {
    expect(deriveWinterizeAlerts([sprayer({ lastDeconAt: THIS_SEASON })], NOW)).toHaveLength(1);
  });

  it('recalibrating this season clears it (#651)', () => {
    expect(
      deriveWinterizeAlerts(
        [sprayer({ lastSprayedAt: THIS_SEASON, calibrationDate: THIS_SEASON })],
        NOW
      )
    ).toHaveLength(0);
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

  it('the season starts on Jan 1 of the farm calendar', () => {
    // 04:00 UTC on Jan 1 is still Dec 31 on a Virginia farm: last season.
    const newYearsEveNy = Date.parse('2026-01-01T04:00:00Z');
    const now = Date.parse('2026-03-01T12:00:00Z');
    const s = sprayer({
      lastSprayedAt: Date.parse('2026-02-01T12:00:00Z'),
      winterizedAt: newYearsEveNy
    });
    expect(deriveWinterizeAlerts([s], now, undefined, 'America/New_York')).toHaveLength(1);
    expect(deriveWinterizeAlerts([s], now, undefined, 'UTC')).toHaveLength(0);
  });
});

describe('deriveWinterizeAlerts with prior-season last use (#651)', () => {
  const LAST_OCT = Date.parse('2025-10-10T12:00:00Z');
  const LAST_NOV = Date.parse('2025-11-15T12:00:00Z');
  const LAST_AUG = Date.parse('2025-08-01T12:00:00Z');

  it('does not flag a sprayer winterized last fall after its last use', () => {
    const s = sprayer({ lastSprayedAt: THIS_SEASON, winterizedAt: LAST_NOV });
    expect(deriveWinterizeAlerts([s], NOW, new Map([['s1', LAST_NOV]]))).toHaveLength(0);
    expect(deriveWinterizeAlerts([s], NOW, new Map([['s1', LAST_OCT]]))).toHaveLength(0);
  });

  it('flags a sprayer used again after it was winterized', () => {
    const s = sprayer({ lastSprayedAt: THIS_SEASON, winterizedAt: LAST_AUG });
    const out = deriveWinterizeAlerts([s], NOW, new Map([['s1', LAST_OCT]]));
    expect(out).toHaveLength(1);
    expect(out[0].neverWinterized).toBe(false);
  });

  it('flags a used sprayer that was never winterized', () => {
    const s = sprayer({ lastSprayedAt: THIS_SEASON });
    const out = deriveWinterizeAlerts([s], NOW, new Map([['s1', LAST_OCT]]));
    expect(out.map((a) => a.neverWinterized)).toEqual([true]);
  });

  it('is a spring reminder only: gone from July 1 on the farm calendar', () => {
    const s = sprayer({ lastSprayedAt: THIS_SEASON });
    const used = new Map([['s1', LAST_OCT]]);
    const july1 = endOfSpringWindow(startOfSeason(NOW, 'America/New_York'), 'America/New_York');
    expect(july1).toBe(Date.parse('2026-07-01T04:00:00Z'));
    expect(deriveWinterizeAlerts([s], july1 - 1, used, 'America/New_York')).toHaveLength(1);
    expect(deriveWinterizeAlerts([s], july1, used, 'America/New_York')).toHaveLength(0);
    expect(
      deriveWinterizeAlerts([s], Date.parse('2026-10-07T12:00:00Z'), used, 'America/New_York')
    ).toHaveLength(0);
  });
});
