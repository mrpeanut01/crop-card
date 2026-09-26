import { describe, expect, it } from 'vitest';
import frostAdvisory from '../__fixtures__/nws-alerts-frost-advisory-garrett.json';
import freezeWarning from '../__fixtures__/nws-alerts-freeze-warning-mqt.json';
import { parseFrostAlerts, type FrostAlert } from '../nwsAlerts';
import {
  FROST_ALERT_LEAD_MS,
  frostTonightAlerts,
  isInGroundOrImminent,
  type FrostPlantingSnapshot
} from './frost';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-24T18:00:00Z');

const tomato: FrostPlantingSnapshot = {
  status: 'active',
  plantingDate: NOW - 120 * DAY,
  name: 'Cherokee Purple',
  hardiness: 'tender'
};
const kale: FrostPlantingSnapshot = {
  status: 'active',
  plantingDate: NOW - 40 * DAY,
  name: 'Lacinato kale',
  hardiness: 'half-hardy'
};

const advisory = parseFrostAlerts(frostAdvisory, NOW);

describe('frostTonightAlerts', () => {
  it('alerts once per NWS product when a tender crop is in the ground', () => {
    const alerts = frostTonightAlerts(advisory, [tomato, kale, { ...tomato }], NOW);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: 'frost-tonight',
      subjectId: 'KLWX.FR.Y.0007.2026',
      title: 'Frost Advisory · protect tender crops',
      url: '/today',
      audience: { kind: 'all' }
    });
    expect(alerts[0].body).toContain('Cherokee Purple is at risk.');
    expect(alerts[0].body).not.toContain('kale');
    expect(alerts[0].body).toContain('Frost advisory remains in effect until 9 AM EDT');
    expect(alerts[0].body).toContain('Baltimore MD/Washington DC');
  });

  it('stays quiet when only half-hardy or hardy crops are out for a frost advisory', () => {
    expect(frostTonightAlerts(advisory, [kale], NOW)).toEqual([]);
    expect(frostTonightAlerts(advisory, [], NOW)).toEqual([]);
  });

  it('a hard freeze also puts half-hardy crops at risk', () => {
    const hard: FrostAlert = { ...advisory[0], event: 'Hard Freeze Warning', productKey: 'X' };
    const [alert] = frostTonightAlerts([hard], [kale, tomato], NOW);
    expect(alert.body).toMatch(/^Lacinato kale and Cherokee Purple are at risk\./);
  });

  it('skips products whose cold starts beyond the lead window or already ended', () => {
    const later: FrostAlert = { ...advisory[0], onsetMs: NOW + FROST_ALERT_LEAD_MS + 1 };
    const ended: FrostAlert = { ...advisory[0], endsMs: NOW };
    expect(frostTonightAlerts([later, ended], [tomato], NOW)).toEqual([]);
  });

  it('works with a recorded Freeze Warning', () => {
    const now = Date.parse('2026-09-21T18:00:00Z');
    const [alert] = frostTonightAlerts(parseFrostAlerts(freezeWarning, now), [tomato], now);
    expect(alert).toMatchObject({ subjectId: 'KMQT.FZ.W.0002.2026' });
    expect(alert.body).toContain('Freeze warning in effect');
  });

  it('lists at most three crops by name', () => {
    const names = ['A', 'B', 'C', 'D', 'E'].map((name) => ({ ...tomato, name }));
    const [alert] = frostTonightAlerts(advisory, names, NOW);
    expect(alert.body).toMatch(/^A, B, C and 2 more are at risk\./);
  });
});

describe('isInGroundOrImminent', () => {
  it('counts active plantings and planned ones dated close to now', () => {
    expect(isInGroundOrImminent(tomato, NOW)).toBe(true);
    const planned = { ...tomato, status: 'planned' as const };
    expect(isInGroundOrImminent({ ...planned, plantingDate: NOW + 7 * DAY }, NOW)).toBe(true);
    expect(isInGroundOrImminent({ ...planned, plantingDate: NOW - 7 * DAY }, NOW)).toBe(true);
    expect(isInGroundOrImminent({ ...planned, plantingDate: NOW + 60 * DAY }, NOW)).toBe(false);
    expect(isInGroundOrImminent({ ...planned, plantingDate: NOW - 60 * DAY }, NOW)).toBe(false);
    expect(isInGroundOrImminent({ ...planned, plantingDate: null }, NOW)).toBe(false);
  });
});
