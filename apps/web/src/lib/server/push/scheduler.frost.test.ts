// @vitest-environment node
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { addAssignment } from '$lib/db/users';
import { createBlock } from '$lib/db/blocks';
import { createPlanned, updateStatus } from '$lib/db/crops';
import { listDeliveries, upsertSubscription } from '$lib/db/pushSubscriptions';
import { DEFAULT_PUSH_PREFS } from '$lib/push/prefs';
import frostAdvisory from '../__fixtures__/nws-alerts-frost-advisory-garrett.json';
import { parseFrostAlerts, type FrostAlertFetcher } from '../nwsAlerts';
import { WeatherFetchError } from '../weather';
import { processOwnerAlerts, runPushTick } from './scheduler';
import { decryptPayload, generateVapidKeys } from './webPush';

const config = { ...generateVapidKeys(), subject: 'mailto:ops@cropcard.test' };
const NOW = Date.parse('2026-09-24T18:00:00Z');
const DAY = 86_400_000;

const LEESBURG_POLYGON = JSON.stringify({
  type: 'Polygon',
  coordinates: [
    [
      [-77.564, 39.115],
      [-77.563, 39.115],
      [-77.563, 39.116],
      [-77.564, 39.116],
      [-77.564, 39.115]
    ]
  ]
});

function seedOwner() {
  const ownerId = `frost-owner-${randomUUID()}`;
  const userId = `frost-user-${randomUUID()}`;
  db.insert(owners).values({ id: ownerId, name: ownerId, slug: ownerId }).run();
  db.insert(users)
    .values({ id: userId, email: `${userId}@frost.test` })
    .run();
  addAssignment({ ownerId, userId, roleWithinOwner: 'owner' });
  return { ownerId, userId };
}

function subscribe(ownerId: string, userId: string, frost: boolean) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const endpoint = `https://push.example.net/send/${randomUUID()}`;
  runWithTenant(ownerId, () =>
    upsertSubscription({
      userId,
      endpoint,
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: auth.toString('base64url'),
      prefs: { ...DEFAULT_PUSH_PREFS, 'frost-tonight': frost }
    })
  );
  return { endpoint, priv: ecdh.getPrivateKey(), auth };
}

function plant(
  ownerId: string,
  cropPluginId: string,
  opts: { status?: 'active' | 'planned'; plantingDate?: number; geometry?: boolean } = {}
) {
  return runWithTenant(ownerId, () => {
    const block = createBlock({
      name: `Bed ${randomUUID().slice(0, 4)}`,
      geometryGeojson: opts.geometry === false ? undefined : LEESBURG_POLYGON
    });
    const crop = createPlanned({
      blockId: block.id,
      cropPluginId,
      varietyDisplayName: cropPluginId,
      plantingDate: opts.plantingDate ?? NOW - 90 * DAY
    });
    if ((opts.status ?? 'active') === 'active') updateStatus(crop.id, 'active');
    return crop;
  });
}

function nws(features: unknown = frostAdvisory) {
  return vi.fn<FrostAlertFetcher>(async (_lat, _lon, now) => parseFrostAlerts(features, now));
}

const mockPush = () =>
  vi.fn(
    async (_u: string | URL | Request, _i?: RequestInit) => new Response(null, { status: 201 })
  );

function tick(ownerId: string, frostAlerts: FrostAlertFetcher, fetchImpl = mockPush(), now = NOW) {
  return runWithTenantAsync(ownerId, () =>
    processOwnerAlerts(ownerId, { config, now: () => now, fetchImpl, frostAlerts })
  );
}

describe('frost-tonight push alerts', () => {
  it('is opt-in: nobody opted in means NWS is never asked', async () => {
    const { ownerId, userId } = seedOwner();
    subscribe(ownerId, userId, false);
    plant(ownerId, 'tomato-amish-paste');
    const fetcher = nws();
    const s = await tick(ownerId, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(s.alerts).toBe(0);
  });

  it('sends one alert per NWS product, then never again for its updates', async () => {
    const { ownerId, userId } = seedOwner();
    const sub = subscribe(ownerId, userId, true);
    plant(ownerId, 'tomato-amish-paste');
    const fetcher = nws();
    const push = mockPush();

    const first = await tick(ownerId, fetcher, push);
    expect(first).toMatchObject({ alerts: 1, sent: 1 });
    const [lat, lon] = fetcher.mock.calls[0];
    expect(lat).toBeCloseTo(39.1155, 3);
    expect(lon).toBeCloseTo(-77.5635, 3);
    const [, init] = push.mock.calls[0];
    const payload = JSON.parse(
      decryptPayload(Buffer.from(init!.body as Uint8Array), sub.priv, sub.auth).toString()
    );
    expect(payload).toMatchObject({
      kind: 'frost-tonight',
      tag: 'frost-tonight:KLWX.FR.Y.0007.2026',
      url: '/today'
    });
    expect(payload.body).toContain('tomato-amish-paste is at risk.');

    const second = await tick(ownerId, fetcher, push, NOW + 6 * 60 * 60 * 1000);
    expect(second.alerts).toBe(0);
    expect(push).toHaveBeenCalledTimes(1);
    const deliveries = runWithTenant(ownerId, () => listDeliveries());
    expect(deliveries).toEqual([
      expect.objectContaining({ kind: 'frost-tonight', subjectId: 'KLWX.FR.Y.0007.2026' })
    ]);
  });

  it('stays quiet when nothing frost-tender is planted or about to be', async () => {
    const { ownerId, userId } = seedOwner();
    subscribe(ownerId, userId, true);
    plant(ownerId, 'garlic-music-hardneck');
    plant(ownerId, 'pepper-bell-california-wonder', {
      status: 'planned',
      plantingDate: NOW + 120 * DAY
    });
    const s = await tick(ownerId, nws());
    expect(s.alerts).toBe(0);
    expect(runWithTenant(ownerId, () => listDeliveries())).toEqual([]);
  });

  it('skips the NWS request when only hardy crops are out', async () => {
    const { ownerId, userId } = seedOwner();
    subscribe(ownerId, userId, true);
    plant(ownerId, 'garlic-german-extra-hardy');
    const fetcher = nws();
    await tick(ownerId, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('counts a tender planting planned for this week', async () => {
    const { ownerId, userId } = seedOwner();
    subscribe(ownerId, userId, true);
    plant(ownerId, 'pepper-bell-california-wonder', {
      status: 'planned',
      plantingDate: NOW + 3 * DAY
    });
    expect(await tick(ownerId, nws())).toMatchObject({ alerts: 1, sent: 1 });
  });

  it('never uses the Loudoun default as the farm location', async () => {
    const { ownerId, userId } = seedOwner();
    subscribe(ownerId, userId, true);
    plant(ownerId, 'tomato-amish-paste', { geometry: false });
    const fetcher = nws();
    await tick(ownerId, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('an NWS failure skips the tick without throwing or claiming the product', async () => {
    const { ownerId, userId } = seedOwner();
    subscribe(ownerId, userId, true);
    plant(ownerId, 'tomato-amish-paste');
    const failing = vi.fn<FrostAlertFetcher>(async () => {
      throw new WeatherFetchError('NWS alerts fetch failed: 503');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await tick(ownerId, failing)).toMatchObject({ alerts: 0 });
    warn.mockRestore();
    expect(await tick(ownerId, nws())).toMatchObject({ alerts: 1 });
  });

  it("one Owner's tender crops never trigger another Owner's alert", async () => {
    const a = seedOwner();
    const b = seedOwner();
    subscribe(a.ownerId, a.userId, true);
    const subB = subscribe(b.ownerId, b.userId, true);
    plant(a.ownerId, 'tomato-amish-paste');
    plant(b.ownerId, 'garlic-music-hardneck');
    const push = mockPush();
    await runPushTick({ config, now: () => NOW, fetchImpl: push, frostAlerts: nws() });
    const endpoints = push.mock.calls.map(([u]) => String(u));
    expect(endpoints).not.toContain(subB.endpoint);
    expect(runWithTenant(b.ownerId, () => listDeliveries())).toEqual([]);
    expect(runWithTenant(a.ownerId, () => listDeliveries())).toHaveLength(1);
  });
});
