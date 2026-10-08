import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import {
  dateFit,
  deterministicPlantingWindow,
  formatDay,
  isValidWindow,
  plantingWindowCropOf,
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

describe('a season that crosses the new year', () => {
  const GULF: FrostDatesIso = { lastSpring: '2027-01-31', firstFall: '2028-01-06' };
  const DESERT: FrostDatesIso = { lastSpring: '2026-12-31', firstFall: '2027-12-27' };

  it('gives a Gulf-coast tomato a window after the January frost', () => {
    const w = deterministicPlantingWindow({ cropFamily: 'solanaceae', dtmMaxDays: 80 }, GULF);
    expect(w.earliest).toBe('2027-02-07');
    expect(w.latest).toBe('2027-10-04');
    expect(w.note).toMatch(/Frost-tender/);
    expect(isValidWindow(w, 2027, GULF)).toBe(true);
  });

  it('accepts a hardy window that starts in the prior year when the spring frost is in December', () => {
    const w = deterministicPlantingWindow({ cropFamily: 'leafy-green', dtmMaxDays: 50 }, DESERT);
    expect(w.earliest).toBe('2026-12-17');
    expect(isValidWindow(w, 2027)).toBe(false);
    expect(isValidWindow(w, 2027, DESERT)).toBe(true);
  });

  it('never stretches the check past the season for an ordinary year', () => {
    const w = { earliest: '2027-03-01', prime: '2027-04-01', latest: '2028-01-02', note: null };
    expect(isValidWindow(w, 2027, LOUDOUN)).toBe(false);
    expect(isValidWindow(w, 2027, GULF)).toBe(true);
  });
});

describe('deterministicPlantingWindow frostFree (Phase 32E)', () => {
  it('ignores hardiness in a heated greenhouse', () => {
    const w = deterministicPlantingWindow(
      { cropFamily: 'solanaceae', soilTempMinF: 70, dtmMaxDays: 80 },
      { lastSpring: '2027-01-01', firstFall: '2027-12-31', frostFree: true }
    );
    expect(w.earliest).toBe('2027-01-01');
    expect(w.latest).toBe('2027-09-28');
    expect(w.note).toBe('No frost limit for this bed.');
  });
  it('is unchanged with frostFree false', () => {
    const f = { lastSpring: '2027-04-20', firstFall: '2027-10-15' };
    expect(
      deterministicPlantingWindow({ cropFamily: 'brassica' }, { ...f, frostFree: false })
    ).toEqual(deterministicPlantingWindow({ cropFamily: 'brassica' }, f));
  });
});

describe('dateFit in the typed date own year (#646)', () => {
  const w = { earliest: '2027-03-05', prime: '2027-03-19', latest: '2027-08-17', note: null };

  it('judges an earlier or later year by month and day', () => {
    expect(dateFit('2019-04-10', w)).toBe('ok');
    expect(dateFit('2019-02-10', w)).toBe('early');
    expect(dateFit('2019-09-10', w)).toBe('late');
    expect(dateFit('2031-06-01', w)).toBe('ok');
  });

  it('keeps a window that crosses the new year whole in every year', () => {
    const fall = { earliest: '2026-12-01', prime: '2027-01-10', latest: '2027-03-01', note: null };
    expect(dateFit('2020-12-15', fall)).toBe('ok');
    expect(dateFit('2021-02-01', fall)).toBe('ok');
    expect(dateFit('2021-04-01', fall)).toBe('late');
    expect(dateFit('2027-12-15', fall)).toBe('ok');
  });

  it('agrees with the plain comparison in the window year', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 364 }), (d) => {
        const iso = new Date(Date.UTC(2027, 0, 1) + d * 86_400_000).toISOString().slice(0, 10);
        const plain = iso < w.earliest ? 'early' : iso > w.latest ? 'late' : 'ok';
        expect(dateFit(iso, w)).toBe(plain);
      })
    );
  });
});

function plugin(id: string): CropPlugin {
  const root = process.env.PLUGINS_DIR ?? resolve(process.cwd(), '../../plugins');
  return JSON.parse(readFileSync(resolve(root, 'crops', `${id}.json`), 'utf8')) as CropPlugin;
}

describe('perennial planting window (#672)', () => {
  it.each([
    'peach-redhaven',
    'blueberry-bluecrop',
    'grape-concord',
    'strawberry-jewel',
    'apple-honeycrisp',
    'asparagus-jersey-knight',
    'alfalfa-vernema'
  ])('%s gets a window, never a one-day tight fit', (id) => {
    const facts = plantingWindowCropOf(plugin(id));
    expect(facts.perennial).toBe(true);
    expect(facts.dtmMaxDays).toBeNull();
    const w = deterministicPlantingWindow(facts, LOUDOUN);
    expect(w.earliest < w.latest).toBe(true);
    expect(w.note).toMatch(/perennial/);
    expect(w.note).not.toMatch(/Tight fit/);
  });

  it('ignores years to a first crop even when they are passed in', () => {
    const w = deterministicPlantingWindow(
      { cropFamily: 'stone-fruit', dtmMaxDays: 1460, perennial: true },
      LOUDOUN
    );
    expect(w.latest > w.earliest).toBe(true);
    expect(
      deterministicPlantingWindow({ cropFamily: 'stone-fruit', dtmMaxDays: 1460 }, LOUDOUN).note
    ).toMatch(/Tight fit/);
  });

  it('leaves an annual unchanged', () => {
    const facts = plantingWindowCropOf(plugin('tomato-amish-paste'));
    expect(facts.perennial).toBe(false);
    expect(facts.dtmMaxDays).not.toBeNull();
  });

  it('says it in Spanish', () => {
    const w = deterministicPlantingWindow(
      plantingWindowCropOf(plugin('peach-redhaven')),
      LOUDOUN,
      'es'
    );
    expect(w.note).toMatch(/perenne/);
  });
});
