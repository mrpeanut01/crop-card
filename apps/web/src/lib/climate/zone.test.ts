import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FrostDataset } from './frostNormals';
import {
  farmZoneFrom,
  lookupZone,
  lookupZoneInDataset,
  parseZone,
  zoneFromExtremeMin,
  zoneSourceDetail,
  zoneValueLabel,
  ZONE_CEILING_F,
  ZONE_FLOOR_F
} from './zone';

const DULLES = { lat: 38.9408, lon: -77.4636 };
const LEESBURG = { lat: 39.1157, lon: -77.5636 };

// Clearly synthetic stations: made-up ids and values, used only to exercise the lookup.
const nulls = [null, null, null, null, null, null, null, null] as const;
const SYNTH: FrostDataset = {
  stations: [
    ['SYN-NEAR', 'Synthetic Near', 40, -100, 300, ...nulls, 0],
    ['SYN-MID', 'Synthetic Mid', 40.2, -100, 300, ...nulls, 0, -12.4],
    ['SYN-FAR', 'Synthetic Far', 41.5, -100, 300, ...nulls, 0, 3.2],
    ['SYN-OUT', 'Synthetic Out', 45, -100, 300, ...nulls, 0, 30]
  ]
};

describe('zoneFromExtremeMin', () => {
  it.each([
    [-60, '1a', -60, -55],
    [-55.1, '1a', -60, -55],
    [-55, '1b', -55, -50],
    [-0.1, '6b', -5, 0],
    [0, '7a', 0, 5],
    [4.9, '7a', 0, 5],
    [5, '7b', 5, 10],
    [9.94, '7b', 5, 10],
    [9.96, '8a', 10, 15],
    [-5e-324, '7a', 0, 5],
    [10, '8a', 10, 15],
    [64.9, '13a', 60, 65],
    [65, '13b', 65, 70],
    [69.9, '13b', 65, 70]
  ])('%s °F → %s', (f, zone, minF, maxF) => {
    expect(zoneFromExtremeMin(f)).toMatchObject({ zone, minF, maxF });
  });

  it('clamps beyond the published range to 1a and 13b', () => {
    expect(zoneFromExtremeMin(-80)?.zone).toBe('1a');
    expect(zoneFromExtremeMin(70)?.zone).toBe('13b');
    expect(zoneFromExtremeMin(95)?.zone).toBe('13b');
  });

  it('returns null for missing or non-finite input', () => {
    for (const v of [null, undefined, NaN, Infinity, -Infinity]) {
      expect(zoneFromExtremeMin(v)).toBeNull();
    }
  });

  it('agrees with the zone bounds for every temperature in range', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: ZONE_FLOOR_F * 10, max: ZONE_CEILING_F * 10 - 1 }).map((t) => t / 10),
        (f) => {
          const z = zoneFromExtremeMin(f)!;
          expect(f).toBeGreaterThanOrEqual(z.minF);
          expect(f).toBeLessThan(z.maxF);
          expect(z.maxF - z.minF).toBe(5);
          expect(z.number).toBe(Math.floor((z.minF + 60) / 10) + 1);
          expect(z.zone).toBe(`${z.number}${z.half}`);
        }
      )
    );
  });

  it('never gets warmer as the extreme minimum gets colder', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -100, max: 100, noNaN: true }),
        fc.double({ min: 0, max: 50, noNaN: true }),
        (f, d) => {
          expect(zoneFromExtremeMin(f - d)!.minF).toBeLessThanOrEqual(zoneFromExtremeMin(f)!.minF);
        }
      )
    );
  });
});

describe('parseZone', () => {
  it('normalizes what an owner types', () => {
    expect(parseZone('7a')).toBe('7a');
    expect(parseZone(' 7B ')).toBe('7b');
    expect(parseZone('Zone 6b')).toBe('6b');
    expect(parseZone('zone10a')).toBe('10a');
    expect(parseZone('13b')).toBe('13b');
  });

  it('rejects anything that is not a half-zone', () => {
    for (const v of ['', '7', '0a', '14a', '7c', 'a7', '7 a b', 'seven', null, 7, undefined]) {
      expect(parseZone(v)).toBeNull();
    }
  });
});

describe('lookupZoneInDataset (synthetic stations)', () => {
  it('skips the nearest station when it has no extreme minimum', () => {
    const r = lookupZoneInDataset(SYNTH, 40, -100);
    expect(r?.station.id).toBe('SYN-MID');
    expect(r?.extremeMinF).toBe(-12.4);
    expect(r?.zone.zone).toBe('5b');
    expect(r?.provenance).toBe('data');
  });

  it('returns null with no station in range, no location or no dataset', () => {
    expect(lookupZoneInDataset(SYNTH, 0, 0)).toBeNull();
    expect(lookupZoneInDataset(SYNTH, 40, -100, { maxDistanceMi: 5 })).toBeNull();
    expect(lookupZoneInDataset(SYNTH, null, -100)).toBeNull();
    expect(lookupZoneInDataset(null, 40, -100)).toBeNull();
    expect(lookupZoneInDataset({ stations: [] }, 40, -100)).toBeNull();
  });
});

describe('farm zone display', () => {
  const lookup = lookupZoneInDataset(SYNTH, 40, -100);

  it('prefers the owner-typed zone and tags it manual', () => {
    const z = farmZoneFrom('Zone 6A', lookup)!;
    expect(z).toEqual({
      zone: '6a',
      provenance: 'manual',
      stationName: null,
      distanceMi: null,
      extremeMinF: null
    });
    expect(zoneValueLabel(z)).toBe('Zone 6a');
    expect(zoneSourceDetail(z)).toBe('your zone');
  });

  it('labels a station estimate as approximate and names the station', () => {
    const z = farmZoneFrom(null, lookup)!;
    expect(z.provenance).toBe('data');
    expect(zoneValueLabel(z)).toBe('Zone 5b (approx.)');
    expect(zoneSourceDetail(z)).toBe('from Synthetic Mid · 14 mi');
    expect(zoneValueLabel(z)).not.toMatch(/usda/i);
  });

  it('ignores a malformed saved zone and has no fallback zone', () => {
    expect(farmZoneFrom('banana', lookup)?.provenance).toBe('data');
    expect(farmZoneFrom(null, null)).toBeNull();
    expect(farmZoneFrom('', null)).toBeNull();
  });
});

describe('bundled NOAA dataset', () => {
  const ds = JSON.parse(
    readFileSync(resolve(__dirname, 'data/frost-normals-us.json'), 'utf8')
  ) as FrostDataset;

  it('puts Dulles in zone 7a from its own station', () => {
    const r = lookupZoneInDataset(ds, DULLES.lat, DULLES.lon)!;
    expect(r.station.id).toBe('USW00093738');
    expect(r.zone.zone).toBe('7a');
    expect(r.extremeMinF).toBeGreaterThanOrEqual(0);
    expect(r.extremeMinF).toBeLessThan(5);
  });

  it('gives a Loudoun pin a zone 6b-7b estimate from a nearby station', async () => {
    const r = (await lookupZone(LEESBURG.lat, LEESBURG.lon))!;
    expect(['6b', '7a', '7b']).toContain(r.zone.zone);
    expect(r.station.distanceMi).toBeLessThan(25);
  });

  it('lands well-known climates in the right broad band', () => {
    const at = (lat: number, lon: number) => lookupZoneInDataset(ds, lat, lon)!.zone.number;
    expect(at(64.8031, -147.8761)).toBeLessThanOrEqual(2);
    expect(at(44.8831, -93.2289)).toBeGreaterThanOrEqual(4);
    expect(at(44.8831, -93.2289)).toBeLessThanOrEqual(5);
    expect(at(25.7881, -80.3169)).toBeGreaterThanOrEqual(10);
    expect(at(21.3245, -157.9251)).toBeGreaterThanOrEqual(12);
  });

  it('has no fallback zone mid-ocean', async () => {
    expect(await lookupZone(35, -50)).toBeNull();
  });
});
