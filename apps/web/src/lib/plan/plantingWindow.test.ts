import { describe, expect, it } from 'vitest';
import {
  dateFit,
  deterministicPlantingWindow,
  formatDay,
  isValidWindow,
  type FrostDatesIso
} from './plantingWindow';

const LOUDOUN: FrostDatesIso = { lastSpring: '2027-04-15', firstFall: '2027-10-15' };

describe('deterministicPlantingWindow', () => {
  it('puts a tender crop after the last frost', () => {
    const w = deterministicPlantingWindow({ cropFamily: 'solanaceae', dtmMaxDays: 80 }, LOUDOUN);
    expect(w.earliest).toBe('2027-04-22');
    expect(w.prime).toBe('2027-04-29');
    expect(w.latest).toBe('2027-07-13');
    expect(w.note).toMatch(/Frost-tender/);
  });

  it('puts a hardy crop weeks before the last frost', () => {
    const w = deterministicPlantingWindow({ cropFamily: 'allium', dtmMaxDays: 100 }, LOUDOUN);
    expect(w.earliest).toBe('2027-03-04');
    expect(w.prime).toBe('2027-03-18');
    expect(w.earliest < w.prime).toBe(true);
  });

  it('lets soilTempMinF override the family default', () => {
    const w = deterministicPlantingWindow(
      { cropFamily: 'allium', soilTempMinF: 70, dtmMaxDays: 60 },
      LOUDOUN
    );
    expect(w.earliest).toBe('2027-04-22');
  });

  it('falls back to a hardiness DTM when the plugin has none', () => {
    const w = deterministicPlantingWindow({ cropFamily: 'corn' }, LOUDOUN);
    expect(w.latest).toBe('2027-07-18');
  });

  it('collapses to one date with a note when the season is too short', () => {
    const w = deterministicPlantingWindow(
      { cropFamily: 'cucurbit', dtmMaxDays: 200 },
      { lastSpring: '2027-05-20', firstFall: '2027-09-20' }
    );
    expect(w.earliest).toBe(w.prime);
    expect(w.prime).toBe(w.latest);
    expect(w.note).toMatch(/Tight fit/);
  });

  it('always produces an ordered, valid window', () => {
    const families = ['corn', 'brassica', 'root', 'leafy-green', 'unknown', null];
    for (const cropFamily of families) {
      for (const dtmMaxDays of [20, 60, 120, 180, null]) {
        const w = deterministicPlantingWindow({ cropFamily, dtmMaxDays }, LOUDOUN);
        expect(isValidWindow(w, 2027)).toBe(true);
      }
    }
  });
});

describe('isValidWindow', () => {
  const ok = { earliest: '2027-04-01', prime: '2027-04-10', latest: '2027-06-01', note: null };

  it('accepts an ordered window in the year', () => {
    expect(isValidWindow(ok, 2027)).toBe(true);
  });

  it('rejects out-of-order, malformed or wrong-year dates', () => {
    expect(isValidWindow({ ...ok, prime: '2027-03-01' }, 2027)).toBe(false);
    expect(isValidWindow({ ...ok, earliest: 'April 1' }, 2027)).toBe(false);
    expect(isValidWindow({ ...ok, latest: '2028-01-05' }, 2027)).toBe(false);
    expect(isValidWindow({ ...ok, note: 5 }, 2027)).toBe(false);
    expect(isValidWindow(null, 2027)).toBe(false);
  });
});

describe('dateFit + formatDay', () => {
  const w = { earliest: '2027-04-01', prime: '2027-04-10', latest: '2027-06-01', note: null };

  it('classifies a date against the window', () => {
    expect(dateFit('2027-03-20', w)).toBe('early');
    expect(dateFit('2027-05-01', w)).toBe('ok');
    expect(dateFit('2027-07-01', w)).toBe('late');
    expect(dateFit('', w)).toBe(null);
  });

  it('formats a day without shifting it by time zone', () => {
    expect(formatDay('2027-04-01')).toBe('Apr 1');
  });
});
