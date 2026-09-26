// @vitest-environment node
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { addAssignment } from '$lib/db/users';
import { createEquipment, updateEquipmentState } from '$lib/db/equipment';
import {
  listDeliveries,
  listSubscriptions,
  upsertSubscription,
  type PushSubscriptionRecord
} from '$lib/db/pushSubscriptions';
import { DEFAULT_PUSH_PREFS } from '$lib/push/prefs';
import { selectRecipients, sendToSubscriptions } from './dispatch';
import { processOwnerAlerts, runPushTick } from './scheduler';
import { decryptPayload, generateVapidKeys } from './webPush';

const config = { ...generateVapidKeys(), subject: 'mailto:ops@cropcard.test' };
const HOUR = 60 * 60 * 1000;

function seedOwner(
  role: 'owner' | 'helper' = 'owner',
  billing: 'active' | 'suspended' | 'canceled' = 'active'
) {
  const ownerId = `push-owner-${randomUUID()}`;
  const userId = `push-user-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: billing })
    .run();
  db.insert(users)
    .values({ id: userId, email: `${userId}@push.test` })
    .run();
  addAssignment({ ownerId, userId, roleWithinOwner: role });
  return { ownerId, userId };
}

function browser() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    priv: ecdh.getPrivateKey(),
    auth,
    endpoint: `https://push.example.net/send/${randomUUID()}`,
    p256dh: ecdh.getPublicKey().toString('base64url'),
    authB64: auth.toString('base64url')
  };
}

function subscribe(ownerId: string, userId: string, b = browser()) {
  const sub = runWithTenant(ownerId, () =>
    upsertSubscription({ userId, endpoint: b.endpoint, p256dh: b.p256dh, auth: b.authB64 })
  );
  return { sub, b };
}

function dirtySprayer(ownerId: string, lastSprayedAt: number) {
  return runWithTenant(ownerId, () => {
    const eq = createEquipment({ type: 'sprayer', label: 'Tank A' });
    updateEquipmentState(eq.id, {
      lastChemistryClass: 'insecticide-load',
      lastUsedAt: lastSprayedAt
    });
    return eq.id;
  });
}

function mockFetch(status = 201) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status })
  );
}

describe('push scheduler', () => {
  it('sends a decon-due alert once, then never again (sent-log idempotency)', async () => {
    const { ownerId, userId } = seedOwner();
    const { b } = subscribe(ownerId, userId);
    const now = Date.now();
    dirtySprayer(ownerId, now - 2 * HOUR);
    const fetchImpl = mockFetch();

    const first = await runWithTenantAsync(ownerId, () =>
      processOwnerAlerts(ownerId, { config, now: () => now, fetchImpl })
    );
    expect(first).toMatchObject({ alerts: 1, sent: 1 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(b.endpoint);
    const payload = JSON.parse(
      decryptPayload(Buffer.from(init!.body as Uint8Array), b.priv, b.auth).toString()
    );
    expect(payload).toMatchObject({
      kind: 'decon-due',
      url: expect.stringMatching(/^\/spray\/decon/)
    });

    const second = await runWithTenantAsync(ownerId, () =>
      processOwnerAlerts(ownerId, { config, now: () => now + 15 * 60_000, fetchImpl })
    );
    expect(second).toMatchObject({ alerts: 0, sent: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const deliveries = runWithTenant(ownerId, () => listDeliveries());
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ kind: 'decon-due', recipientCount: 1 });
    const [sub] = runWithTenant(ownerId, () => listSubscriptions());
    expect(sub.lastSuccessAt).toBe(now);
  });

  it('respects per-kind prefs', async () => {
    const { ownerId, userId } = seedOwner();
    const b = browser();
    runWithTenant(ownerId, () =>
      upsertSubscription({
        userId,
        endpoint: b.endpoint,
        p256dh: b.p256dh,
        auth: b.authB64,
        prefs: { ...DEFAULT_PUSH_PREFS, 'decon-due': false }
      })
    );
    const now = Date.now();
    dirtySprayer(ownerId, now - 2 * HOUR);
    const fetchImpl = mockFetch();
    const s = await runWithTenantAsync(ownerId, () =>
      processOwnerAlerts(ownerId, { config, now: () => now, fetchImpl })
    );
    expect(s).toMatchObject({ alerts: 1, sent: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('410 from the push service deletes the subscription; 500 bumps failure_count', async () => {
    const a = seedOwner();
    subscribe(a.ownerId, a.userId);
    const now = Date.now();
    dirtySprayer(a.ownerId, now - 2 * HOUR);
    await runWithTenantAsync(a.ownerId, () =>
      processOwnerAlerts(a.ownerId, { config, now: () => now, fetchImpl: mockFetch(410) })
    );
    expect(runWithTenant(a.ownerId, () => listSubscriptions())).toEqual([]);

    const b = seedOwner();
    subscribe(b.ownerId, b.userId);
    dirtySprayer(b.ownerId, now - 2 * HOUR);
    await runWithTenantAsync(b.ownerId, () =>
      processOwnerAlerts(b.ownerId, { config, now: () => now, fetchImpl: mockFetch(500) })
    );
    const [sub] = runWithTenant(b.ownerId, () => listSubscriptions());
    expect(sub.failureCount).toBe(1);
  });

  it("runPushTick never delivers one Owner's alert to another Owner's subscriber", async () => {
    const a = seedOwner();
    const b = seedOwner();
    const subA = subscribe(a.ownerId, a.userId);
    const subB = subscribe(b.ownerId, b.userId);
    const now = Date.now();
    dirtySprayer(a.ownerId, now - 2 * HOUR);
    const fetchImpl = mockFetch();
    await runPushTick({ config, now: () => now, fetchImpl });
    const endpoints = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(endpoints).toContain(subA.b.endpoint);
    expect(endpoints).not.toContain(subB.b.endpoint);
    expect(runWithTenant(b.ownerId, () => listDeliveries())).toEqual([]);
  });

  it('skips suspended Owners', async () => {
    const s = seedOwner('owner', 'suspended');
    const { b } = subscribe(s.ownerId, s.userId);
    const now = Date.now();
    dirtySprayer(s.ownerId, now - 2 * HOUR);
    const fetchImpl = mockFetch();
    await runPushTick({ config, now: () => now, fetchImpl });
    expect(fetchImpl.mock.calls.map((c) => String(c[0]))).not.toContain(b.endpoint);
  });

  it('a farm that cancelled a paid plan (now Free) still gets decon-due push', async () => {
    const s = seedOwner('owner', 'canceled');
    const { b } = subscribe(s.ownerId, s.userId);
    const now = Date.now();
    dirtySprayer(s.ownerId, now - 2 * HOUR);
    const fetchImpl = mockFetch();
    await runPushTick({ config, now: () => now, fetchImpl });
    expect(fetchImpl.mock.calls.map((c) => String(c[0]))).toContain(b.endpoint);
    const decon = runWithTenant(s.ownerId, () => listDeliveries()).filter(
      (d) => d.kind === 'decon-due'
    );
    expect(decon).toHaveLength(1);
  });

  it('a second tick twelve hours later sends nothing already sent', async () => {
    const { ownerId, userId } = seedOwner();
    subscribe(ownerId, userId);
    const now = Date.now();
    dirtySprayer(ownerId, now - 2 * HOUR);
    const fetchImpl = mockFetch();
    await runPushTick({ config, now: () => now, fetchImpl });
    const sentFirst = fetchImpl.mock.calls.length;
    expect(sentFirst).toBeGreaterThan(0);
    await runPushTick({ config, now: () => now + 12 * HOUR, fetchImpl });
    const decon = runWithTenant(ownerId, () => listDeliveries()).filter(
      (d) => d.kind === 'decon-due'
    );
    expect(decon).toHaveLength(1);
  });
});

describe('dispatch', () => {
  const sub = (userId: string): PushSubscriptionRecord => ({
    id: userId,
    ownerId: 'o',
    userId,
    endpoint: `https://p.test/${userId}`,
    p256dh: 'x',
    auth: 'y',
    createdAt: 0,
    lastSuccessAt: null,
    failureCount: 0,
    prefs: { ...DEFAULT_PUSH_PREFS }
  });
  const members = [
    { userId: 'own', roleWithinOwner: 'owner', status: 'active' },
    { userId: 'help', roleWithinOwner: 'helper', status: 'active' },
    { userId: 'help2', roleWithinOwner: 'helper', status: 'active' },
    { userId: 'insp', roleWithinOwner: 'inspector', status: 'active' },
    { userId: 'gone', roleWithinOwner: 'helper', status: 'revoked' }
  ];
  const subs = ['own', 'help', 'help2', 'insp', 'gone', 'stranger'].map(sub);

  it("audience 'all' reaches every active non-inspector member", () => {
    const r = selectRecipients(subs, members, { kind: 'decon-due', audience: { kind: 'all' } });
    expect(r.map((s) => s.userId).sort()).toEqual(['help', 'help2', 'own']);
  });

  it("audience 'owners-and' reaches owners plus the named users only", () => {
    const r = selectRecipients(subs, members, {
      kind: 'lock-window-closing',
      audience: { kind: 'owners-and', userIds: ['help'] }
    });
    expect(r.map((s) => s.userId).sort()).toEqual(['help', 'own']);
  });

  it('sendToSubscriptions reports failures without throwing', async () => {
    const { ownerId, userId } = seedOwner();
    const { sub: stored } = subscribe(ownerId, userId);
    const summary = await runWithTenantAsync(ownerId, () =>
      sendToSubscriptions([stored], { title: 't', body: 'b', url: '/' }, config, {
        fetchImpl: vi.fn(async () => {
          throw new Error('offline');
        }) as unknown as typeof fetch
      })
    );
    expect(summary).toEqual({ sent: 0, removed: 0, failed: 1 });
  });
});
