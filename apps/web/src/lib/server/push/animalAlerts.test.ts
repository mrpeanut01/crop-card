// @vitest-environment node
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { addAssignment, revokeAssignment } from '$lib/db/users';
import { insertAnimal } from '$lib/db/animals';
import { insertCarePlan } from '$lib/db/animalCarePlans';
import { listDeliveries, upsertSubscription } from '$lib/db/pushSubscriptions';
import { optIn } from '$lib/db/emailAlertConsents';
import { clearOutbox, readOutbox } from '$lib/server/email';
import { DEFAULT_PUSH_PREFS } from '$lib/push/prefs';
import { addDaysYmd } from '$lib/animals/carePlans';
import { ymdInZone } from '$lib/prefs';
import type { Span } from '$lib/safety/holdLedger';
import {
  batchMessage,
  careDueAlerts,
  clearedHolds,
  withdrawalClearsAlerts,
  type OpenCareTask
} from './animalAlerts';
import { processOwnerAlerts } from './scheduler';
import { decryptPayload, generateVapidKeys } from './webPush';

const HOUR = 3_600_000;
const config = { ...generateVapidKeys(), subject: 'mailto:ops@cropcard.test' };
const ZONE = 'America/New_York';

const task = (over: Partial<OpenCareTask['meta']> & { scheduledOn?: string } = {}) => {
  const dueOn = over.dueOn ?? '2026-10-20';
  return {
    meta: {
      care: 1 as const,
      subjectType: 'animal' as const,
      subjectId: 'rex',
      planId: over.planId ?? 'p1',
      dueOn,
      careKind: over.careKind ?? ('vaccination' as const),
      leadDays: over.leadDays ?? 14,
      ...(over.subjectType ? { subjectType: over.subjectType } : {})
    },
    scheduledOn: over.scheduledOn ?? dueOn,
    subjectName: 'Rex'
  };
};

describe('careDueAlerts (D2-10)', () => {
  it('sends one reminder when the task surfaces and one on the due day', () => {
    const t = task();
    expect(careDueAlerts([t], '2026-10-05')).toEqual([]);
    const soon = careDueAlerts([t], '2026-10-06');
    expect(soon.map((a) => a.subjectId)).toEqual(['p1:2026-10-20']);
    expect(soon[0]).toMatchObject({ kind: 'animal-care-due', audience: { kind: 'all' } });
    expect(careDueAlerts([t], '2026-10-19').map((a) => a.subjectId)).toEqual(['p1:2026-10-20']);
    const due = careDueAlerts([t], '2026-10-20');
    expect(due.map((a) => a.subjectId)).toEqual(['p1:2026-10-20:due:2026-10-20']);
    expect(due[0].title).toBe('Vaccine due today: Rex');
    expect(careDueAlerts([t], '2026-10-21')).toHaveLength(1);
    expect(careDueAlerts([t], '2026-10-23')).toEqual([]);
  });

  it('a snooze asks for one more reminder on the new day', () => {
    const t = task({ scheduledOn: '2026-10-23' });
    expect(careDueAlerts([t], '2026-10-21')).toEqual([]);
    expect(careDueAlerts([t], '2026-10-23').map((a) => a.subjectId)).toEqual([
      'p1:2026-10-20:due:2026-10-23'
    ]);
  });

  it('never names the plan title or a product on the lock screen', () => {
    const [a] = careDueAlerts([task()], '2026-10-20');
    expect(`${a.title} ${a.body}`).not.toMatch(/rabies/i);
  });
});

describe('clearedHolds (D0-16)', () => {
  const now = Date.parse('2026-10-20T14:00:00Z');
  const midnight = Date.parse('2026-10-20T04:00:00Z');
  const span = (fromMs: number, toMs: number): Span => ({ fromMs, toMs, basis: 'known' });

  it('reports a hold only after its end has passed, and only once it is fully over', () => {
    const holds = new Map<string, Span[]>([
      ['animal:a1|eggs', [span(now - 10 * 24 * HOUR, midnight)]],
      ['animal:a2|milk', [span(now - 10 * 24 * HOUR, now + HOUR)]],
      ['animal:a3|meat', [span(now - 9 * 24 * HOUR, midnight)]],
      ['animal:a3|preSlaughter', [span(now - 2 * HOUR, now + 24 * HOUR)]],
      ['group:g1|eggs', [span(now - 9 * 24 * HOUR, now - 5 * 24 * HOUR)]],
      ['animal:a4|eggs', [span(now - 9 * 24 * HOUR, Infinity)]],
      ['area:f1|graze', [span(now - 9 * 24 * HOUR, midnight)]]
    ]);
    expect(clearedHolds(holds, now)).toEqual([
      { subjectKey: 'animal:a1', food: 'eggs', clearedAt: midnight }
    ]);
    expect(clearedHolds(holds, midnight - 1)).toEqual([]);
  });

  it('owner only, one line per animal, no hold details', () => {
    const alerts = withdrawalClearsAlerts(
      [{ subjectKey: 'animal:a1', food: 'eggs', clearedAt: midnight }],
      new Map([['animal:a1', 'Henrietta']])
    );
    expect(alerts[0]).toMatchObject({
      kind: 'withdrawal-clears',
      subjectId: `animal:a1:eggs:${midnight}`,
      title: 'Hold cleared: Henrietta',
      url: '/animals/a1',
      audience: { kind: 'owners-and', userIds: [] }
    });
  });

  it('batches several into one push', () => {
    const alerts = withdrawalClearsAlerts(
      [
        { subjectKey: 'animal:a1', food: 'eggs', clearedAt: midnight },
        { subjectKey: 'animal:a2', food: 'milk', clearedAt: midnight },
        { subjectKey: 'group:g1', food: 'eggs', clearedAt: midnight }
      ],
      new Map([
        ['animal:a1', 'Henrietta'],
        ['animal:a2', 'Daisy'],
        ['group:g1', 'Layers']
      ])
    );
    expect(batchMessage(alerts)).toEqual({
      title: '3 holds cleared',
      body: 'Holds have ended for Henrietta; Daisy; Layers. Open CropCard to check before use.',
      url: '/animals'
    });
  });
});

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

describe('animal-care-due in the tick', () => {
  beforeEach(() => {
    vi.stubEnv('EMAIL_TRANSPORT', 'memory');
    clearOutbox();
  });
  afterEach(() => vi.unstubAllEnvs());

  function seed() {
    const ownerId = `care-push-${randomUUID()}`;
    db.insert(owners)
      .values({ id: ownerId, name: 'Care Farm', slug: ownerId, billingStatus: 'active' })
      .run();
    const member = (role: 'owner' | 'helper' | 'inspector') => {
      const userId = `care-push-user-${randomUUID()}`;
      db.insert(users)
        .values({ id: userId, email: `${userId}@push.test` })
        .run();
      addAssignment({ ownerId, userId, roleWithinOwner: role });
      const b = browser();
      runWithTenant(ownerId, () => {
        upsertSubscription({
          userId,
          endpoint: b.endpoint,
          p256dh: b.p256dh,
          auth: b.authB64,
          prefs: { ...DEFAULT_PUSH_PREFS }
        });
        optIn(userId, 'animal-care-due', { source: 'settings', ip: null });
      });
      return { userId, email: `${userId}@push.test`, b };
    };
    return {
      ownerId,
      owner: member('owner'),
      helper: member('helper'),
      inspector: member('inspector')
    };
  }

  it('reaches every active member but inspectors, re-checks a revoked helper, and sends once', async () => {
    const { ownerId, owner, helper, inspector } = seed();
    const now = Date.now();
    const today = ymdInZone(now, ZONE);
    runWithTenant(ownerId, () => {
      const rex = insertAnimal({
        speciesId: 'dog',
        name: 'Rex',
        purpose: 'pet',
        foodProducing: false
      });
      const nanny = insertAnimal({
        speciesId: 'goat',
        name: 'Nanny',
        purpose: 'production',
        foodProducing: true
      });
      insertCarePlan({
        subjectType: 'animal',
        subjectId: rex.id,
        kind: 'vaccination',
        title: 'Rabies vaccine',
        intervalDays: 365,
        nextDueOn: addDaysYmd(today, 5),
        leadDays: 14,
        provenance: 'manual'
      });
      insertCarePlan({
        subjectType: 'animal',
        subjectId: nanny.id,
        kind: 'deworm',
        title: 'Ivomec pour-on',
        intervalDays: 90,
        nextDueOn: addDaysYmd(today, 2),
        leadDays: 3,
        provenance: 'manual'
      });
    });
    revokeAssignment(ownerId, helper.userId);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
    const deps = {
      config,
      emailOrigin: 'https://app.cropcard.test',
      now: () => now,
      fetchImpl: fetchImpl as unknown as typeof fetch
    };
    const first = await runWithTenantAsync(ownerId, () => processOwnerAlerts(ownerId, deps));
    expect(first.alerts).toBe(2);
    const endpoints = fetchImpl.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(endpoints).toEqual([owner.b.endpoint]);
    expect(endpoints).not.toContain(helper.b.endpoint);
    expect(endpoints).not.toContain(inspector.b.endpoint);
    const init = (fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit;
    const payload = JSON.parse(
      decryptPayload(Buffer.from(init.body as Uint8Array), owner.b.priv, owner.b.auth).toString()
    );
    expect(payload.kind).toBe('animal-care-due');
    expect(payload.title).toBe('2 animal care jobs');
    expect(`${payload.title} ${payload.body}`).not.toMatch(/ivomec|rabies/i);
    expect(readOutbox(owner.email)).toHaveLength(1);
    expect(readOutbox(helper.email)).toHaveLength(0);
    expect(readOutbox(inspector.email)).toHaveLength(0);
    expect(readOutbox(owner.email)[0].body).not.toMatch(/ivomec|rabies/i);

    const second = await runWithTenantAsync(ownerId, () =>
      processOwnerAlerts(ownerId, { ...deps, now: () => now + 12 * HOUR })
    );
    expect(second.alerts).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const deliveries = runWithTenant(ownerId, () => listDeliveries());
    expect(deliveries.filter((d) => d.kind === 'animal-care-due')).toHaveLength(2);
    const care = runWithTenant(ownerId, () => listDeliveries()).map((d) => d.recipientCount);
    expect(care.every((n) => n === 2)).toBe(true);
  });
});
