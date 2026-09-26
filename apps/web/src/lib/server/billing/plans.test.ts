import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { helperAssignments, helperInvites, owners, users } from '$lib/db/schema';
import { resolvePlan, roleTakesSeat, seatUsage, setPlanOverride } from './plans';

const DAY = 86_400_000;

function uid(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 10)}`;
}

function seedUser(opts: { email?: string | null; phone?: string | null } = {}): string {
  const id = uid('plan-user');
  db.insert(users)
    .values({
      id,
      email: opts.email === undefined ? `${id}@test` : opts.email,
      phone: opts.phone ?? null
    })
    .run();
  return id;
}

function seedOwner(opts: { createdAt?: number; ownerUserId?: string | null } = {}): string {
  const id = uid('plan-owner');
  db.insert(owners)
    .values({
      id,
      name: id,
      slug: id,
      billingStatus: 'active',
      createdAt: new Date(opts.createdAt ?? Date.now())
    })
    .run();
  if (opts.ownerUserId !== null) {
    const userId = opts.ownerUserId ?? seedUser();
    db.insert(helperAssignments)
      .values({ ownerId: id, userId, roleWithinOwner: 'owner', status: 'active' })
      .run();
  }
  return id;
}

function addMember(ownerId: string, role: 'helper' | 'inspector' | 'custom-operator'): void {
  db.insert(helperAssignments)
    .values({ ownerId, userId: seedUser(), roleWithinOwner: role, status: 'active' })
    .run();
}

function addInvite(
  ownerId: string,
  opts: { status?: 'pending' | 'revoked' | 'accepted'; expiresInMs?: number; role?: string } = {}
): void {
  db.insert(helperInvites)
    .values({
      id: uid('inv'),
      ownerId,
      emailHash: randomUUID(),
      tokenHash: randomUUID(),
      roleWithinOwner: (opts.role ?? 'helper') as 'helper',
      invitedByUserId: null,
      expiresAt: new Date(Date.now() + (opts.expiresInMs ?? DAY)),
      status: opts.status ?? 'pending',
      createdAt: new Date()
    })
    .run();
}

describe('resolvePlan starter boost', () => {
  it('gives a new farm with a verified owner $1.00 and stamps the claim', () => {
    const ownerId = seedOwner();
    const r = resolvePlan(ownerId);
    expect(r).toMatchObject({ plan: 'free', starterBoost: true, aiMonthlyUsd: 1 });
    const row = db.select().from(owners).where(eq(owners.id, ownerId)).get();
    expect(row?.starterBoostUsedAt).toBeInstanceOf(Date);
    expect(resolvePlan(ownerId).starterBoost).toBe(true);
  });

  it('is once per identity: a second farm by the same person gets the base budget', () => {
    const person = seedUser();
    const first = seedOwner({ ownerUserId: person });
    expect(resolvePlan(first).starterBoost).toBe(true);
    const second = seedOwner({ ownerUserId: person });
    expect(resolvePlan(second)).toMatchObject({ starterBoost: false, aiMonthlyUsd: 0.5 });
  });

  it('counts a phone-only identity as verified', () => {
    const ownerId = seedOwner({
      ownerUserId: seedUser({ email: null, phone: `+1555${Date.now() % 10_000_000}` })
    });
    expect(resolvePlan(ownerId).starterBoost).toBe(true);
  });

  it('skips farms older than 30 days and farms with no owning identity', () => {
    expect(resolvePlan(seedOwner({ createdAt: Date.now() - 31 * DAY })).starterBoost).toBe(false);
    expect(resolvePlan(seedOwner({ ownerUserId: null })).starterBoost).toBe(false);
  });

  it('an unknown owner resolves to Free without throwing', () => {
    expect(resolvePlan('owner-that-does-not-exist').plan).toBe('free');
  });

  it('a plan override applies immediately and can be cleared', () => {
    const ownerId = seedOwner({ createdAt: Date.now() - 60 * DAY });
    setPlanOverride(ownerId, 'farm');
    expect(resolvePlan(ownerId)).toMatchObject({ plan: 'farm', source: 'override' });
    setPlanOverride(ownerId, null);
    expect(resolvePlan(ownerId).plan).toBe('free');
  });
});

describe('seatUsage', () => {
  it('counts helpers and live invites, never inspectors or dead invites', () => {
    const ownerId = seedOwner();
    addMember(ownerId, 'helper');
    addMember(ownerId, 'inspector');
    addInvite(ownerId, { role: 'inspector' });
    addInvite(ownerId, { status: 'revoked' });
    addInvite(ownerId, { expiresInMs: -DAY });
    expect(seatUsage(ownerId)).toMatchObject({
      used: 1,
      activeHelpers: 1,
      pendingInvites: 0,
      limit: 2,
      canInvite: true
    });
    addInvite(ownerId);
    expect(seatUsage(ownerId)).toMatchObject({ used: 2, canInvite: false, overLimit: false });
  });

  it('grandfathers helpers over the limit after a downgrade and blocks only new invites', () => {
    const ownerId = seedOwner();
    setPlanOverride(ownerId, 'grower');
    for (let i = 0; i < 4; i++) addMember(ownerId, 'helper');
    expect(seatUsage(ownerId)).toMatchObject({ used: 4, limit: 5, canInvite: true });
    setPlanOverride(ownerId, 'free');
    const s = seatUsage(ownerId);
    expect(s).toMatchObject({ used: 4, limit: 2, canInvite: false, overLimit: true });
    const active = db
      .select()
      .from(helperAssignments)
      .where(eq(helperAssignments.ownerId, ownerId))
      .all()
      .filter((a) => a.roleWithinOwner === 'helper' && a.status === 'active');
    expect(active).toHaveLength(4);
  });

  it('only helpers and custom operators take a seat', () => {
    expect(roleTakesSeat('helper')).toBe(true);
    expect(roleTakesSeat('custom-operator')).toBe(true);
    expect(roleTakesSeat('inspector')).toBe(false);
  });
});
