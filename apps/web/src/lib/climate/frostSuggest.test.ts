import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  dayOfYearToMmDd,
  fallbackFrost,
  lookupFrostInDataset,
  type FrostDataset
} from './frostNormals';
import { FROST_FIELDS, suggestFrostValues } from './frostSuggest';

// Synthetic stations for exercising the helper; not real climate data.
const SYNTH: FrostDataset = {
  stations: [
    ['SYN-A', 'Synthetic A', 40, -100, 300, 100, 280, 110, 270, 80, 300, 90, 290],
    ['SYN-W', 'Synthetic Wrap', 30, -90, 5, 20, 10, 30, 5, null, null, null, null],
    [
      'SYN-F',
      'Synthetic Frost-free',
      20,
      -155,
      10,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      1
    ]
  ]
};

const dataLookup = lookupFrostInDataset(SYNTH, 40, -100);

describe('suggestFrostValues', () => {
  it('passes station dates through as data with a station label', () => {
    const s = suggestFrostValues(dataLookup);
    expect(s.values.lastFrost).toEqual({ value: dayOfYearToMmDd(100), provenance: 'data' });
    expect(s.values.firstFrost).toEqual({ value: dayOfYearToMmDd(280), provenance: 'data' });
    expect(s.values.lastHardFrost).toEqual({ value: dayOfYearToMmDd(80), provenance: 'data' });
    expect(s.values.firstHardFrost).toEqual({ value: dayOfYearToMmDd(300), provenance: 'data' });
    expect(s.sourceLabel).toBe('Synthetic A · <1 mi');
    expect(s.fallbackReason).toBeNull();
    expect(s.crossesYear).toBe(false);
  });

  it('marks an edited value manual and leaves the rest alone', () => {
    const s = suggestFrostValues(dataLookup, { lastFrost: '2026-04-20' });
    expect(s.values.lastFrost).toEqual({ value: '04-20', provenance: 'manual' });
    expect(s.values.firstFrost.provenance).toBe('data');
  });

  it('keeps provenance when the owner confirms the suggested value in any accepted form', () => {
    const suggested = dataLookup.lastFrost!;
    const [m, d] = suggested.split('-');
    for (const typed of [suggested, `2026-${suggested}`, `${Number(m)}-${Number(d)}`]) {
      expect(suggestFrostValues(dataLookup, { lastFrost: typed }).values.lastFrost).toEqual({
        value: suggested,
        provenance: 'data'
      });
    }
  });

  it('ignores blank or invalid overrides', () => {
    for (const typed of ['', '  ', '13-01', 'soon', null]) {
      expect(
        suggestFrostValues(dataLookup, { firstFrost: typed }).values.firstFrost.provenance
      ).toBe('data');
    }
  });

  it('tags the Loudoun default as fallback with a reason, and edits as manual', () => {
    const s = suggestFrostValues(fallbackFrost('no-station'));
    expect(s.values.lastFrost).toEqual({ value: '04-15', provenance: 'fallback' });
    expect(s.values.firstFrost).toEqual({ value: '10-15', provenance: 'fallback' });
    expect(s.values.lastHardFrost).toEqual({ value: null, provenance: 'fallback' });
    expect(s.fallbackReason).toMatch(/No weather station within 50 miles/);
    expect(s.sourceLabel).toBeNull();
    const edited = suggestFrostValues(fallbackFrost('no-station'), { firstFrost: '10-20' });
    expect(edited.values.firstFrost).toEqual({ value: '10-20', provenance: 'manual' });
  });

  it('explains each fallback reason', () => {
    expect(suggestFrostValues(fallbackFrost('no-location')).fallbackReason).toMatch(/location/);
    expect(suggestFrostValues(fallbackFrost('no-dataset')).fallbackReason).toMatch(/couldn't load/);
  });

  it('flags a year-crossing frost season until the owner edits it', () => {
    const wrap = lookupFrostInDataset(SYNTH, 30, -90);
    expect(suggestFrostValues(wrap).crossesYear).toBe(true);
    expect(suggestFrostValues(wrap, { lastFrost: '02-01' }).crossesYear).toBe(false);
  });

  it('reports frost-free stations with null dates', () => {
    const s = suggestFrostValues(lookupFrostInDataset(SYNTH, 20, -155));
    expect(s.frostFree).toBe(true);
    expect(s.values.lastFrost).toEqual({ value: null, provenance: 'data' });
  });

  it('any valid override is manual unless it equals the suggestion', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...FROST_FIELDS),
        fc.integer({ min: 1, max: 365 }),
        (field, doy) => {
          const typed = dayOfYearToMmDd(doy)!;
          const v = suggestFrostValues(dataLookup, { [field]: typed }).values[field];
          expect(v.value).toBe(typed);
          expect(v.provenance).toBe(typed === dataLookup[field] ? 'data' : 'manual');
        }
      )
    );
  });
});
