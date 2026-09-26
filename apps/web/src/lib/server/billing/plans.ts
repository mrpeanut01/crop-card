import { and, eq, gt, inArray, isNotNull, ne, or } from 'drizzle-orm';
import { db } from '$lib/db/client';
import {
  helperAssignments,
  helperInvites,
  ownerSubscriptions,
  owners,
  users
} from '$lib/db/schema';
import { unscopedQueryNote } from '$lib/db/tenant';
import {
  resolvePlanFrom,
  starterBoostWindowOpen,
  type PlanId,
  type ResolvedPlan
} from '$lib/billing/plans';

export type { ResolvedPlan } from '$lib/billing/plans';

const SEAT_ROLES = ['helper', 'custom-operator'] as const;

export const SEAT_LIMIT_MESSAGE =
  'Seat limit reached. Helpers already on the farm keep their access; a bigger plan adds more seats.';

function owningUserIds(ownerId: string): string[] {
  unscopedQueryNote('starter boost looks up the verified identities that own this farm');
  return db
    .select({ userId: helperAssignments.userId })
    .from(helperAssignments)
    .innerJoin(users, eq(users.id, helperAssignments.userId))
    .where(
      and(
        eq(helperAssignments.ownerId, ownerId),
        eq(helperAssignments.roleWithinOwner, 'owner'),
        eq(helperAssignments.status, 'active'),
        or(isNotNull(users.email), isNotNull(users.phone))
      )
    )
    .all()
    .map((r) => r.userId);
}

function boostClaimedElsewhere(ownerId: string, userIds: string[]): boolean {
  if (userIds.length === 0) return false;
  unscopedQueryNote(
    'starter boost is once per identity, so it checks every farm that identity owns'
  );
  const row = db
    .select({ id: owners.id })
    .from(owners)
    .innerJoin(helperAssignments, eq(helperAssignments.ownerId, owners.id))
    .where(
      and(
        ne(owners.id, ownerId),
        isNotNull(owners.starterBoostUsedAt),
        inArray(helperAssignments.userId, userIds),
        eq(helperAssignments.roleWithinOwner, 'owner')
      )
    )
    .get();
  return !!row;
}

function starterBoostEligible(
  ownerId: string,
  owner: { createdAt: Date; starterBoostUsedAt: Date | null },
  now: number
): boolean {
  if (owner.starterBoostUsedAt) return true;
  if (!starterBoostWindowOpen(owner.createdAt.getTime(), now)) return false;
  const userIds = owningUserIds(ownerId);
  if (userIds.length === 0) return false;
  if (boostClaimedElsewhere(ownerId, userIds)) return false;
  unscopedQueryNote('stamp the starter boost on this owner row, keyed by owner id');
  db.update(owners)
    .set({ starterBoostUsedAt: new Date(now) })
    .where(eq(owners.id, ownerId))
    .run();
  return true;
}

export function resolvePlan(ownerId: string, now = Date.now()): ResolvedPlan {
  unscopedQueryNote('plan resolution reads the owners + owner_subscriptions rows by owner id');
  const owner = db
    .select({
      createdAt: owners.createdAt,
      planOverride: owners.planOverride,
      starterBoostUsedAt: owners.starterBoostUsedAt
    })
    .from(owners)
    .where(eq(owners.id, ownerId))
    .get();
  if (!owner) {
    return resolvePlanFrom({
      planOverride: null,
      subscription: null,
      ownerCreatedAt: 0,
      boostEligible: false,
      now
    });
  }
  const sub = db
    .select({
      plan: ownerSubscriptions.planCode,
      status: ownerSubscriptions.status,
      pastDueSince: ownerSubscriptions.pastDueSince
    })
    .from(ownerSubscriptions)
    .where(eq(ownerSubscriptions.ownerId, ownerId))
    .get();
  const subscription = sub
    ? { plan: sub.plan, status: sub.status, pastDueSince: sub.pastDueSince?.getTime() ?? null }
    : null;
  const draft = resolvePlanFrom({
    planOverride: owner.planOverride,
    subscription,
    ownerCreatedAt: owner.createdAt.getTime(),
    boostEligible: false,
    now
  });
  if (draft.plan !== 'free' || !starterBoostWindowOpen(owner.createdAt.getTime(), now)) {
    return draft;
  }
  return resolvePlanFrom({
    planOverride: owner.planOverride,
    subscription,
    ownerCreatedAt: owner.createdAt.getTime(),
    boostEligible: starterBoostEligible(ownerId, owner, now),
    now
  });
}

export interface SeatUsage {
  used: number;
  activeHelpers: number;
  pendingInvites: number;
  limit: number;
  plan: PlanId;
  canInvite: boolean;
  overLimit: boolean;
}

/** Inspectors are read-only compliance access and never take a seat. */
export function seatUsage(ownerId: string, now = Date.now()): SeatUsage {
  const plan = resolvePlan(ownerId, now);
  unscopedQueryNote('seat count reads the assignments and invites of this owner by owner id');
  const activeHelpers = db
    .select({ userId: helperAssignments.userId })
    .from(helperAssignments)
    .where(
      and(
        eq(helperAssignments.ownerId, ownerId),
        eq(helperAssignments.status, 'active'),
        inArray(helperAssignments.roleWithinOwner, [...SEAT_ROLES])
      )
    )
    .all().length;
  const pendingInvites = db
    .select({ id: helperInvites.id })
    .from(helperInvites)
    .where(
      and(
        eq(helperInvites.ownerId, ownerId),
        eq(helperInvites.status, 'pending'),
        gt(helperInvites.expiresAt, new Date(now)),
        inArray(helperInvites.roleWithinOwner, [...SEAT_ROLES])
      )
    )
    .all().length;
  const used = activeHelpers + pendingInvites;
  const limit = plan.helperSeats;
  return {
    used,
    activeHelpers,
    pendingInvites,
    limit,
    plan: plan.plan,
    canInvite: used < limit,
    overLimit: used > limit
  };
}

export function roleTakesSeat(role: string): boolean {
  return (SEAT_ROLES as readonly string[]).includes(role);
}

export function setPlanOverride(ownerId: string, plan: PlanId | null): void {
  unscopedQueryNote('superadmin comps a plan on one owner row, keyed by owner id');
  db.update(owners).set({ planOverride: plan }).where(eq(owners.id, ownerId)).run();
}
