// @vitest-environment node
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { helperAssignments, owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { addAssignment } from '$lib/db/users';
import { insertAnimalGroup } from '$lib/db/animalGroups';
import { insertAnimal } from '$lib/db/animals';
import { insertHealthEvent } from '$lib/db/animalHealth';
import { deleteProductionLog, insertProductionLog } from '$lib/db/animalProduction';
import { insertStatusEvent } from '$lib/db/animalStatus';
import { listDeliveries, upsertSubscription } from '$lib/db/pushSubscriptions';
import { optIn } from '$lib/db/emailAlertConsents';
import { clearOutbox, readOutbox } from '$lib/server/email';
import { coveredRecordsHref } from '$lib/server/animalRecords';
import {
  ANIMAL_PUSH_KINDS,
  DEFAULT_PUSH_PREFS,
  OWNER_ONLY_PUSH_KINDS,
  PUSH_ALERT_LABELS,
  PUSH_KINDS_ADDED_LATER,
  parsePushPrefs
} from '$lib/push/prefs';
import { DEFAULT_EMAIL_ALERT_PREFS, EMAIL_ALERT_CATEGORIES } from '$lib/email/alertCategories';
import type { HoldFact, HoldBasis } from '$lib/safety/holdLedger';
import { batchMessage, holdCoversSaleAlerts } from './animalAlerts';
import { anOwnerWants, processOwnerAlerts } from './scheduler';
import { decryptPayload, generateVapidKeys } from './webPush';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const config = { ...generateVapidKeys(), subject: 'mailto:ops@cropcard.test' };

const production = (
  id: string,
  subjectId: string,
  over: Partial<Extract<HoldFact, { kind: 'production' }>> = {}
): HoldFact => ({
  kind: 'production',
  id,
  subjectType: 'group',
  subjectId,
  food: 'eggs',
  declaredUse: 'sale',
  occurredAtMs: 0,
  deleted: false,
  ...over
});

const status = (
  id: string,
  subjectId: string,
  over: Partial<{ deleted: boolean }> = {}
): HoldFact => ({
  kind: 'status',
  id,
  subjectType: 'animal',
  subjectId,
  status: 'slaughtered',
  declaresMeat: true,
  occurredAtMs: 0,
  deleted: over.deleted ?? false
});

const covered = (...ids: string[]) => ({
  covered: new Map<string, HoldBasis>(ids.map((id) => [id, 'unknown']))
});

describe('hold-covers-sale prefs (G3-06, G3-07, G3-08)', () => {
  it('is on by default, owner only, an animal kind, and on for devices saved before it', () => {
    expect(DEFAULT_PUSH_PREFS['hold-covers-sale']).toBe(true);
    expect(PUSH_KINDS_ADDED_LATER).not.toContain('hold-covers-sale');
    expect(OWNER_ONLY_PUSH_KINDS).toContain('hold-covers-sale');
    expect(ANIMAL_PUSH_KINDS).toContain('hold-covers-sale');
    const savedBefore = JSON.stringify({ 'decon-due': true, 'withdrawal-clears': false });
    expect(parsePushPrefs(savedBefore)['hold-covers-sale']).toBe(true);
    expect(parsePushPrefs(JSON.stringify({ 'hold-covers-sale': false }))['hold-covers-sale']).toBe(
      false
    );
  });

  it('is an email category that starts off', () => {
    expect(EMAIL_ALERT_CATEGORIES).toContain('hold-covers-sale');
    expect(DEFAULT_EMAIL_ALERT_PREFS['hold-covers-sale']).toBe(false);
  });

  it('has the ruled label and no em dashes', () => {
    expect(PUSH_ALERT_LABELS['hold-covers-sale']).toEqual({
      label: 'Hold now covers a sale',
      sub: 'A later record put egg, milk or meat records you already saved inside a hold. Owner only.'
    });
  });
});

describe('holdCoversSaleAlerts (G3-02, G3-04, G3-09)', () => {
  const labels = new Map([
    ['group:flock', 'Layers'],
    ['animal:steer', 'Steer'],
    ['group:goats', 'Goats']
  ]);

  it('names covered egg and milk logs and meat declarations, one alert each, owners only', () => {
    const facts: HoldFact[] = [
      production('l1', 'flock'),
      production('l2', 'flock', { declaredUse: 'food' }),
      status('s1', 'steer')
    ];
    const alerts = holdCoversSaleAlerts(
      covered('log:l1', 'log:l2', 'meat:s1'),
      { facts, labels },
      coveredRecordsHref
    );
    expect(alerts.map((a) => a.subjectId)).toEqual(['log:l1', 'log:l2', 'meat:s1']);
    for (const a of alerts) {
      expect(a.kind).toBe('hold-covers-sale');
      expect(a.audience).toEqual({ kind: 'owners-and', userIds: [] });
      expect(a.batchKey).toBe('hold-covers-sale');
    }
    expect(alerts[0]).toMatchObject({
      title: 'Check sales from Layers',
      body: '1 saved egg, milk or meat record is now inside a hold. If it was sold, tell the buyer.',
      url: '/animals/flock/log',
      batchSubject: 'group:flock'
    });
    expect(alerts[2].url).toBe('/animals/steer');
  });

  it('leaves out hay cuts, stays, harvests, deleted records and records nobody declared', () => {
    const facts: HoldFact[] = [
      production('gone', 'flock', { deleted: true }),
      production('never', 'flock', { declaredUse: null }),
      status('undone', 'steer', { deleted: true })
    ];
    const alerts = holdCoversSaleAlerts(
      covered(
        'log:gone',
        'log:never',
        'meat:undone',
        'hay:h1',
        'stay:s1',
        'harvest:x',
        'log:other'
      ),
      { facts, labels },
      coveredRecordsHref
    );
    expect(alerts).toEqual([]);
  });

  it('links a group with only meat covered to the group page', () => {
    const facts: HoldFact[] = [{ ...status('g1', 'goats'), subjectType: 'group' } as HoldFact];
    const [alert] = holdCoversSaleAlerts(covered('meat:g1'), { facts, labels }, coveredRecordsHref);
    expect(alert.url).toBe('/animals/groups/goats');
  });

  it('batches one subject into one count and several subjects into /today', () => {
    const facts: HoldFact[] = [
      production('l1', 'flock'),
      production('l2', 'flock'),
      production('l3', 'flock'),
      status('s1', 'steer')
    ];
    const all = holdCoversSaleAlerts(
      covered('log:l1', 'log:l2', 'log:l3', 'meat:s1'),
      { facts, labels },
      coveredRecordsHref
    );
    const flock = all.filter((a) => a.batchSubject === 'group:flock');
    expect(batchMessage(flock)).toEqual({
      title: 'Check sales from Layers',
      body: '3 saved egg, milk or meat records are now inside a hold. If any were sold, tell the buyer.',
      url: '/animals/flock/log'
    });
    expect(batchMessage(all)).toEqual({
      title: 'Check sales from Layers and 1 more',
      body: '4 saved egg, milk or meat records are now inside a hold. If any were sold, tell the buyer.',
      url: '/today'
    });
    for (const m of [batchMessage(flock), batchMessage(all)]) {
      expect(`${m.title} ${m.body}`).not.toMatch(/—|wormer|penicillin|\d{4}-\d{2}/i);
    }
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

describe('hold-covers-sale in the tick (G3-01, G3-05, G3-07, G3-08)', () => {
  beforeEach(() => {
    vi.stubEnv('EMAIL_TRANSPORT', 'memory');
    clearOutbox();
  });
  afterEach(() => vi.unstubAllEnvs());

  type Role = 'owner' | 'helper' | 'inspector';
  function seed(roles: Role[], opts: { emailOptIn?: boolean } = {}) {
    const ownerId = `covers-push-${randomUUID()}`;
    db.insert(owners)
      .values({ id: ownerId, name: 'Covers Farm', slug: ownerId, billingStatus: 'active' })
      .run();
    const members = roles.map((role) => {
      const userId = `covers-user-${randomUUID()}`;
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
        if (opts.emailOptIn !== false) {
          optIn(userId, 'hold-covers-sale', { source: 'settings', ip: null });
        }
      });
      return { role, userId, email: `${userId}@push.test`, b };
    });
    return { ownerId, members };
  }

  /** A flock with an egg sale two days ago, then a wormer with no known
   *  withdrawal recorded as given five days ago: the sale is now covered. */
  function coveredSale(now: number, name = 'Layers') {
    const group = insertAnimalGroup({
      name,
      speciesId: 'chicken',
      purpose: 'production',
      headCount: 6,
      foodProducing: true
    });
    const log = insertProductionLog({
      subjectType: 'group',
      subjectId: group.id,
      kind: 'eggs',
      quantity: 12,
      unit: 'eggs',
      occurredAt: now - 2 * DAY,
      use: 'sale',
      rulesVersion: 'test',
      performedById: null
    });
    insertHealthEvent({
      subjectType: 'group',
      subjectId: group.id,
      kind: 'deworm',
      productPluginId: null,
      productName: 'Secret Wormer',
      route: 'oral',
      administeredAt: now - 5 * DAY,
      courseEndAt: now - 5 * DAY,
      withdrawalClear: null,
      rulesVersion: 'test',
      foodProducingAtRecord: true,
      performedById: null
    });
    return { group, log };
  }

  function deps(now: number) {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
    return {
      fetchImpl,
      deps: {
        config,
        emailOrigin: 'https://app.cropcard.test',
        now: () => now,
        fetchImpl: fetchImpl as unknown as typeof fetch
      }
    };
  }

  const sentTo = (fetchImpl: ReturnType<typeof vi.fn>) =>
    fetchImpl.mock.calls.map((c) => String((c as unknown[])[0]));

  it('tells the owner once, never a helper or inspector, by push and opted-in email', async () => {
    const { ownerId, members } = seed(['owner', 'helper', 'inspector']);
    const [owner, helper, inspector] = members;
    const now = Date.now();
    const { group, log } = runWithTenant(ownerId, () => coveredSale(now));
    const { fetchImpl, deps: d } = deps(now);
    const first = await runWithTenantAsync(ownerId, () => processOwnerAlerts(ownerId, d));
    expect(first.alerts).toBe(1);
    expect(sentTo(fetchImpl)).toEqual([owner.b.endpoint]);
    const init = (fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit;
    const payload = JSON.parse(
      decryptPayload(Buffer.from(init.body as Uint8Array), owner.b.priv, owner.b.auth).toString()
    );
    expect(payload).toMatchObject({
      kind: 'hold-covers-sale',
      title: 'Check sales from Layers',
      url: `/animals/${group.id}/log`
    });
    expect(`${payload.title} ${payload.body}`).not.toMatch(/secret wormer/i);
    expect(readOutbox(owner.email)).toHaveLength(1);
    expect(readOutbox(owner.email)[0].body).not.toMatch(/secret wormer/i);
    expect(readOutbox(helper.email)).toHaveLength(0);
    expect(readOutbox(inspector.email)).toHaveLength(0);
    const delivered = runWithTenant(ownerId, () => listDeliveries()).filter(
      (x) => x.kind === 'hold-covers-sale'
    );
    expect(delivered.map((x) => x.subjectId)).toEqual([`log:${log.id}`]);

    const again = await runWithTenantAsync(ownerId, () =>
      processOwnerAlerts(ownerId, { ...d, now: () => now + 12 * HOUR })
    );
    expect(again.alerts).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends a newly covered record on a later tick, and skips a deleted one', async () => {
    const { ownerId } = seed(['owner'], { emailOptIn: false });
    const now = Date.now();
    const { fetchImpl, deps: d } = deps(now);
    runWithTenant(ownerId, () => coveredSale(now));
    await runWithTenantAsync(ownerId, () => processOwnerAlerts(ownerId, d));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const later = now + 12 * HOUR;
    runWithTenant(ownerId, () => {
      const second = coveredSale(later, 'Bantams');
      const third = coveredSale(later, 'Ducks');
      deleteProductionLog(third.log, { by: null, reason: 'mistake', tombstone: true });
      return second;
    });
    const next = await runWithTenantAsync(ownerId, () =>
      processOwnerAlerts(ownerId, { ...d, now: () => later })
    );
    expect(next.alerts).toBe(1);
    const subjects = runWithTenant(ownerId, () => listDeliveries())
      .filter((x) => x.kind === 'hold-covers-sale')
      .map((x) => x.subjectId);
    expect(subjects).toHaveLength(2);
  });

  it('re-checks roles at send: a demoted owner gets nothing and the record is not used up', async () => {
    const { ownerId, members } = seed(['owner', 'helper']);
    const [owner] = members;
    const now = Date.now();
    runWithTenant(ownerId, () => coveredSale(now));
    db.update(helperAssignments)
      .set({ roleWithinOwner: 'helper' })
      .where(
        and(eq(helperAssignments.ownerId, ownerId), eq(helperAssignments.userId, owner.userId))
      )
      .run();
    const { fetchImpl, deps: d } = deps(now);
    const tick = await runWithTenantAsync(ownerId, () => processOwnerAlerts(ownerId, d));
    expect(tick.alerts).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readOutbox(owner.email)).toHaveLength(0);
    expect(
      runWithTenant(ownerId, () => listDeliveries()).filter((x) => x.kind === 'hold-covers-sale')
    ).toEqual([]);

    db.update(helperAssignments)
      .set({ roleWithinOwner: 'owner' })
      .where(
        and(eq(helperAssignments.ownerId, ownerId), eq(helperAssignments.userId, owner.userId))
      )
      .run();
    const back = await runWithTenantAsync(ownerId, () => processOwnerAlerts(ownerId, d));
    expect(back.alerts).toBe(1);
    expect(sentTo(fetchImpl)).toEqual([owner.b.endpoint]);
  });

  it('a meat declaration covered later reaches the owner too', async () => {
    const { ownerId, members } = seed(['owner'], { emailOptIn: false });
    const now = Date.now();
    const steer = runWithTenant(ownerId, () => {
      const a = insertAnimal({
        speciesId: 'cattle',
        name: 'Steer',
        purpose: 'production',
        foodProducing: true
      });
      insertStatusEvent({
        subjectType: 'animal',
        subjectId: a.id,
        status: 'sold-for-meat',
        occurredAt: now - DAY,
        recordedById: null,
        rulesVersion: 'test'
      });
      insertHealthEvent({
        subjectType: 'animal',
        subjectId: a.id,
        kind: 'treatment',
        productPluginId: null,
        productName: 'Something',
        route: 'injection-im',
        administeredAt: now - 3 * DAY,
        courseEndAt: now - 3 * DAY,
        withdrawalClear: null,
        rulesVersion: 'test',
        foodProducingAtRecord: true,
        performedById: null
      });
      return a;
    });
    const { fetchImpl, deps: d } = deps(now);
    await runWithTenantAsync(ownerId, () => processOwnerAlerts(ownerId, d));
    expect(sentTo(fetchImpl)).toEqual([members[0].b.endpoint]);
    const init = (fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit;
    const payload = JSON.parse(
      decryptPayload(
        Buffer.from(init.body as Uint8Array),
        members[0].b.priv,
        members[0].b.auth
      ).toString()
    );
    expect(payload).toMatchObject({ title: 'Check sales from Steer', url: `/animals/${steer.id}` });
  });

  it('only an owner device or owner opt-in makes the tick look', () => {
    const members = [
      { userId: 'o', roleWithinOwner: 'owner', status: 'active' },
      { userId: 'h', roleWithinOwner: 'helper', status: 'active' }
    ];
    const { ownerId } = seed(['helper']);
    runWithTenant(ownerId, () => {
      expect(anOwnerWants('hold-covers-sale', { config, emailOrigin: null }, members)).toBe(false);
      expect(anOwnerWants('hold-covers-sale', { config, emailOrigin: null }, [])).toBe(false);
    });
  });
});
