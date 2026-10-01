// @vitest-environment node
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('$lib/server/dbMaintenance', () => ({
  runDbMaintenance: vi.fn(async () => ({
    ran: false,
    skipped: 'recent',
    pruned: {},
    durationMs: 0
  }))
}));
import { db } from '$lib/db/client';
import { ledgerEntries, owners, tasks, taskTimeEntries, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync, tenantValues, withTenant } from '$lib/db/tenant';
import { addAssignment, revokeAssignment } from '$lib/db/users';
import { createTask } from '$lib/db/tasks';
import { createEquipment, updateEquipmentState } from '$lib/db/equipment';
import { listDeliveries, upsertSubscription } from '$lib/db/pushSubscriptions';
import { optIn, optOut } from '$lib/db/emailAlertConsents';
import { recordSuppression } from '$lib/db/contactSuppressions';
import { DEFAULT_PUSH_PREFS } from '$lib/push/prefs';
import { clearOutbox, readOutbox, type DigestEmail } from '$lib/server/email';
import { verifyUnsubscribeToken } from '$lib/server/emailUnsubscribe';
import { processOwnerAlerts, runPushTick } from './scheduler';
import { decryptPayload, generateVapidKeys } from './webPush';

const ORIGIN = 'https://app.cropcard.io';
const config = { ...generateVapidKeys(), subject: 'mailto:ops@cropcard.test' };
/** Monday 2026-09-28, 10:00 in New York. */
const MONDAY = Date.parse('2026-09-28T14:00:00Z');
const at = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);
const MONEY = /\$\s?\d/;

beforeEach(() => {
  vi.stubEnv('EMAIL_TRANSPORT', 'memory');
  clearOutbox();
});
afterEach(() => vi.unstubAllEnvs());

type Role = 'owner' | 'helper' | 'inspector' | 'custom-operator';

function seedOwner(billing: 'active' | 'suspended' = 'active') {
  const ownerId = `dg-owner-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: 'Hilltop Farm', slug: ownerId, billingStatus: billing })
    .run();
  return ownerId;
}

function seedUser(ownerId: string, role: Role, displayName?: string) {
  const userId = `dg-user-${randomUUID()}`;
  const email = `${userId}@digest.test`;
  db.insert(users)
    .values({ id: userId, email, displayName: displayName ?? null })
    .run();
  addAssignment({ ownerId, userId, roleWithinOwner: role });
  return { userId, email };
}

function addTask(
  ownerId: string,
  title: string,
  ymd: string,
  extra: { assignee?: string; category?: 'spray' | 'animal-care'; completedAt?: number } = {}
) {
  return runWithTenant(ownerId, () => {
    const t = createTask({ title, kind: 'primary', scheduledFor: at(ymd) });
    db.update(tasks)
      .set({
        assigneeUserId: extra.assignee ?? null,
        category: extra.category ?? null,
        completedAt: extra.completedAt ? new Date(extra.completedAt) : null
      })
      .where(withTenant(tasks, eq(tasks.id, t.id)))
      .run();
    return t.id;
  });
}

const emailIn = (ownerId: string, userId: string) =>
  runWithTenant(ownerId, () => optIn(userId, 'weekly-digest', { source: 'settings' }));

const tick = (ownerId: string, now = MONDAY, withPush = false, fetchImpl?: typeof fetch) =>
  runWithTenantAsync(ownerId, () =>
    processOwnerAlerts(ownerId, {
      config: withPush ? config : null,
      emailOrigin: ORIGIN,
      now: () => now,
      fetchImpl,
      frostAlerts: async () => []
    })
  );

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

function farm() {
  const ownerId = seedOwner();
  const owner = seedUser(ownerId, 'owner', 'Pat');
  const maria = seedUser(ownerId, 'helper', 'Maria');
  const sam = seedUser(ownerId, 'custom-operator', 'Sam');
  addTask(ownerId, 'Weed the onion bed', '2026-09-29', { assignee: maria.userId });
  addTask(ownerId, 'Fix the gate', '2026-09-30', { assignee: sam.userId });
  addTask(ownerId, 'Mulch garlic', '2026-10-01');
  addTask(ownerId, 'Glyphosate 32 oz per acre', '2026-10-02', {
    category: 'spray',
    assignee: maria.userId
  });
  addTask(ownerId, 'Overdue pruning', '2026-09-20', { assignee: maria.userId });
  addTask(ownerId, 'Deworm goats', '2026-09-30', { category: 'animal-care' });
  addTask(ownerId, 'Picked squash', '2026-09-23', {
    assignee: maria.userId,
    completedAt: Date.parse('2026-09-23T18:00:00Z')
  });
  runWithTenant(ownerId, () => {
    db.insert(ledgerEntries)
      .values(
        tenantValues({
          id: randomUUID(),
          kind: 'income' as const,
          occurredAt: new Date(Date.parse('2026-09-24T16:00:00Z')),
          amountCents: 12_345,
          category: 'produce sale'
        })
      )
      .run();
    db.insert(taskTimeEntries)
      .values(
        tenantValues({
          id: randomUUID(),
          userId: maria.userId,
          minutes: 90,
          startedAt: new Date(Date.parse('2026-09-23T16:30:00Z'))
        })
      )
      .run();
  });
  return { ownerId, owner, maria, sam };
}

describe('weekly digest on the push tick', () => {
  it('emails each opted-in member their own summary, once a week', async () => {
    const f = farm();
    emailIn(f.ownerId, f.owner.userId);
    emailIn(f.ownerId, f.maria.userId);

    const first = await tick(f.ownerId);
    expect(first.emailed).toBe(2);

    const [ownerMail] = readOutbox(f.owner.email);
    expect(ownerMail.subject).toBe('Your week of Mon Sep 28 · Hilltop Farm');
    expect(ownerMail.body).toContain('Tasks this week: 4');
    expect(ownerMail.body).toContain('Maria: 2 tasks');
    expect(ownerMail.body).toContain('Income: $123.45');
    expect(ownerMail.body).toContain('Deworm goats');
    expect(ownerMail.body).toContain('Spray task');
    expect(ownerMail.body).not.toMatch(/Glyphosate|32 oz/);
    expect(ownerMail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const { unsubscribe } = ownerMail.email as DigestEmail;
    expect(ownerMail.body).toContain(unsubscribe.pageUrl);
    const token = new URL(unsubscribe.oneClickUrl).searchParams.get('t');
    expect(verifyUnsubscribeToken(token)).toEqual({
      userId: f.owner.userId,
      ownerId: f.ownerId,
      scope: 'weekly-digest'
    });

    const [helperMail] = readOutbox(f.maria.email);
    expect(helperMail.body).toContain('Your tasks this week: 2');
    expect(helperMail.body).toContain('Weed the onion bed');
    expect(helperMail.body).not.toContain('Fix the gate');
    expect(helperMail.body).toContain('Overdue pruning');
    expect(helperMail.body).toContain('Your time logged: 1.5 h');
    expect(helperMail.body).toContain('Your tasks finished: 1');
    expect(helperMail.body).not.toMatch(MONEY);
    expect(helperMail.body).not.toMatch(/Income|Expenses/);

    const again = await tick(f.ownerId, MONDAY + 10.5 * 3_600_000);
    expect(again.emailed).toBe(0);
    expect(readOutbox(f.maria.email)).toHaveLength(1);
    const deliveries = runWithTenant(f.ownerId, () => listDeliveries()).filter(
      (d) => d.kind === 'weekly-digest'
    );
    expect(deliveries.map((d) => d.subjectId).sort()).toEqual(
      [`${f.owner.userId}:2026-09-28`, `${f.maria.userId}:2026-09-28`].sort()
    );
  });

  it('sends nothing to the opted-out, suppressed, revoked, inspectors or other-kind consents', async () => {
    const ownerId = seedOwner();
    const optedOut = seedUser(ownerId, 'helper');
    const suppressed = seedUser(ownerId, 'helper');
    const revoked = seedUser(ownerId, 'helper');
    const inspector = seedUser(ownerId, 'inspector');
    const otherKind = seedUser(ownerId, 'helper');
    addTask(ownerId, 'Something', '2026-09-29');
    for (const u of [optedOut, suppressed, revoked, inspector]) emailIn(ownerId, u.userId);
    runWithTenant(ownerId, () => {
      optOut(optedOut.userId, 'weekly-digest', { source: 'settings' });
      optIn(otherKind.userId, 'frost-tonight', { source: 'settings' });
    });
    recordSuppression({
      address: suppressed.email,
      channel: 'email',
      reason: 'unsubscribe',
      source: 'test'
    });
    revokeAssignment(ownerId, revoked.userId);

    const s = await tick(ownerId);
    expect(s.emailed).toBe(0);
    for (const u of [optedOut, suppressed, revoked, inspector, otherKind]) {
      expect(readOutbox(u.email)).toHaveLength(0);
    }
  });

  it('sends nothing outside Monday 10:00 UTC to Tuesday night, and never late', async () => {
    const f = farm();
    emailIn(f.ownerId, f.maria.userId);
    expect((await tick(f.ownerId, Date.parse('2026-09-28T09:30:00Z'))).emailed).toBe(0);
    expect((await tick(f.ownerId, Date.parse('2026-09-30T10:00:00Z'))).emailed).toBe(0);
    expect((await tick(f.ownerId, Date.parse('2026-09-29T20:30:00Z'))).emailed).toBe(1);
  });

  it('pushes a short money-free body to the person who turned it on', async () => {
    const f = farm();
    const b = browser();
    runWithTenant(f.ownerId, () => {
      upsertSubscription({
        userId: f.maria.userId,
        endpoint: b.endpoint,
        p256dh: b.p256dh,
        auth: b.authB64,
        prefs: { ...DEFAULT_PUSH_PREFS, 'weekly-digest': true }
      });
      const owners = browser();
      upsertSubscription({
        userId: f.owner.userId,
        endpoint: owners.endpoint,
        p256dh: owners.p256dh,
        auth: owners.authB64
      });
    });
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
    const s = await tick(f.ownerId, MONDAY, true, fetchImpl as unknown as typeof fetch);
    expect(s.sent).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(b.endpoint);
    const payload = JSON.parse(
      decryptPayload(Buffer.from(init.body as Uint8Array), b.priv, b.auth).toString()
    );
    expect(payload).toMatchObject({
      kind: 'weekly-digest',
      title: 'Monday summary',
      body: 'Your week: 2 tasks, 1 overdue, 1 animal care job',
      url: '/today'
    });
    expect(payload.body).not.toMatch(MONEY);
  });

  it("never mixes another farm's tasks in", async () => {
    const a = farm();
    const b = farm();
    addTask(b.ownerId, 'Secret farm B job', '2026-09-29');
    emailIn(a.ownerId, a.owner.userId);
    await tick(a.ownerId);
    const [mail] = readOutbox(a.owner.email);
    expect(mail.body).not.toContain('Secret farm B job');
    expect(mail.body).toContain('Tasks this week: 4');
  });

  it('a Pingram unsubscribe from one type leaves the other alone (F4-11)', async () => {
    const ownerId = seedOwner();
    const digestOnly = seedUser(ownerId, 'owner');
    const alertsOnly = seedUser(ownerId, 'helper');
    const untyped = seedUser(ownerId, 'helper');
    addTask(ownerId, 'Job', '2026-09-29');
    runWithTenant(ownerId, () => {
      const eq = createEquipment({ type: 'sprayer', label: 'Tank A' });
      updateEquipmentState(eq.id, {
        lastChemistryClass: 'insecticide-load',
        lastUsedAt: MONDAY - 2 * 3_600_000
      });
    });
    for (const u of [digestOnly, alertsOnly, untyped]) {
      emailIn(ownerId, u.userId);
      runWithTenant(ownerId, () => optIn(u.userId, 'decon-due', { source: 'settings' }));
    }
    const unsub = (address: string, notificationType: string | null) =>
      recordSuppression({
        address,
        channel: 'email',
        reason: 'unsubscribe',
        source: 'pingram-webhook',
        notificationType
      });
    unsub(digestOnly.email, 'weekly-digest');
    unsub(alertsOnly.email, 'field-alerts');
    unsub(untyped.email, null);

    await tick(ownerId);
    const subjects = (email: string) => readOutbox(email).map((m) => m.subject ?? '');
    expect(subjects(digestOnly.email)).toEqual([expect.stringMatching(/^Decon due/)]);
    expect(subjects(alertsOnly.email)).toEqual([expect.stringMatching(/^Your week of/)]);
    expect(subjects(untyped.email)).toEqual([]);
  });

  it('skips a suspended farm', async () => {
    const ownerId = seedOwner('suspended');
    const u = seedUser(ownerId, 'owner');
    addTask(ownerId, 'Job', '2026-09-29');
    emailIn(ownerId, u.userId);
    vi.stubEnv('ORIGIN', ORIGIN);
    await runPushTick({ config: null, emailOrigin: ORIGIN, now: () => MONDAY, owners: [ownerId] });
    expect(readOutbox(u.email)).toHaveLength(0);
  });
});
