import { describe, expect, it } from 'vitest';
import { fallbackFrost, lookupFrostInDataset, type FrostDataset } from './frostNormals';
import { suggestFrostValues } from './frostSuggest';
import {
  EMPTY_FROST_PROVENANCE,
  frostConfirmReason,
  parseFrostProvenance,
  planFrostSave,
  readFrostOverride,
  storedFrostView,
  suggestFromStored
} from './frostSettings';

const DATASET: FrostDataset = {
  stations: [
    ['DULLES', 'Dulles Intl AP, VA', 38.935, -77.447, 88, 105, 297, 120, 283, 79, 321, 94, 305],
    [
      'KEYWEST',
      'Key West Intl AP, FL',
      24.55,
      -81.75,
      1,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      1
    ],
    ['ODD', 'Odd Station, AK', 64, -150, 100, 300, 20, 310, 15, null, null, null, null]
  ]
};

const dulles = lookupFrostInDataset(DATASET, 39.0, -77.5);
const keyWest = lookupFrostInDataset(DATASET, 24.56, -81.76);
const odd = lookupFrostInDataset(DATASET, 64.01, -150.01);

describe('parseFrostProvenance', () => {
  it('round-trips a saved shape and drops junk', () => {
    const raw = JSON.stringify({
      values: { lastFrost: 'data', firstFrost: 'bogus', lastHardFrost: 'manual' },
      source: 'Dulles · 6 mi',
      probability: 'cautious'
    });
    expect(parseFrostProvenance(raw)).toEqual({
      values: { lastFrost: 'data', lastHardFrost: 'manual' },
      source: 'Dulles · 6 mi',
      probability: 'cautious'
    });
    expect(parseFrostProvenance('not json')).toEqual(EMPTY_FROST_PROVENANCE);
    expect(parseFrostProvenance(undefined)).toEqual(EMPTY_FROST_PROVENANCE);
  });
});

describe('planFrostSave from a station lookup', () => {
  it('saves station dates with data provenance and the station label', () => {
    const s = suggestFrostValues(dulles);
    expect(frostConfirmReason(s)).toBeNull();
    const r = planFrostSave(s, { confirmed: false, probability: 'median' });
    expect(r).toEqual({
      ok: true,
      plan: {
        set: {
          lastFrost: '04-15',
          firstFrost: '10-24',
          lastHardFrost: '03-20',
          firstHardFrost: '11-17'
        },
        clear: [],
        provenance: {
          values: {
            lastFrost: 'data',
            firstFrost: 'data',
            lastHardFrost: 'data',
            firstHardFrost: 'data'
          },
          source: s.sourceLabel,
          probability: 'median'
        }
      }
    });
  });

  it('marks an edited date manual', () => {
    const s = suggestFrostValues(dulles, { lastFrost: '4/25' });
    const r = planFrostSave(s, { confirmed: false, probability: 'median' });
    expect(r.ok && r.plan?.set.lastFrost).toBe('04-25');
    expect(r.ok && r.plan?.provenance.values.lastFrost).toBe('manual');
    expect(r.ok && r.plan?.provenance.values.firstFrost).toBe('data');
  });

  it('refuses unreadable input', () => {
    const r = planFrostSave(suggestFrostValues(dulles, { firstFrost: 'soon' }), {
      confirmed: true,
      probability: 'median'
    });
    expect(r.ok).toBe(false);
  });

  it('asks before saving Loudoun fallback dates, then saves them labelled fallback', () => {
    const s = suggestFrostValues(fallbackFrost('no-station'));
    expect(frostConfirmReason(s)).toBe('fallback');
    expect(planFrostSave(s, { confirmed: false, probability: 'median' })).toMatchObject({
      ok: false,
      reason: 'fallback'
    });
    const r = planFrostSave(s, { confirmed: true, probability: 'median' });
    expect(r).toMatchObject({
      ok: true,
      plan: {
        set: { lastFrost: '04-15', firstFrost: '10-15' },
        clear: ['lastHardFrost', 'firstHardFrost'],
        provenance: { source: null, probability: null }
      }
    });
  });

  it('never saves an empty spring or fall date for a frost-free station', () => {
    const s = suggestFrostValues(keyWest);
    expect(s.frostFree).toBe(true);
    expect(frostConfirmReason(s)).toBe('frost-free');
    expect(planFrostSave(s, { confirmed: false, probability: 'median' }).ok).toBe(false);
    const r = planFrostSave(s, { confirmed: true, probability: 'median' });
    expect(r.ok && r.plan?.set).toEqual({ lastFrost: '04-15', firstFrost: '10-15' });
    expect(r.ok && r.plan?.provenance.values.lastFrost).toBe('fallback');
  });

  it('accepts typed dates at a frost-free station without asking', () => {
    const s = suggestFrostValues(keyWest, { lastFrost: '01-20', firstFrost: '12-20' });
    expect(frostConfirmReason(s)).toBeNull();
    const r = planFrostSave(s, { confirmed: false, probability: 'median' });
    expect(r.ok && r.plan?.provenance.values.lastFrost).toBe('manual');
  });

  it('saves a frost season that crosses the new year without asking', () => {
    const s = suggestFrostValues(odd);
    expect(s.crossesYear).toBe(true);
    expect(frostConfirmReason(s)).toBeNull();
    const r = planFrostSave(s, { confirmed: false, probability: 'median' });
    expect(r.ok && r.plan?.provenance.values.lastFrost).toBe('data');
  });

  it('still asks to confirm a fallback lookup', () => {
    const s = suggestFrostValues(fallbackFrost('no-station'));
    expect(frostConfirmReason(s)).toBe('fallback');
    expect(planFrostSave(s, { confirmed: false, probability: 'median' }).ok).toBe(false);
  });

  it('asks when the owner clears a date', () => {
    const s = suggestFrostValues(dulles, { firstFrost: '' });
    expect(frostConfirmReason(s)).toBe('missing');
  });
});

describe('suggestFromStored', () => {
  it('shows missing spring and fall dates as Loudoun fallback and typed legacy dates as manual', () => {
    const view = storedFrostView(
      { lastFrost: '04-20', firstFrost: null, lastHardFrost: null, firstHardFrost: null },
      EMPTY_FROST_PROVENANCE
    );
    expect(view.lastFrost).toEqual({ value: '04-20', provenance: 'manual' });
    expect(view.firstFrost).toEqual({ value: '10-15', provenance: 'fallback' });
    expect(view.lastHardFrost.value).toBeNull();
  });

  it('keeps provenance for unchanged values and flips changes to manual', () => {
    const view = storedFrostView(
      { lastFrost: '04-15', firstFrost: '10-24', lastHardFrost: '03-20', firstHardFrost: null },
      parseFrostProvenance(
        JSON.stringify({
          values: { lastFrost: 'data', firstFrost: 'data', lastHardFrost: 'data' },
          source: 'Dulles',
          probability: 'median'
        })
      )
    );
    const s = suggestFromStored(view, { lastFrost: '04-15', firstFrost: '10-30' }, 'Dulles');
    expect(s.values.lastFrost).toBe(view.lastFrost);
    expect(s.values.firstFrost).toEqual({ value: '10-30', provenance: 'manual' });
    const r = planFrostSave(s, { confirmed: false, probability: 'median' });
    expect(r.ok && r.plan?.provenance.source).toBe('Dulles');
  });
});

describe('frostConfirmReason on the stored path', () => {
  it('never asks to confirm a station-search fallback that no search produced', () => {
    const view = storedFrostView(
      { lastFrost: null, firstFrost: null, lastHardFrost: null, firstHardFrost: null },
      EMPTY_FROST_PROVENANCE
    );
    const untouched = suggestFromStored(view, {}, null);
    expect(frostConfirmReason(untouched)).toBeNull();
    const hardOnly = suggestFromStored(view, { lastHardFrost: '03-30' }, null);
    expect(frostConfirmReason(hardOnly)).toBeNull();
    const r = planFrostSave(hardOnly, { confirmed: false, probability: null });
    expect(r.ok && r.plan?.provenance.values).toMatchObject({
      lastFrost: 'fallback',
      firstFrost: 'fallback',
      lastHardFrost: 'manual'
    });
  });

  it('still asks when a stored spring or fall date is cleared', () => {
    const view = storedFrostView(
      { lastFrost: '04-20', firstFrost: '10-20', lastHardFrost: null, firstHardFrost: null },
      EMPTY_FROST_PROVENANCE
    );
    expect(frostConfirmReason(suggestFromStored(view, { lastFrost: '' }, null))).toBe('missing');
  });
});

describe('readFrostOverride', () => {
  it('only includes fields present in the form', () => {
    const fd = new FormData();
    fd.set('lastFrost', '04-10');
    expect(readFrostOverride((n) => fd.get(n))).toEqual({ lastFrost: '04-10' });
  });
});
