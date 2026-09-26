// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import frostAdvisory from './__fixtures__/nws-alerts-frost-advisory-garrett.json';
import freezeWarning from './__fixtures__/nws-alerts-freeze-warning-mqt.json';
import emptyActive from './__fixtures__/nws-alerts-active-empty-lwx.json';
import {
  fetchActiveAlertsBody,
  NWS_ALERTS_MAX_BYTES,
  nwsAlertsUrl,
  parseFrostAlerts,
  resetNwsAlertsCache
} from './nwsAlerts';
import type { ConnectArgs, Connector, RawResponse, Resolver } from './safeFetch';
import { USER_AGENT, WeatherFetchError } from './weather';

const at = (iso: string) => Date.parse(iso);

describe('parseFrostAlerts (recorded NWS payloads)', () => {
  it('collapses the NEW + CON messages of one Frost Advisory into one product', () => {
    const alerts = parseFrostAlerts(frostAdvisory, at('2026-09-24T18:00:00Z'));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      productKey: 'KLWX.FR.Y.0007.2026',
      event: 'Frost Advisory',
      senderName: 'NWS Baltimore MD/Washington DC',
      onsetMs: at('2026-09-25T03:02:00-04:00'),
      endsMs: at('2026-09-25T09:00:00-04:00')
    });
    expect(alerts[0].nwsHeadline).toMatch(/FROST ADVISORY REMAINS IN EFFECT/);
  });

  it('drops the special weather statement and the expired (EXP) message', () => {
    const expOnly = {
      features: frostAdvisory.features.filter(
        (f) =>
          f.properties.event !== 'Frost Advisory' ||
          (f.properties.parameters.VTEC ?? [])[0]?.startsWith('/O.EXP.')
      )
    };
    expect(parseFrostAlerts(expOnly, at('2026-09-25T12:00:00Z'))).toEqual([]);
  });

  it('returns nothing once the product has ended', () => {
    expect(parseFrostAlerts(frostAdvisory, at('2026-09-25T14:00:00Z'))).toEqual([]);
  });

  it('parses a Freeze Warning from another office', () => {
    const [alert] = parseFrostAlerts(freezeWarning, at('2026-09-21T18:00:00Z'));
    expect(alert).toMatchObject({
      productKey: 'KMQT.FZ.W.0002.2026',
      event: 'Freeze Warning',
      onsetMs: at('2026-09-22T06:00:00Z'),
      endsMs: at('2026-09-22T13:00:00Z')
    });
  });

  it('handles the real empty response and junk input', () => {
    expect(parseFrostAlerts(emptyActive, Date.now())).toEqual([]);
    expect(parseFrostAlerts(null, Date.now())).toEqual([]);
    expect(parseFrostAlerts({ features: 'nope' }, Date.now())).toEqual([]);
    expect(parseFrostAlerts({ features: [null, {}, { properties: {} }] }, Date.now())).toEqual([]);
  });

  it('ignores cancellations, test messages and non-frost events', () => {
    const base = freezeWarning.features[0];
    const variant = (patch: Record<string, unknown>) => ({
      features: [{ ...base, properties: { ...base.properties, ...patch } }]
    });
    const now = at('2026-09-21T18:00:00Z');
    expect(parseFrostAlerts(variant({ messageType: 'Cancel' }), now)).toEqual([]);
    expect(parseFrostAlerts(variant({ status: 'Test' }), now)).toEqual([]);
    expect(parseFrostAlerts(variant({ event: 'Wind Advisory' }), now)).toEqual([]);
    expect(
      parseFrostAlerts(
        variant({
          parameters: { VTEC: ['/O.CAN.KMQT.FZ.W.0002.260922T0600Z-260922T1300Z/'] }
        }),
        now
      )
    ).toEqual([]);
  });

  it('falls back to the alert id when a product has no VTEC', () => {
    const base = freezeWarning.features[0];
    const noVtec = {
      features: [{ ...base, properties: { ...base.properties, parameters: {} } }]
    };
    const [alert] = parseFrostAlerts(noVtec, at('2026-09-21T18:00:00Z'));
    expect(alert.productKey).toBe(base.properties.id);
  });
});

function body(text: string): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield new TextEncoder().encode(text);
  })();
}

function response(status: number, text = '', headers: Record<string, string> = {}): RawResponse {
  return { status, headers, body: body(text), destroy: vi.fn() };
}

const resolver: Resolver = async () => [{ address: '23.36.40.8', family: 4 }];

function connector(r: () => RawResponse): Connector & { calls: ConnectArgs[] } {
  const calls: ConnectArgs[] = [];
  const fn = (async (args: ConnectArgs) => {
    calls.push(args);
    return r();
  }) as Connector & { calls: ConnectArgs[] };
  fn.calls = calls;
  return fn;
}

describe('fetchActiveAlertsBody', () => {
  beforeEach(() => resetNwsAlertsCache());

  it('asks api.weather.gov for the rounded point with the NWS User-Agent, then caches', async () => {
    const c = connector(() => response(200, JSON.stringify(frostAdvisory)));
    const now = Date.now();
    const got = await fetchActiveAlertsBody(39.115712, -77.563599, {
      resolver,
      connector: c,
      now
    });
    expect(got).toEqual(frostAdvisory);
    expect(c.calls[0].url.toString()).toBe(
      'https://api.weather.gov/alerts/active?point=39.1157,-77.5636'
    );
    expect(c.calls[0].headers).toMatchObject({
      'User-Agent': USER_AGENT,
      Accept: 'application/geo+json'
    });
    await fetchActiveAlertsBody(39.115712, -77.563599, {
      resolver,
      connector: c,
      now: now + 60_000
    });
    expect(c.calls).toHaveLength(1);
  });

  it('refuses to follow a redirect', async () => {
    const c = connector(() => response(301, '', { location: 'https://evil.example/alerts' }));
    await expect(fetchActiveAlertsBody(39, -77, { resolver, connector: c })).rejects.toBeInstanceOf(
      WeatherFetchError
    );
    expect(c.calls).toHaveLength(1);
  });

  it('rejects non-200, oversized and non-JSON responses', async () => {
    await expect(
      fetchActiveAlertsBody(39, -77, { resolver, connector: connector(() => response(503)) })
    ).rejects.toBeInstanceOf(WeatherFetchError);
    resetNwsAlertsCache();
    await expect(
      fetchActiveAlertsBody(39, -77, {
        resolver,
        connector: connector(() => response(200, 'x'.repeat(NWS_ALERTS_MAX_BYTES + 10)))
      })
    ).rejects.toThrow(/too large/);
    resetNwsAlertsCache();
    await expect(
      fetchActiveAlertsBody(39, -77, {
        resolver,
        connector: connector(() => response(200, '<html>'))
      })
    ).rejects.toThrow(/invalid JSON/);
  });

  it('builds the alerts URL on the NWS host only', () => {
    expect(nwsAlertsUrl(45.68, -111.04)).toBe(
      'https://api.weather.gov/alerts/active?point=45.6800,-111.0400'
    );
  });
});
