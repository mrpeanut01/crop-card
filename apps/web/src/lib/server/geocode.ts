import { safeFetch, type SafeFetchOptions, type SafeFetchResponse } from './safeFetch';

export const CENSUS_GEOCODER_URL =
  'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
export const GEOCODE_TIMEOUT_MS = 5_000;
export const GEOCODE_MAX_RESULTS = 5;
export const GEOCODE_QUERY_MIN = 3;
export const GEOCODE_QUERY_MAX = 200;

export interface GeocodeMatch {
  label: string;
  lat: number;
  lon: number;
}

export type GeocodeFetcher = (url: string, opts: SafeFetchOptions) => Promise<SafeFetchResponse>;

export function censusGeocodeUrl(query: string): string {
  const url = new URL(CENSUS_GEOCODER_URL);
  url.searchParams.set('address', query);
  url.searchParams.set('benchmark', 'Public_AR_Current');
  url.searchParams.set('format', 'json');
  return url.toString();
}

export function normalizeGeocodeQuery(raw: unknown): string | null {
  const q = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (q.length < GEOCODE_QUERY_MIN || q.length > GEOCODE_QUERY_MAX) return null;
  return q;
}

/** Census `addressMatches[]` → matches; anything malformed is skipped. */
export function parseCensusMatches(body: unknown): GeocodeMatch[] {
  const matches = (body as { result?: { addressMatches?: unknown } } | null)?.result
    ?.addressMatches;
  if (!Array.isArray(matches)) return [];
  const out: GeocodeMatch[] = [];
  for (const m of matches) {
    const rec = m as { matchedAddress?: unknown; coordinates?: { x?: unknown; y?: unknown } };
    const lon = Number(rec?.coordinates?.x);
    const lat = Number(rec?.coordinates?.y);
    if (typeof rec?.matchedAddress !== 'string') continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    out.push({ label: rec.matchedAddress, lat, lon });
    if (out.length >= GEOCODE_MAX_RESULTS) break;
  }
  return out;
}

/** Forward-geocodes a US address. Never throws; any failure is `[]`. */
export async function geocodeAddress(
  rawQuery: string,
  fetcher: GeocodeFetcher = safeFetch
): Promise<GeocodeMatch[]> {
  const query = normalizeGeocodeQuery(rawQuery);
  if (!query) return [];
  try {
    const res = await fetcher(censusGeocodeUrl(query), {
      timeoutMs: GEOCODE_TIMEOUT_MS,
      maxBytes: 256_000,
      maxRedirects: 2,
      headers: { accept: 'application/json' }
    });
    if (res.status !== 200) {
      res.cancel();
      return [];
    }
    const { text, truncated } = await res.readText();
    if (truncated) return [];
    return parseCensusMatches(JSON.parse(text));
  } catch {
    return [];
  }
}

const WINDOW_MS = 60_000;
export const GEOCODE_PER_MINUTE = 20;
const hits = new Map<string, number[]>();

/** In-process sliding window (single replica, Invariant 3). */
export function allowGeocode(key: string, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= GEOCODE_PER_MINUTE) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5_000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  }
  return true;
}

export function resetGeocodeRateLimit(): void {
  hits.clear();
}
