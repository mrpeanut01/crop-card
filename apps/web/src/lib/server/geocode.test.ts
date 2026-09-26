import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  allowGeocode,
  censusGeocodeUrl,
  GEOCODE_MAX_RESULTS,
  GEOCODE_PER_MINUTE,
  GEOCODE_TIMEOUT_MS,
  geocodeAddress,
  normalizeGeocodeQuery,
  parseCensusMatches,
  resetGeocodeRateLimit,
  type GeocodeFetcher
} from './geocode';
import { SafeFetchError, type SafeFetchResponse } from './safeFetch';
import census from './__fixtures__/census-onelineaddress.json';

function response(status: number, text: string, truncated = false): SafeFetchResponse {
  return {
    url: 'https://geocoding.geo.census.gov/',
    status,
    contentType: 'application/json',
    readText: async () => ({ text, truncated }),
    cancel: vi.fn()
  };
}

// Live geocoding.geo.census.gov onelineaddress responses recorded 2026-09-26.
const CENSUS_BODY = census.street;

describe('censusGeocodeUrl', () => {
  it('targets the onelineaddress endpoint with the current benchmark', () => {
    const url = new URL(censusGeocodeUrl('1 Main St, Leesburg VA'));
    expect(url.origin + url.pathname).toBe(
      'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress'
    );
    expect(url.searchParams.get('address')).toBe('1 Main St, Leesburg VA');
    expect(url.searchParams.get('benchmark')).toBe('Public_AR_Current');
    expect(url.searchParams.get('format')).toBe('json');
  });

  it('keeps arbitrary query text inside the address parameter', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (q) => {
        const url = new URL(censusGeocodeUrl(q));
        expect(url.hostname).toBe('geocoding.geo.census.gov');
        expect(url.searchParams.get('address')).toBe(q);
      })
    );
  });
});

describe('normalizeGeocodeQuery', () => {
  it('collapses whitespace and enforces length bounds', () => {
    expect(normalizeGeocodeQuery('  1   Main  St ')).toBe('1 Main St');
    expect(normalizeGeocodeQuery('ab')).toBeNull();
    expect(normalizeGeocodeQuery(null)).toBeNull();
    expect(normalizeGeocodeQuery('x'.repeat(201))).toBeNull();
  });
});

describe('parseCensusMatches', () => {
  it('reads a Leesburg street address with x=lon, y=lat', () => {
    expect(parseCensusMatches(census.street)).toEqual([
      {
        label: '1 HARRISON ST SE, LEESBURG, VA, 20175',
        lat: 39.113939436497,
        lon: -77.561559980346
      }
    ]);
  });

  it('matches a rural street address and corrects a misspelled town', () => {
    expect(parseCensusMatches(census.ruraladdr)).toEqual([
      {
        label: '16501 HILLSBORO RD, PURCELLVILLE, VA, 20132',
        lat: 39.16074187382,
        lon: -77.7338836194
      }
    ]);
    expect(parseCensusMatches(census.misspelled)).toEqual([
      {
        label: '25 W MARKET ST, LEESBURG, VA, 20176',
        lat: 39.115504561944,
        lon: -77.564976413073
      }
    ]);
  });

  it.each(['rural', 'pobox', 'nonsense'] as const)(
    'returns [] for the %s query (Census has no address range for it)',
    (kind) => {
      expect(census[kind].result.addressMatches).toEqual([]);
      expect(parseCensusMatches(census[kind])).toEqual([]);
    }
  );

  it('skips entries with a missing label or non-numeric coordinates', () => {
    const [real] = census.street.result.addressMatches;
    const body = {
      result: {
        addressMatches: [
          { ...real, coordinates: { x: 'nope', y: 1 } },
          { ...real, matchedAddress: undefined },
          real
        ]
      }
    };
    expect(parseCensusMatches(body)).toHaveLength(1);
  });

  it('returns [] for anything malformed', () => {
    for (const body of [null, 42, {}, { result: {} }, { result: { addressMatches: 'x' } }]) {
      expect(parseCensusMatches(body)).toEqual([]);
    }
  });

  it('drops out-of-range coordinates and caps the result count', () => {
    const many = {
      result: {
        addressMatches: [
          { matchedAddress: 'bad', coordinates: { x: 0, y: 91 } },
          ...Array.from({ length: 10 }, (_, i) => ({
            matchedAddress: `A${i}`,
            coordinates: { x: -77, y: 39 }
          }))
        ]
      }
    };
    const out = parseCensusMatches(many);
    expect(out).toHaveLength(GEOCODE_MAX_RESULTS);
    expect(out[0].label).toBe('A0');
  });
});

describe('geocodeAddress', () => {
  it('fetches through the injected safeFetch with a short timeout', async () => {
    const fetcher = vi.fn<GeocodeFetcher>(async () => response(200, JSON.stringify(CENSUS_BODY)));
    const out = await geocodeAddress('1 Harrison St SE, Leesburg, VA', fetcher);
    expect(out).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, opts] = fetcher.mock.calls[0];
    expect(url).toContain('geocoding.geo.census.gov');
    expect(opts.timeoutMs).toBe(GEOCODE_TIMEOUT_MS);
    expect(opts.timeoutMs).toBeLessThanOrEqual(5_000);
  });

  it('skips the network for an invalid query', async () => {
    const fetcher = vi.fn<GeocodeFetcher>();
    expect(await geocodeAddress('  ', fetcher)).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['a timeout', async () => Promise.reject(new SafeFetchError('timeout', 'Request timed out'))],
    ['a blocked address', async () => Promise.reject(new SafeFetchError('blocked-address', 'x'))],
    ['a non-200 status', async () => response(503, 'unavailable')],
    ['invalid JSON', async () => response(200, '<html>')],
    ['a truncated body', async () => response(200, JSON.stringify(CENSUS_BODY), true)],
    ['a thrown non-error', async () => Promise.reject('boom')]
  ])('returns [] on %s and never throws', async (_label, impl) => {
    const fetcher = vi.fn<GeocodeFetcher>(impl as GeocodeFetcher);
    await expect(geocodeAddress('1 Main St, Leesburg VA', fetcher)).resolves.toEqual([]);
  });

  it('cancels the response on a non-200 status', async () => {
    const res = response(500, '');
    await geocodeAddress('1 Main St, Leesburg VA', async () => res);
    expect(res.cancel).toHaveBeenCalled();
  });
});

describe('allowGeocode', () => {
  beforeEach(() => resetGeocodeRateLimit());

  it('allows the per-minute budget, then refuses until the window slides', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < GEOCODE_PER_MINUTE; i++) expect(allowGeocode('u1', t0 + i)).toBe(true);
    expect(allowGeocode('u1', t0 + 100)).toBe(false);
    expect(allowGeocode('u2', t0 + 100)).toBe(true);
    expect(allowGeocode('u1', t0 + 60_000 + GEOCODE_PER_MINUTE)).toBe(true);
  });
});
