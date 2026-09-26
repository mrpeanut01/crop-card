import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { loadFrostDataset, type FrostDataset } from './frostNormals';
import {
  HARDINESS_ZONES,
  hardinessZoneDetail,
  hardinessZoneText,
  lookupZoneInDataset,
  parseHardinessZone,
  resolveHardinessZone,
  stationExtremeMinF,
  zoneFromExtremeMin
} from './zone';

const label = (f: number) => zoneFromExtremeMin(f)?.label;
const index = (f: number) => HARDINESS_ZONES.indexOf(label(f)!);

describe('zoneFromExtremeMin', () => {
  it.each([
    [-60, '1a'],
    [-55.01, '1a'],
    [-55, '1b'],
    [-50.01, '1b'],
    [-50, '2a'],
    [-0.01, '6b'],
    [0, '7a'],
    [4.99, '7a'],
    [5, '7b'],
    [9.99, '7b'],
    [10, '8a'],
    [3.9, '7a'],
    [-16.9, '5a'],
    [42.6, '11a'],
    [65, '13b'],
    [69.99, '13b']
  ])('%s °F is zone %s', (f, want) => {
    expect(label(f)).toBe(want);
  });

  it('clamps to the ends of the scale', () => {
    expect(label(-80)).toBe('1a');
    expect(label(70)).toBe('13b');
    expect(label(95)).toBe('13b');
  });

  it('returns null for values that are not temperatures', () => {
    expect(zoneFromExtremeMin(Number.NaN)).toBeNull();
    expect(zoneFromExtremeMin(Number.POSITIVE_INFINITY)).toBeNull();
    expect(zoneFromExtremeMin('7' as unknown as number)).toBeNull();
  });

  it('reports 5 °F band edges', () => {
    expect(zoneFromExtremeMin(3)).toEqual({ zone: 7, half: 'a', label: '7a', minF: 0, maxF: 5 });
    expect(zoneFromExtremeMin(-12)).toMatchObject({ label: '5b', minF: -15, maxF: -10 });
  });

  it('never goes down as the extreme minimum warms (property)', () => {
    const temp = fc.double({ min: -100, max: 120, noNaN: true });
    fc.assert(
      fc.property(temp, temp, (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        return index(lo) <= index(hi);
      })
    );
  });

  it('puts every in-range value inside its own band (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: -60, max: 69.999, noNaN: true }), (f) => {
        const band = zoneFromExtremeMin(f)!;
        return band.minF <= f && f < band.maxF && band.maxF - band.minF === 5;
      })
    );
  });

  it('moves one half-zone per 5 °F (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: -6000, max: 6499 }), (hundredths) => {
        const f = hundredths / 100;
        return index(f + 5) === index(f) + 1;
      })
    );
  });
});

describe('parseHardinessZone', () => {
  it('accepts the 26 zones in any case', () => {
    expect(HARDINESS_ZONES).toHaveLength(26);
    expect(HARDINESS_ZONES[0]).toBe('1a');
    expect(HARDINESS_ZONES[25]).toBe('13b');
    expect(parseHardinessZone(' 7A ')).toBe('7a');
    expect(parseHardinessZone('13b')).toBe('13b');
  });

  it.each(['', '7', '7c', '0a', '14a', 'zone 7a', null, 7])('rejects %p', (v) => {
    expect(parseHardinessZone(v)).toBeNull();
  });
});

const FIXTURE: FrostDataset = {
  stations: [
    ['NEAR', 'Near No Winter Data, VA', 39.0, -77.5, 90, 105, 297, 120, 283, 79, 321, 93, 307],
    ['MID', 'Middle Station, VA', 39.1, -77.5, 90, 105, 297, 120, 283, 79, 321, 93, 307, 0, 4.2],
    ['FAR', 'Far Station, VA', 40.5, -77.5, 90, 105, 297, 120, 283, 79, 321, 93, 307, 0, -3]
  ]
};

describe('lookupZoneInDataset', () => {
  it('uses the nearest station that has an extreme minimum', () => {
    const z = lookupZoneInDataset(FIXTURE, 39.0, -77.5)!;
    expect(z.station.id).toBe('MID');
    expect(z.band.label).toBe('7a');
    expect(z.extremeMinF).toBe(4.2);
    expect(z.station.distanceMi).toBeGreaterThan(6);
  });

  it('returns null with no station in range, no dataset or no location', () => {
    expect(lookupZoneInDataset(FIXTURE, 45, -100)).toBeNull();
    expect(lookupZoneInDataset(null, 39, -77.5)).toBeNull();
    expect(lookupZoneInDataset(FIXTURE, null, -77.5)).toBeNull();
    expect(lookupZoneInDataset({ stations: [FIXTURE.stations[0]] }, 39, -77.5)).toBeNull();
  });

  it('reads the extreme minimum column', () => {
    expect(stationExtremeMinF(FIXTURE.stations[0])).toBeNull();
    expect(stationExtremeMinF(FIXTURE.stations[2])).toBe(-3);
  });
});

describe('the bundled station table', () => {
  async function realDataset(): Promise<FrostDataset> {
    const ds = await loadFrostDataset();
    if (!ds) throw new Error('bundled frost dataset failed to load');
    return ds;
  }

  it('gives Dulles zone 7a from its own station', async () => {
    const z = lookupZoneInDataset(await realDataset(), 38.9408, -77.4636)!;
    expect(z.station.name).toMatch(/Dulles/);
    expect(z.band.label).toBe('7a');
  });

  it.each([
    ['Minneapolis', 44.8831, -93.2289, '5a'],
    ['Miami', 25.7906, -80.3164, '11a'],
    ['Seattle', 47.4444, -122.3139, '9a']
  ])('gives %s a plausible zone', async (_name, lat, lon, want) => {
    expect(lookupZoneInDataset(await realDataset(), lat, lon)?.band.label).toBe(want);
  });

  it('keeps extreme minimums in a physical range', async () => {
    const ds = await realDataset();
    const values = ds.stations.map(stationExtremeMinF).filter((v): v is number => v !== null);
    expect(values.length).toBeGreaterThan(3000);
    for (const v of values) {
      expect(v).toBeGreaterThan(-70);
      expect(v).toBeLessThan(80);
    }
  });
});

describe('resolveHardinessZone', () => {
  const lookup = lookupZoneInDataset(FIXTURE, 39.0, -77.5);

  it('shows the station estimate as data', () => {
    const v = resolveHardinessZone({ zone: null, provenance: null }, lookup)!;
    expect(v).toMatchObject({ label: '7a', provenance: 'data', stationName: 'Middle Station, VA' });
    expect(hardinessZoneText(v)).toBe('Zone 7a (approx., from Middle Station, VA)');
    expect(hardinessZoneDetail(v)).toContain('NOAA station averages, 1991-2020');
    expect(hardinessZoneText(v)).not.toMatch(/USDA/);
  });

  it('prefers the owner’s own zone as manual and keeps the estimate', () => {
    const v = resolveHardinessZone({ zone: '6b', provenance: 'manual' }, lookup)!;
    expect(v).toMatchObject({ label: '6b', provenance: 'manual', estimate: '7a' });
    expect(hardinessZoneText(v)).toBe('Zone 6b (your setting)');
    expect(hardinessZoneDetail(v)).toBe('You set this; the station estimate is 7a');
  });

  it('ignores a stored station value and bad overrides', () => {
    expect(resolveHardinessZone({ zone: '9a', provenance: 'data' }, lookup)?.label).toBe('7a');
    expect(resolveHardinessZone({ zone: 'x', provenance: 'manual' }, lookup)?.provenance).toBe(
      'data'
    );
  });

  it('is hidden when nothing is known', () => {
    expect(resolveHardinessZone({ zone: null, provenance: null }, null)).toBeNull();
    expect(resolveHardinessZone({ zone: '7a', provenance: 'manual' }, null)?.label).toBe('7a');
  });
});
