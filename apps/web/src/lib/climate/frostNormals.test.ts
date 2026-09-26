import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  dayOfYearToMmDd,
  fallbackFrost,
  FROST_LOOKUP_MAX_MI,
  frostStationLabel,
  haversineMi,
  loadFrostDataset,
  lookupFrostDates,
  lookupFrostInDataset,
  nearestFrostStation,
  type FrostDataset,
  type FrostStationRow
} from './frostNormals';
import { normalizeFrost } from '$lib/schedule/farmLocation';

const DATA_PATH = resolve(__dirname, 'data/frost-normals-us.json');
const DULLES = { lat: 38.9408, lon: -77.4636 };
const LEESBURG = { lat: 39.1157, lon: -77.5636 };

// Clearly synthetic stations: made-up ids and dates, used only to exercise the math.
const SYNTH: FrostDataset = {
  stations: [
    ['SYN-A', 'Synthetic A', 40, -100, 300, 100, 280, 110, 270, 80, 300, 90, 290],
    ['SYN-B', 'Synthetic B', 40.3, -100.2, 350, 105, 275, 115, 265, 85, 295, 95, 285],
    ['SYN-C', 'Synthetic C', 39.6, -99.7, null, 95, 285, null, null, null, null, null, null],
    ['SYN-D', 'Synthetic D', 20, -155, 10, null, null, null, null, null, null, null, null, 1]
  ]
};

function doyOf(mmdd: string | null): number | null {
  if (!mmdd) return null;
  const [m, d] = mmdd.split('-').map(Number);
  return Math.round((Date.UTC(2023, m - 1, d) - Date.UTC(2023, 0, 1)) / 86_400_000) + 1;
}

async function realDataset(): Promise<FrostDataset> {
  const ds = await loadFrostDataset();
  if (!ds) throw new Error('bundled frost dataset failed to load');
  return ds;
}

describe('dayOfYearToMmDd', () => {
  it('maps the boundaries of a non-leap year', () => {
    expect(dayOfYearToMmDd(1)).toBe('01-01');
    expect(dayOfYearToMmDd(59)).toBe('02-28');
    expect(dayOfYearToMmDd(60)).toBe('03-01');
    expect(dayOfYearToMmDd(105)).toBe('04-15');
    expect(dayOfYearToMmDd(365)).toBe('12-31');
  });

  it('rejects out-of-range and non-integer values', () => {
    for (const v of [0, 366, -1, 1.5, NaN, null, undefined]) {
      expect(dayOfYearToMmDd(v as number | null)).toBeNull();
    }
  });

  it('round-trips every day and stays compatible with normalizeFrost', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 365 }), (doy) => {
        const mmdd = dayOfYearToMmDd(doy)!;
        expect(doyOf(mmdd)).toBe(doy);
        expect(normalizeFrost(mmdd)).toBe(mmdd);
      })
    );
  });
});

describe('haversineMi', () => {
  it('is zero at a point and symmetric', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -80, max: 80, noNaN: true }),
        fc.double({ min: -179, max: 179, noNaN: true }),
        fc.double({ min: -80, max: 80, noNaN: true }),
        fc.double({ min: -179, max: 179, noNaN: true }),
        (a, b, c, d) => {
          expect(haversineMi(a, b, a, b)).toBeCloseTo(0, 9);
          expect(haversineMi(a, b, c, d)).toBeCloseTo(haversineMi(c, d, a, b), 6);
        }
      )
    );
  });

  it('measures Dulles to Leesburg at roughly 12 miles', () => {
    const d = haversineMi(DULLES.lat, DULLES.lon, LEESBURG.lat, LEESBURG.lon);
    expect(d).toBeGreaterThan(11);
    expect(d).toBeLessThan(14);
  });
});

describe('lookupFrostInDataset (synthetic stations)', () => {
  it('returns the station at the pin with data provenance', () => {
    const r = lookupFrostInDataset(SYNTH, 40, -100);
    expect(r.provenance).toBe('data');
    if (r.provenance !== 'data') return;
    expect(r.station.id).toBe('SYN-A');
    expect(r.station.distanceMi).toBe(0);
    expect(r.lastFrost).toBe(dayOfYearToMmDd(100));
    expect(r.firstFrost).toBe(dayOfYearToMmDd(280));
    expect(r.lastHardFrost).toBe(dayOfYearToMmDd(80));
    expect(r.firstHardFrost).toBe(dayOfYearToMmDd(300));
  });

  it('cautious reads the P10 columns', () => {
    const r = lookupFrostInDataset(SYNTH, 40, -100, { probability: 'cautious' });
    if (r.provenance !== 'data') throw new Error('expected data');
    expect(r.probability).toBe('cautious');
    expect(r.lastFrost).toBe(dayOfYearToMmDd(110));
    expect(r.firstFrost).toBe(dayOfYearToMmDd(270));
    expect(r.lastHardFrost).toBe(dayOfYearToMmDd(90));
    expect(r.firstHardFrost).toBe(dayOfYearToMmDd(290));
    expect(r.median.lastFrost).toBe(dayOfYearToMmDd(100));
  });

  it('keeps missing columns null instead of inventing a date', () => {
    const r = lookupFrostInDataset(SYNTH, 39.6, -99.7, { probability: 'cautious' });
    if (r.provenance !== 'data') throw new Error('expected data');
    expect(r.lastFrost).toBeNull();
    expect(r.lastHardFrost).toBeNull();
    expect(r.median.lastFrost).toBe(dayOfYearToMmDd(95));
    expect(r.station.elevM).toBeNull();
  });

  it('flags frost-free stations without dates', () => {
    const r = lookupFrostInDataset(SYNTH, 20.01, -155);
    if (r.provenance !== 'data') throw new Error('expected data');
    expect(r.frostFree).toBe(true);
    expect(r.lastFrost).toBeNull();
    expect(r.firstFrost).toBeNull();
  });

  it('falls back for a missing location, dataset or station', () => {
    expect(lookupFrostInDataset(SYNTH, null, -100)).toEqual(fallbackFrost('no-location'));
    expect(lookupFrostInDataset(SYNTH, 95, -100)).toEqual(fallbackFrost('no-location'));
    expect(lookupFrostInDataset(null, 40, -100)).toEqual(fallbackFrost('no-dataset'));
    expect(lookupFrostInDataset({ stations: [] }, 40, -100)).toEqual(fallbackFrost('no-dataset'));
    expect(lookupFrostInDataset(SYNTH, 0, 0)).toEqual(fallbackFrost('no-station'));
  });

  it('fallback carries the Loudoun defaults and no hard-frost dates', () => {
    const f = fallbackFrost('no-station', 'cautious');
    expect(f).toMatchObject({
      provenance: 'fallback',
      probability: 'cautious',
      lastFrost: '04-15',
      firstFrost: '10-15',
      lastHardFrost: null,
      firstHardFrost: null,
      station: null
    });
  });

  it('adds an elevation delta and can skip stations far above the pin', () => {
    const r = lookupFrostInDataset(SYNTH, 40, -100, { elevationFt: 1000 });
    if (r.provenance !== 'data') throw new Error('expected data');
    expect(r.station.elevDeltaFt).toBe(Math.round(300 * 3.28084 - 1000));
    const skipped = lookupFrostInDataset(SYNTH, 40, -100, {
      elevationFt: 5000,
      maxElevDeltaFt: 1000
    });
    expect(skipped.provenance === 'data' ? skipped.station.id : null).toBe('SYN-C');
  });

  it('labels the station with name and rounded distance', () => {
    expect(frostStationLabel({ id: 'x', name: 'Dulles', distanceMi: 6.4, elevM: 88 })).toBe(
      'Dulles · 6 mi'
    );
    expect(frostStationLabel({ id: 'x', name: 'Dulles', distanceMi: 0.2, elevM: 88 })).toBe(
      'Dulles · <1 mi'
    );
  });
});

describe('nearest-station properties (synthetic)', () => {
  const stationArb = fc.record({
    lat: fc.double({ min: 30, max: 45, noNaN: true }),
    lon: fc.double({ min: -110, max: -80, noNaN: true })
  });
  const datasetArb = fc
    .array(stationArb, { minLength: 1, maxLength: 40 })
    .map((pts): FrostDataset => ({
      stations: pts.map((p, i): FrostStationRow => [
        `SYN-${String(i).padStart(3, '0')}`,
        `Synthetic ${i}`,
        p.lat,
        p.lon,
        100,
        100,
        280,
        110,
        270,
        80,
        300,
        90,
        290
      ])
    }));
  const pointArb = fc.record({
    lat: fc.double({ min: 28, max: 47, noNaN: true }),
    lon: fc.double({ min: -112, max: -78, noNaN: true })
  });

  it('always returns the true nearest station within the cap', () => {
    fc.assert(
      fc.property(datasetArb, pointArb, (ds, p) => {
        const hit = nearestFrostStation(ds, p.lat, p.lon);
        const brute = ds.stations
          .map((s) => haversineMi(p.lat, p.lon, s[2] as number, s[3] as number))
          .filter((d) => d <= FROST_LOOKUP_MAX_MI);
        if (brute.length === 0) {
          expect(hit).toBeNull();
        } else {
          expect(hit).not.toBeNull();
          expect(hit!.distanceMi).toBeCloseTo(Math.min(...brute), 9);
        }
      })
    );
  });

  it('never falls back near a covered station', () => {
    fc.assert(
      fc.property(
        datasetArb,
        fc.nat(39),
        fc.double({ min: -0.5, max: 0.5, noNaN: true }),
        fc.double({ min: -0.5, max: 0.5, noNaN: true }),
        (ds, idx, dLat, dLon) => {
          const s = ds.stations[idx % ds.stations.length];
          const lat = (s[2] as number) + dLat;
          const lon = (s[3] as number) + dLon;
          const r = lookupFrostInDataset(ds, lat, lon);
          expect(r.provenance).toBe('data');
        }
      )
    );
  });

  it('fallback is the same everywhere and for every probability', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -60, max: -40, noNaN: true }),
        fc.double({ min: 0, max: 60, noNaN: true }),
        fc.constantFrom('median' as const, 'cautious' as const),
        (lat, lon, probability) => {
          const r = lookupFrostInDataset(SYNTH, lat, lon, { probability });
          expect(r).toEqual(fallbackFrost('no-station', probability));
          const { probability: _p, ...rest } = r;
          const { probability: _q, ...restMedian } = fallbackFrost('no-station');
          expect(rest).toEqual(restMedian);
        }
      )
    );
  });
});

describe('bundled NOAA 1991-2020 dataset', () => {
  it('pins the Dulles normals (USW00093738)', async () => {
    const r = lookupFrostInDataset(await realDataset(), DULLES.lat, DULLES.lon);
    if (r.provenance !== 'data') throw new Error('expected data');
    expect(r.station.id).toBe('USW00093738');
    expect(r.station.name).toMatch(/Dulles/);
    expect(r.median).toEqual({
      lastFrost: '04-15',
      firstFrost: '10-24',
      lastHardFrost: '03-20',
      firstHardFrost: '11-17'
    });
    expect(r.cautious.lastFrost).toBe('04-30');
    expect(r.cautious.firstFrost).toBe('10-10');
    expect(r.cautious.lastFrost).not.toBe('03-31');
    expect(r.cautious.firstFrost).not.toBe('11-05');
  });

  it('names a nearby station and lands within a week of Dulles for a Loudoun pin', async () => {
    const r = lookupFrostInDataset(await realDataset(), LEESBURG.lat, LEESBURG.lon);
    if (r.provenance !== 'data') throw new Error('expected data');
    expect(r.station.name.length).toBeGreaterThan(0);
    expect(r.station.distanceMi).toBeLessThan(15);
    expect(Math.abs(doyOf(r.lastFrost)! - doyOf('04-15')!)).toBeLessThanOrEqual(7);
    expect(Math.abs(doyOf(r.firstFrost)! - doyOf('10-24')!)).toBeLessThanOrEqual(7);
  });

  it('marks Honolulu frost-free', async () => {
    const r = lookupFrostInDataset(await realDataset(), 21.3245, -157.9251);
    if (r.provenance !== 'data') throw new Error('expected data');
    expect(r.frostFree).toBe(true);
    expect(r.lastFrost).toBeNull();
  });

  it('falls back mid-Atlantic', async () => {
    const r = lookupFrostInDataset(await realDataset(), 35, -50);
    expect(r).toEqual(fallbackFrost('no-station'));
  });

  it('cautious is never earlier than median in spring nor later in fall, for every station', async () => {
    const ds = await realDataset();
    const spring = (v: number) => (v > 243 ? v - 365 : v);
    const fall = (v: number) => (v < 182 ? v + 365 : v);
    for (const s of ds.stations) {
      const [p50s, p50f, p10s, p10f, h50s, h50f, h10s, h10f] = s.slice(5, 13) as (number | null)[];
      if (p50s !== null && p10s !== null) expect(spring(p10s)).toBeGreaterThanOrEqual(spring(p50s));
      if (p50f !== null && p10f !== null) expect(fall(p10f)).toBeLessThanOrEqual(fall(p50f));
      if (h50s !== null && h10s !== null) expect(spring(h10s)).toBeGreaterThanOrEqual(spring(h50s));
      if (h50f !== null && h10f !== null) expect(fall(h10f)).toBeLessThanOrEqual(fall(h50f));
    }
  });

  it('flags stations whose frost season crosses the new year', async () => {
    const ds = await realDataset();
    const wrapping = ds.stations.find(
      (s) => typeof s[5] === 'number' && typeof s[6] === 'number' && s[6] <= s[5]
    )!;
    const r = lookupFrostInDataset(ds, wrapping[2] as number, wrapping[3] as number);
    if (r.provenance !== 'data') throw new Error('expected data');
    expect(r.station.id).toBe(wrapping[0]);
    expect(r.crossesYear).toBe(true);
    const dulles = lookupFrostInDataset(ds, DULLES.lat, DULLES.lon);
    expect(dulles.provenance === 'data' && dulles.crossesYear).toBe(false);
  });

  it('has the expected shape and row count', async () => {
    const ds = await realDataset();
    expect(ds.version).toBe('v1.0.1 c20230404');
    expect(ds.stations.length).toBe(7094);
    const withP50 = ds.stations.filter((s) => typeof s[5] === 'number');
    const frostFree = ds.stations.filter((s) => s[13] === 1);
    expect(withP50.length).toBe(6949);
    expect(frostFree.length).toBe(145);
    const ids = new Set<string>();
    for (const s of ds.stations) {
      expect([13, 14]).toContain(s.length);
      expect(typeof s[0]).toBe('string');
      expect(typeof s[1]).toBe('string');
      expect(s[2] as number).toBeGreaterThanOrEqual(-90);
      expect(s[2] as number).toBeLessThanOrEqual(90);
      expect(s[3] as number).toBeGreaterThanOrEqual(-180);
      expect(s[3] as number).toBeLessThanOrEqual(180);
      for (const v of s.slice(5, 13)) {
        if (v !== null)
          expect(Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 365).toBe(true);
      }
      ids.add(s[0] as string);
    }
    expect(ids.size).toBe(ds.stations.length);
  });

  it('lookupFrostDates loads lazily and returns data for Dulles', async () => {
    const r = await lookupFrostDates(DULLES.lat, DULLES.lon, { probability: 'cautious' });
    expect(r.provenance).toBe('data');
    expect(r.lastFrost).toBe('04-30');
    expect(await lookupFrostDates(null, null)).toEqual(fallbackFrost('no-location'));
  });

  it('stays under 300 KB gzipped', () => {
    expect(gzipSync(readFileSync(DATA_PATH), { level: 9 }).length).toBeLessThan(300 * 1024);
  });
});

describe('bundle discipline', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  }

  it('only frostNormals.ts references the dataset, and only through dynamic import()', () => {
    const src = resolve(__dirname, '..', '..');
    const refs = walk(src).filter(
      (f) =>
        /\.(ts|js|svelte)$/.test(f) &&
        !f.endsWith('.test.ts') &&
        readFileSync(f, 'utf8').includes('frost-normals-us.json')
    );
    expect(refs.map((f) => f.slice(src.length + 1))).toEqual(['lib/climate/frostNormals.ts']);
    const body = readFileSync(refs[0], 'utf8');
    expect(body).toMatch(/import\(\s*'\.\/data\/frost-normals-us\.json'\s*\)/);
    expect(body).not.toMatch(/from\s+'\.\/data\/frost-normals-us\.json'/);
  });
});
