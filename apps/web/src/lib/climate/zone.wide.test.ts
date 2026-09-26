import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { haversineMi, type FrostDataset, type FrostStationRow } from './frostNormals';
import {
  farmZoneFrom,
  lookupZoneInDataset,
  stationElevDeltaFt,
  validElevationFt,
  zoneCardValue,
  zoneEstimateLong,
  zoneReachNote,
  zoneSourceDetail,
  zoneValueLabel,
  ZONE_ESTIMATE_LONG,
  ZONE_ESTIMATE_WIDE_LONG,
  ZONE_MAX_ELEV_DELTA_FT,
  ZONE_NEAR_MAX_MI,
  ZONE_WIDE_MAX_MI
} from './zone';

// Clearly synthetic stations on the -100 meridian north of a farm at (40, -100);
// one degree of latitude is about 69 mi. Elevations are metres, as NOAA stores them.
const nulls = [null, null, null, null, null, null, null, null] as const;
const FT_PER_M = 3.28084;
const FARM = { lat: 40, lon: -100 };
const HIGH_M = 1000;

function station(
  id: string,
  lat: number,
  elevM: number | null,
  extremeMinF: number | null
): FrostStationRow {
  return [id, `Synthetic ${id}`, lat, -100, elevM, ...nulls, 0, extremeMinF];
}

describe('lookupZoneInDataset: elevation guard and wide pass', () => {
  const DS: FrostDataset = {
    stations: [
      station('W-HIGH', 40.2, HIGH_M, -20),
      station('W-NOELEV', 41.0, null, -5),
      station('W-OK', 41.2, 0, 12),
      station('W-OUT', 41.6, 0, 30)
    ]
  };

  it('with no farm elevation, runs only the unguarded 50-mile pass, as before', () => {
    const r = lookupZoneInDataset(DS, FARM.lat, FARM.lon)!;
    expect(r.station.id).toBe('W-HIGH');
    expect(r.reach).toBe('near');
    expect(r.station.elevDeltaFt).toBeUndefined();
    const farOnly: FrostDataset = { stations: [station('W-OK', 41.2, 0, 12)] };
    expect(lookupZoneInDataset(farOnly, FARM.lat, FARM.lon)).toBeNull();
    expect(lookupZoneInDataset(farOnly, FARM.lat, FARM.lon, { elevationFt: null })).toBeNull();
  });

  it('skips a near station far above the farm and reaches out for a similar one', () => {
    const r = lookupZoneInDataset(DS, FARM.lat, FARM.lon, { elevationFt: 0 })!;
    expect(r.station.id).toBe('W-OK');
    expect(r.reach).toBe('wide');
    expect(r.zone.zone).toBe('8a');
    expect(r.station.distanceMi).toBeGreaterThan(ZONE_NEAR_MAX_MI);
    expect(r.station.distanceMi).toBeLessThanOrEqual(ZONE_WIDE_MAX_MI);
    expect(r.station.elevDeltaFt).toBe(0);
  });

  it('keeps the near station when the farm sits near its elevation', () => {
    const r = lookupZoneInDataset(DS, FARM.lat, FARM.lon, {
      elevationFt: HIGH_M * FT_PER_M - 200
    })!;
    expect(r.station.id).toBe('W-HIGH');
    expect(r.reach).toBe('near');
    expect(r.station.elevDeltaFt).toBe(200);
  });

  it('accepts a near station with no recorded elevation, but never in the wide pass', () => {
    const near: FrostDataset = { stations: [station('N-NOELEV', 40.5, null, 0)] };
    expect(lookupZoneInDataset(near, FARM.lat, FARM.lon, { elevationFt: 9000 })?.reach).toBe(
      'near'
    );
    const far: FrostDataset = { stations: [station('F-NOELEV', 41.0, null, 0)] };
    expect(lookupZoneInDataset(far, FARM.lat, FARM.lon, { elevationFt: 0 })).toBeNull();
  });

  it('draws the elevation band at exactly 1,000 ft either way, in both passes', () => {
    expect(ZONE_MAX_ELEV_DELTA_FT).toBe(1000);
    const wideOnly: FrostDataset = { stations: [station('B', 41.2, 0, 12)] };
    const wideAt = (ft: number) =>
      lookupZoneInDataset(wideOnly, FARM.lat, FARM.lon, { elevationFt: ft });
    expect(wideAt(1000)?.station.id).toBe('B');
    expect(wideAt(-1000)?.station.id).toBe('B');
    expect(wideAt(1000.01)).toBeNull();
    expect(wideAt(-1000.01)).toBeNull();

    const both: FrostDataset = {
      stations: [station('NB', 40.3, 0, 12), station('WB', 41.2, 500, 20)]
    };
    const bothAt = (ft: number) =>
      lookupZoneInDataset(both, FARM.lat, FARM.lon, { elevationFt: ft });
    expect(bothAt(1000)).toMatchObject({ reach: 'near', station: { id: 'NB' } });
    expect(bothAt(1000.5)).toMatchObject({ reach: 'wide', station: { id: 'WB' } });
  });

  it('stops at 100 miles and has no fallback zone', () => {
    const out: FrostDataset = { stations: [station('W-OUT', 41.6, 0, 30)] };
    expect(lookupZoneInDataset(out, FARM.lat, FARM.lon, { elevationFt: 0 })).toBeNull();
    expect(lookupZoneInDataset(null, FARM.lat, FARM.lon, { elevationFt: 0 })).toBeNull();
    expect(lookupZoneInDataset(DS, null, FARM.lon, { elevationFt: 0 })).toBeNull();
  });

  it('treats an implausible farm elevation as unknown', () => {
    for (const ft of [NaN, Infinity, 50_000, -5_000]) {
      const r = lookupZoneInDataset(DS, FARM.lat, FARM.lon, { elevationFt: ft })!;
      expect(r.station.id).toBe('W-HIGH');
      expect(r.reach).toBe('near');
    }
    expect(validElevationFt(-282)).toBe(-282);
    expect(validElevationFt(20_310)).toBe(20_310);
    expect(validElevationFt('812')).toBeNull();
  });

  it('measures station minus farm elevation in feet', () => {
    expect(stationElevDeltaFt(station('X', 40, 100, 0), 0)).toBeCloseTo(328.084, 3);
    expect(stationElevDeltaFt(station('X', 40, null, 0), 0)).toBeNull();
    expect(stationElevDeltaFt(station('X', 40, 100, 0), null)).toBeNull();
  });

  it('matches a brute-force search over random stations and elevations', () => {
    const arbStation = fc.record({
      dLat: fc.double({ min: -1.6, max: 1.6, noNaN: true }),
      dLon: fc.double({ min: -2, max: 2, noNaN: true }),
      elevM: fc.option(fc.integer({ min: -50, max: 3500 }), { nil: null }),
      extremeMinF: fc.option(
        fc.integer({ min: -400, max: 500 }).map((t) => t / 10),
        { nil: null }
      )
    });
    fc.assert(
      fc.property(
        fc.array(arbStation, { maxLength: 12 }),
        fc.option(fc.integer({ min: -100, max: 12_000 }), { nil: null }),
        (specs, farmFt) => {
          const rows: FrostStationRow[] = specs.map((s, i) => [
            `R${String(i).padStart(2, '0')}`,
            `R${i}`,
            FARM.lat + s.dLat,
            FARM.lon + s.dLon,
            s.elevM,
            ...nulls,
            0,
            s.extremeMinF
          ]);
          const got = lookupZoneInDataset({ stations: rows }, FARM.lat, FARM.lon, {
            elevationFt: farmFt
          });

          const dist = (r: FrostStationRow) =>
            haversineMi(FARM.lat, FARM.lon, r[2] as number, r[3] as number);
          const delta = (r: FrostStationRow) =>
            farmFt === null || r[4] === null ? null : (r[4] as number) * FT_PER_M - farmFt;
          const best = (cands: FrostStationRow[]) =>
            cands.sort(
              (a, b) => dist(a) - dist(b) || String(a[0]).localeCompare(String(b[0]))
            )[0] ?? null;
          const withMin = rows.filter((r) => r[14] !== null);
          const near = best(
            withMin.filter((r) => {
              const d = delta(r);
              return dist(r) <= ZONE_NEAR_MAX_MI && (d === null || Math.abs(d) <= 1000);
            })
          );
          const wide =
            near || farmFt === null
              ? null
              : best(
                  withMin.filter((r) => {
                    const d = delta(r);
                    return dist(r) <= ZONE_WIDE_MAX_MI && d !== null && Math.abs(d) <= 1000;
                  })
                );
          const want = near ?? wide;

          expect(got?.station.id ?? null).toBe(want ? String(want[0]) : null);
          if (!got) return;
          expect(got.reach).toBe(near ? 'near' : 'wide');
          expect(got.station.distanceMi).toBeLessThanOrEqual(ZONE_WIDE_MAX_MI + 0.05);
          if (farmFt === null) expect(got.reach).toBe('near');
          if (got.reach === 'wide') {
            expect(got.station.distanceMi).toBeGreaterThan(ZONE_NEAR_MAX_MI - 0.05);
            expect(got.station.elevDeltaFt).toBeDefined();
          }
          if (got.station.elevDeltaFt !== undefined) {
            expect(Math.abs(got.station.elevDeltaFt)).toBeLessThanOrEqual(1001);
          }
        }
      ),
      { numRuns: 300 }
    );
  });
});

describe('farm zone display for a wide estimate', () => {
  const DS: FrostDataset = {
    stations: [station('W-HIGH', 40.2, HIGH_M, -20), station('W-OK', 41.2, 0, 12)]
  };
  const wide = lookupZoneInDataset(DS, FARM.lat, FARM.lon, { elevationFt: 150 });
  const near = lookupZoneInDataset(DS, FARM.lat, FARM.lon);

  it('shows the distance and a similar-elevation note, with data provenance naming the station', () => {
    const z = farmZoneFrom(null, wide)!;
    expect(z).toMatchObject({ zone: '8a', provenance: 'data', reach: 'wide', elevDeltaFt: -150 });
    expect(zoneValueLabel(z)).toBe('Zone 8a (approx.)');
    expect(zoneReachNote(z)).toBe('nearest station 83 mi, similar elevation');
    expect(zoneSourceDetail(z)).toBe('from Synthetic W-OK · 83 mi, similar elevation');
    expect(zoneCardValue(z)).toBe('8a (approx., station 83 mi)');
    expect(zoneEstimateLong(z)).toBe(ZONE_ESTIMATE_WIDE_LONG);
    expect(ZONE_ESTIMATE_WIDE_LONG).toMatch(/Not the USDA map/);
  });

  it('adds nothing extra for a near estimate', () => {
    const z = farmZoneFrom(null, near)!;
    expect(z.reach).toBe('near');
    expect(zoneReachNote(z)).toBeNull();
    expect(zoneCardValue(z)).toBe('5a (approx.)');
    expect(zoneEstimateLong(z)).toBe(ZONE_ESTIMATE_LONG);
  });

  it('lets the owner-typed zone win over a wide estimate', () => {
    const z = farmZoneFrom('7b', wide)!;
    expect(z).toEqual({
      zone: '7b',
      provenance: 'manual',
      stationName: null,
      distanceMi: null,
      extremeMinF: null
    });
    expect(zoneReachNote(z)).toBeNull();
    expect(zoneCardValue(z)).toBe('7b');
    expect(zoneEstimateLong(z)).toBeUndefined();
  });

  it('reads a Card snapshot saved before the wide pass as a near estimate', () => {
    const old = {
      zone: '7a',
      provenance: 'data' as const,
      stationName: 'Dulles',
      distanceMi: 6,
      extremeMinF: 4
    };
    expect(zoneReachNote(old)).toBeNull();
    expect(zoneCardValue(old)).toBe('7a (approx.)');
    expect(zoneSourceDetail(old)).toBe('from Dulles · 6 mi');
  });
});

describe('bundled NOAA dataset: wide pass', () => {
  const ds = JSON.parse(
    readFileSync(resolve(__dirname, 'data/frost-normals-us.json'), 'utf8')
  ) as FrostDataset;
  // Snake Valley, NV: USGS 3DEP puts (38, -114) at 6,919 ft (EPQS, recorded 2026-09-26).
  const SNAKE_VALLEY = { lat: 38, lon: -114, elevationFt: 6919.1 };

  it('finds nothing within 50 miles without an elevation', () => {
    expect(lookupZoneInDataset(ds, SNAKE_VALLEY.lat, SNAKE_VALLEY.lon)).toBeNull();
  });

  it('skips lower Cedar City and uses Great Basin NP at a similar elevation', () => {
    const r = lookupZoneInDataset(ds, SNAKE_VALLEY.lat, SNAKE_VALLEY.lon, {
      elevationFt: SNAKE_VALLEY.elevationFt
    })!;
    expect(r.reach).toBe('wide');
    expect(r.station.id).toBe('USC00263340');
    expect(r.station.distanceMi).toBeGreaterThan(50);
    expect(r.station.distanceMi).toBeLessThan(100);
    expect(Math.abs(r.station.elevDeltaFt!)).toBeLessThanOrEqual(1000);
    expect(r.zone.zone).toBe('6b');
  });

  it('leaves Dulles on its own station at its 3DEP elevation', () => {
    const r = lookupZoneInDataset(ds, 38.9408, -77.4636, { elevationFt: 289.4 })!;
    expect(r.station.id).toBe('USW00093738');
    expect(r.reach).toBe('near');
    expect(r.zone.zone).toBe('7a');
  });
});
