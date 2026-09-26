// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { addAssignment } from '$lib/db/users';
import { createEquipment, updateEquipmentState } from '$lib/db/equipment';
import { listDeliveries } from '$lib/db/pushSubscriptions';
import { optIn, optOut } from '$lib/db/emailAlertConsents';
import { recordSuppression } from '$lib/db/contactSuppressions';
import { EMAIL_ALERT_CATEGORIES, type EmailAlertCategory } from '$lib/email/alertCategories';
import { clearOutbox, readOutbox } from '$lib/server/email';
import { verifyUnsubscribeToken } from '$lib/server/emailUnsubscribe';
import { emailAlertOrigin, selectEmailRecipients, type ConsentKey } from './emailAlerts';
import {
  ownerIdsToVisit,
  processOwnerAlerts,
  runPushTick,
  shouldRunPushScheduler
} from './scheduler';
import type { PushAudience } from './triggers';

const ORIGIN = 'https://app.cropcard.io';
const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  vi.stubEnv('EMAIL_TRANSPORT', 'memory');
  clearOutbox();
});
afterEach(() => vi.unstubAllEnvs());

type Role = 'owner' | 'helper' | 'inspector';

function seedOwner(billing: 'active' | 'suspended' = 'active') {
  const ownerId = `mail-owner-${randomUUID()}`;
  db.insert(owners)
    .values({
      id: ownerId,
      name: `Farm ${ownerId.slice(-4)}`,
      slug: ownerId,
      billingStatus: billing
    })
    .run();
  return ownerId;
}

function seedUser(ownerId: string, role: Role = 'owner', email: string | null = undefined!) {
  const userId = `mail-user-${randomUUID()}`;
  db.insert(users)
    .values({
      id: userId,
      email: email === null ? null : (email ?? `${userId}@mail.test`),
      phone:
        email === null ? `+1571${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}` : null
    })
    .run();
  addAssignment({ ownerId, userId, roleWithinOwner: role });
  return { userId, email: email === null ? null : (email ?? `${userId}@mail.test`) };
}

function dirtySprayer(ownerId: string, lastSprayedAt: number) {
  runWithTenant(ownerId, () => {
    const eq = createEquipment({ type: 'sprayer', label: 'Tank A' });
    updateEquipmentState(eq.id, {
      lastChemistryClass: 'insecticide-load',
      lastUsedAt: lastSprayedAt
    });
  });
}

const consentIn = (ownerId: string, userId: string, c: EmailAlertCategory) =>
  runWithTenant(ownerId, () => optIn(userId, c, { source: 'settings', ip: '203.0.113.9' }));

describe('selectEmailRecipients (pure)', () => {
  const roleArb = fc.constantFrom('owner', 'helper', 'inspector', 'custom-operator');
  const memberArb = fc.record({
    userId: fc.constantFrom('u1', 'u2', 'u3', 'u4', 'u5'),
    roleWithinOwner: roleArb,
    status: fc.constantFrom('active', 'revoked')
  });
  const consentArb = fc.record({
    userId: fc.constantFrom('u1', 'u2', 'u3', 'u4', 'u5', 'stranger'),
    category: fc.constantFrom(...EMAIL_ALERT_CATEGORIES)
  });
  const audienceArb: fc.Arbitrary<PushAudience> = fc.oneof(
    fc.constant({ kind: 'all' as const }),
    fc.record({
      kind: fc.constant('owners-and' as const),
      userIds: fc.subarray(['u1', 'u2', 'u3', 'u4', 'u5'])
    })
  );

  it('no user is ever emailed without an opt-in for that exact category', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(memberArb, { selector: (m) => m.userId, maxLength: 5 }),
        fc.array(consentArb, { maxLength: 12 }),
        fc.constantFrom(...EMAIL_ALERT_CATEGORIES),
        audienceArb,
        fc.subarray(['u1@x.test', 'u2@x.test', 'u3@x.test']),
        (members, consents, kind, audience, suppressed) => {
          const emails = new Map(
            ['u1', 'u2', 'u3', 'u4', 'u5'].map((u) => [u, u === 'u5' ? null : `${u}@x.test`])
          );
          const out = selectEmailRecipients({
            members,
            emails,
            consents,
            isSuppressed: (e) => suppressed.includes(e),
            alert: { kind, audience }
          });
          for (const r of out) {
            expect(consents.some((c) => c.userId === r.userId && c.category === kind)).toBe(true);
            const m = members.find((x) => x.userId === r.userId && x.status === 'active');
            expect(m).toBeTruthy();
            expect(m!.roleWithinOwner).not.toBe('inspector');
            expect(suppressed).not.toContain(r.email);
            expect(r.email).toBe(emails.get(r.userId));
            if (audience.kind === 'owners-and' && m!.roleWithinOwner !== 'owner') {
              expect(audience.userIds).toContain(r.userId);
            }
          }
        }
      )
    );
  });

  it('with no consents at all, nobody gets email for any category', () => {
    fc.assert(
      fc.property(
        fc.array(memberArb),
        fc.constantFrom(...EMAIL_ALERT_CATEGORIES),
        (members, kind) => {
          const emails = new Map(members.map((m) => [m.userId, `${m.userId}@x.test`]));
          const consents: ConsentKey[] = [];
          expect(
            selectEmailRecipients({
              members,
              emails,
              consents,
              isSuppressed: () => false,
              alert: { kind, audience: { kind: 'all' } }
            })
          ).toEqual([]);
        }
      )
    );
  });
});

describe('email channel in the alert scheduler', () => {
  it('emails only users who opted in to that alert, once, with working unsubscribe links', async () => {
    const ownerId = seedOwner();
    const owner = seedUser(ownerId, 'owner');
    const helper = seedUser(ownerId, 'helper');
    const other = seedUser(ownerId, 'helper');
    const inspector = seedUser(ownerId, 'inspector');
    consentIn(ownerId, owner.userId, 'decon-due');
    consentIn(ownerId, helper.userId, 'lock-window-closing');
    consentIn(ownerId, inspector.userId, 'decon-due');
    const now = Date.now();
    dirtySprayer(ownerId, now - 2 * HOUR);

    const s = await runWithTenantAsync(ownerId, () =>
      processOwnerAlerts(ownerId, { config: null, emailOrigin: ORIGIN, now: () => now })
    );
    expect(s).toMatchObject({ alerts: 1, sent: 0, emailed: 1, emailFailed: 0 });
    expect(readOutbox(owner.email!)).toHaveLength(1);
    expect(readOutbox(helper.email!)).toHaveLength(0);
    expect(readOutbox(other.email!)).toHaveLength(0);
    expect(readOutbox(inspector.email!)).toHaveLength(0);

    const [mail] = readOutbox(owner.email!);
    expect(mail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const t = new URL(mail.headers['List-Unsubscribe'].slice(1, -1)).searchParams.get('t');
    expect(verifyUnsubscribeToken(t)).toEqual({
      userId: owner.userId,
      ownerId,
      scope: 'decon-due'
    });
    expect(mail.body).toContain(`${ORIGIN}/spray/decon`);
    expect(runWithTenant(ownerId, () => listDeliveries())[0]).toMatchObject({
      kind: 'decon-due',
      recipientCount: 1
    });

    await runWithTenantAsync(ownerId, () =>
      processOwnerAlerts(ownerId, { config: null, emailOrigin: ORIGIN, now: () => now + HOUR })
    );
    expect(readOutbox(owner.email!)).toHaveLength(1);
  });

  it('sends nothing after an opt-out, a provider unsubscribe, or without an email address', async () => {
    const ownerId = seedOwner();
    const a = seedUser(ownerId, 'owner');
    const b = seedUser(ownerId, 'owner');
    const c = seedUser(ownerId, 'owner', null);
    for (const u of [a, b, c]) consentIn(ownerId, u.userId, 'decon-due');
    runWithTenant(ownerId, () => optOut(a.userId, 'decon-due', { source: 'settings' }));
    recordSuppression({
      address: b.email!.toUpperCase(),
      channel: 'email',
      reason: 'unsubscribe',
      source: 'pingram-webhook'
    });
    const now = Date.now();
    dirtySprayer(ownerId, now - 2 * HOUR);
    const s = await runWithTenantAsync(ownerId, () =>
      processOwnerAlerts(ownerId, { config: null, emailOrigin: ORIGIN, now: () => now })
    );
    expect(s.emailed).toBe(0);
    expect(readOutbox()).toHaveLength(0);
  });

  it('sends no email when the scheduler has no email origin', async () => {
    const ownerId = seedOwner();
    const u = seedUser(ownerId);
    consentIn(ownerId, u.userId, 'decon-due');
    const now = Date.now();
    dirtySprayer(ownerId, now - 2 * HOUR);
    await runWithTenantAsync(ownerId, () =>
      processOwnerAlerts(ownerId, { config: null, emailOrigin: null, now: () => now })
    );
    expect(readOutbox(u.email!)).toHaveLength(0);
  });

  it('runPushTick visits email-only farms, never crosses farms and skips suspended ones', async () => {
    const a = seedOwner();
    const b = seedOwner();
    const s = seedOwner('suspended');
    const ua = seedUser(a);
    const ub = seedUser(b);
    const us = seedUser(s);
    consentIn(a, ua.userId, 'decon-due');
    consentIn(b, ub.userId, 'decon-due');
    consentIn(s, us.userId, 'decon-due');
    const now = Date.now();
    dirtySprayer(a, now - 2 * HOUR);
    dirtySprayer(s, now - 2 * HOUR);
    expect(ownerIdsToVisit({ config: null, emailOrigin: ORIGIN })).toEqual(
      expect.arrayContaining([a, b, s])
    );
    expect(ownerIdsToVisit({ config: null, emailOrigin: null })).toEqual([]);
    await runPushTick({ config: null, emailOrigin: ORIGIN, now: () => now });
    expect(readOutbox(ua.email!)).toHaveLength(1);
    expect(readOutbox(ub.email!)).toHaveLength(0);
    expect(readOutbox(us.email!)).toHaveLength(0);
  });
});

describe('email alert configuration', () => {
  it('needs a real transport and ORIGIN, and can be switched off', () => {
    expect(
      emailAlertOrigin({ EMAIL_TRANSPORT: 'pingram', ORIGIN: 'https://app.cropcard.io/' })
    ).toBe('https://app.cropcard.io');
    expect(emailAlertOrigin({ EMAIL_TRANSPORT: 'pingram' })).toBeNull();
    expect(emailAlertOrigin({ EMAIL_TRANSPORT: 'none', ORIGIN })).toBeNull();
    expect(
      emailAlertOrigin({ EMAIL_TRANSPORT: 'pingram', ORIGIN, EMAIL_ALERTS: 'off' })
    ).toBeNull();
    expect(emailAlertOrigin({ EMAIL_TRANSPORT: 'pingram', ORIGIN: 'not a url' })).toBeNull();
  });

  it('the scheduler runs for email alone, but never under tests', () => {
    const env = { EMAIL_TRANSPORT: 'pingram', ORIGIN };
    expect(shouldRunPushScheduler({ ...env, NODE_ENV: 'production' })).toBe(true);
    expect(shouldRunPushScheduler({ ...env, NODE_ENV: 'test' })).toBe(false);
    expect(shouldRunPushScheduler({ ...env, PUSH_SCHEDULER: 'off' })).toBe(false);
  });
});
