// @vitest-environment node
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { addAssignment } from '$lib/db/users';
import { createBlock } from '$lib/db/blocks';
import { createPlanned, updateStatus } from '$lib/db/crops';
import { upsertSubscription } from '$lib/db/pushSubscriptions';
import { DEFAULT_PUSH_PREFS } from '$lib/push/prefs';
import frostAdvisory from '../__fixtures__/nws-alerts-frost-advisory-garrett.json';
import { parseFrostAlerts, type FrostAlertFetcher } from '../nwsAlerts';
import { processOwnerAlerts } from './scheduler';
import { decryptPayload, generateVapidKeys } from './webPush';
import { E2E_TENDER_PERENNIAL_MARKER } from '$lib/server/herbCalendar.server';

const config = { ...generateVapidKeys(), subject: 'mailto:ops@cropcard.test' };
const NOW = Date.parse('2026-09-24T18:00:00Z');
const DAY = 86_400_000;
const POLYGON = JSON.stringify({
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

const savedDevRoutes = process.env.ENABLE_DEV_ROUTES;
afterEach(() => {
  if (savedDevRoutes === undefined) delete process.env.ENABLE_DEV_ROUTES;
  else process.env.ENABLE_DEV_ROUTES = savedDevRoutes;
});

function seed(varietyDisplayName: string) {
  const ownerId = `herb-frost-${randomUUID()}`;
  const userId = `herb-frost-user-${randomUUID()}`;
  db.insert(owners).values({ id: ownerId, name: ownerId, slug: ownerId }).run();
  db.insert(users)
    .values({ id: userId, email: `${userId}@frost.test` })
    .run();
  addAssignment({ ownerId, userId, roleWithinOwner: 'owner' });
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  runWithTenant(ownerId, () => {
    upsertSubscription({
      userId,
      endpoint: `https://push.example.net/send/${randomUUID()}`,
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: auth.toString('base64url'),
      prefs: { ...DEFAULT_PUSH_PREFS, 'frost-tonight': true }
    });
    const block = createBlock({ name: 'Herb bed', geometryGeojson: POLYGON });
    const crop = createPlanned({
      blockId: block.id,
      cropPluginId: 'rosemary-tuscan-blue',
      varietyDisplayName,
      plantingDate: NOW - 90 * DAY
    });
    updateStatus(crop.id, 'active');
  });
  return { ownerId, priv: ecdh.getPrivateKey(), auth };
}

const nws = () =>
  vi.fn<FrostAlertFetcher>(async (_lat, _lon, now) => parseFrostAlerts(frostAdvisory, now));
const push = () =>
  vi.fn(
    async (_u: string | URL | Request, _i?: RequestInit) => new Response(null, { status: 201 })
  );

describe('frost-tonight audience gains tender perennial herbs (R-8)', () => {
  it('a tender perennial herb planting gets the bring-it-in line', async () => {
    process.env.ENABLE_DEV_ROUTES = '1';
    const s = seed(`Rosemary ${E2E_TENDER_PERENNIAL_MARKER}`);
    const fetchImpl = push();
    const out = await runWithTenantAsync(s.ownerId, () =>
      processOwnerAlerts(s.ownerId, { config, now: () => NOW, fetchImpl, frostAlerts: nws() })
    );
    expect(out.alerts).toBe(1);
    const [, init] = fetchImpl.mock.calls[0];
    const payload = JSON.parse(
      decryptPayload(Buffer.from(init!.body as Uint8Array), s.priv, s.auth).toString()
    );
    expect(payload.body).toContain(
      `Rosemary ${E2E_TENDER_PERENNIAL_MARKER}: bring it in or cover it.`
    );
  });

  it('without a tender-perennial verdict the herb is judged by hardiness as before', async () => {
    delete process.env.ENABLE_DEV_ROUTES;
    const s = seed(`Rosemary ${E2E_TENDER_PERENNIAL_MARKER}`);
    const fetchImpl = push();
    await runWithTenantAsync(s.ownerId, () =>
      processOwnerAlerts(s.ownerId, { config, now: () => NOW, fetchImpl, frostAlerts: nws() })
    );
    for (const [, init] of fetchImpl.mock.calls) {
      const payload = JSON.parse(
        decryptPayload(Buffer.from(init!.body as Uint8Array), s.priv, s.auth).toString()
      );
      expect(payload.body).not.toContain('bring it in');
    }
  });
});
