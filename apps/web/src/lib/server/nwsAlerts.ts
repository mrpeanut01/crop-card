/**
 * NWS active alerts for a point (`/alerts/active?point=lat,lon`), narrowed to
 * the frost and freeze products. Fetched through `safeFetch` with no
 * redirects, pinned to api.weather.gov, with a timeout and a size cap.
 * Results are cached per rounded point so several Owners on the same farm
 * point share one request per scheduler tick.
 */

import { NWS_BASE, USER_AGENT, WeatherFetchError } from './weather';
import { safeFetch, type SafeFetchOptions } from './safeFetch';

export const FROST_EVENTS = [
  'Frost Advisory',
  'Freeze Watch',
  'Freeze Warning',
  'Hard Freeze Watch',
  'Hard Freeze Warning'
] as const;

export type FrostEvent = (typeof FROST_EVENTS)[number];

export const NWS_ALERTS_TIMEOUT_MS = 8000;
export const NWS_ALERTS_MAX_BYTES = 1_000_000;
export const NWS_ALERTS_CACHE_MS = 10 * 60 * 1000;

export interface FrostAlert {
  /** Stable per NWS product: VTEC office.phenomena.significance.ETN plus the
   *  issuance year, so updates and continuations of one product share it. */
  productKey: string;
  event: FrostEvent;
  headline: string;
  nwsHeadline: string | null;
  senderName: string | null;
  onsetMs: number | null;
  endsMs: number | null;
}

interface RawAlertProperties {
  id?: unknown;
  event?: unknown;
  status?: unknown;
  messageType?: unknown;
  sent?: unknown;
  onset?: unknown;
  effective?: unknown;
  ends?: unknown;
  expires?: unknown;
  headline?: unknown;
  senderName?: unknown;
  parameters?: { VTEC?: unknown; NWSheadline?: unknown };
}

const FROST_EVENT_SET: ReadonlySet<string> = new Set(FROST_EVENTS);
const ENDED_VTEC_ACTIONS = new Set(['CAN', 'EXP', 'UPG']);
const VTEC_RE = /^\/[OTEX]\.([A-Z]{3})\.([A-Z]{4})\.([A-Z]{2})\.([A-Z])\.(\d{4})\./;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function ms(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function firstString(v: unknown): string | null {
  return Array.isArray(v) ? str(v[0]) : null;
}

function productKeyOf(p: RawAlertProperties): string | null {
  const vtec = firstString(p.parameters?.VTEC);
  const m = vtec ? VTEC_RE.exec(vtec) : null;
  const sentMs = ms(p.sent);
  if (m) {
    const year = sentMs !== null ? new Date(sentMs).getUTCFullYear() : 0;
    return `${m[2]}.${m[3]}.${m[4]}.${m[5]}.${year}`;
  }
  return str(p.id);
}

/** Pure: frost/freeze products from an NWS alerts FeatureCollection that are
 *  still in force at `now`. One entry per product (the newest message wins). */
export function parseFrostAlerts(body: unknown, now: number): FrostAlert[] {
  const features = (body as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const byKey = new Map<string, { alert: FrostAlert; sentMs: number }>();
  for (const f of features) {
    const p = (f as { properties?: RawAlertProperties })?.properties;
    if (!p) continue;
    const event = str(p.event);
    if (!event || !FROST_EVENT_SET.has(event)) continue;
    if (p.status !== 'Actual' || p.messageType === 'Cancel') continue;
    const vtec = firstString(p.parameters?.VTEC);
    const action = vtec ? (VTEC_RE.exec(vtec)?.[1] ?? null) : null;
    if (action && ENDED_VTEC_ACTIONS.has(action)) continue;
    const endsMs = ms(p.ends) ?? ms(p.expires);
    if (endsMs !== null && endsMs <= now) continue;
    const key = productKeyOf(p);
    if (!key) continue;
    const sentMs = ms(p.sent) ?? 0;
    const prev = byKey.get(key);
    if (prev && prev.sentMs >= sentMs) continue;
    byKey.set(key, {
      sentMs,
      alert: {
        productKey: key,
        event: event as FrostEvent,
        headline: str(p.headline) ?? event,
        nwsHeadline: firstString(p.parameters?.NWSheadline),
        senderName: str(p.senderName),
        onsetMs: ms(p.onset) ?? ms(p.effective),
        endsMs
      }
    });
  }
  return [...byKey.values()].map((v) => v.alert);
}

export function nwsAlertsUrl(lat: number, lon: number): string {
  return `${NWS_BASE}/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`;
}

export type FrostAlertFetcher = (lat: number, lon: number, now: number) => Promise<FrostAlert[]>;

const cache = new Map<string, { at: number; body: unknown }>();

export function resetNwsAlertsCache(): void {
  cache.clear();
}

export async function fetchActiveAlertsBody(
  lat: number,
  lon: number,
  opts: Pick<SafeFetchOptions, 'resolver' | 'connector'> & { now?: number } = {}
): Promise<unknown> {
  const url = nwsAlertsUrl(lat, lon);
  const now = opts.now ?? Date.now();
  const hit = cache.get(url);
  if (hit && now - hit.at < NWS_ALERTS_CACHE_MS) return hit.body;
  let text: string;
  try {
    const res = await safeFetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' },
      timeoutMs: NWS_ALERTS_TIMEOUT_MS,
      maxBytes: NWS_ALERTS_MAX_BYTES,
      maxRedirects: 0,
      resolver: opts.resolver,
      connector: opts.connector
    });
    if (res.status !== 200) {
      res.cancel();
      throw new WeatherFetchError(`NWS alerts fetch failed: ${res.status} (${url})`);
    }
    const read = await res.readText();
    if (read.truncated) throw new WeatherFetchError(`NWS alerts response too large (${url})`);
    text = read.text;
  } catch (e) {
    if (e instanceof WeatherFetchError) throw e;
    throw new WeatherFetchError(`NWS alerts fetch failed (${url})`, e);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (e) {
    throw new WeatherFetchError(`NWS alerts returned invalid JSON (${url})`, e);
  }
  cache.set(url, { at: now, body });
  return body;
}

export const fetchFrostAlerts: FrostAlertFetcher = async (lat, lon, now) =>
  parseFrostAlerts(await fetchActiveAlertsBody(lat, lon, { now }), now);
