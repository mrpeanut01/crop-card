import { and, eq, inArray } from 'drizzle-orm';
import { db } from './client';
import { helperAssignments, userAvatars, users } from './schema';
import { unscopedQueryNote } from './tenant';
import type { AvatarMime } from '$lib/profile';

export function setDisplayName(userId: string, displayName: string | null): void {
  db.update(users).set({ displayName }).where(eq(users.id, userId)).run();
}

export function avatarVersion(userId: string): number | null {
  const row = db
    .select({ updatedAt: userAvatars.updatedAt })
    .from(userAvatars)
    .where(eq(userAvatars.userId, userId))
    .get();
  return row ? row.updatedAt.getTime() : null;
}

export function avatarVersions(userIds: string[]): Map<string, number> {
  if (userIds.length === 0) return new Map();
  const rows = db
    .select({ userId: userAvatars.userId, updatedAt: userAvatars.updatedAt })
    .from(userAvatars)
    .where(inArray(userAvatars.userId, userIds))
    .all();
  return new Map(rows.map((r) => [r.userId, r.updatedAt.getTime()]));
}

export function avatarUrl(userId: string, version: number | null | undefined): string | null {
  return version ? `/api/account/avatar/${encodeURIComponent(userId)}?v=${version}` : null;
}

export function getAvatar(
  userId: string
): { mime: AvatarMime; data: Buffer; updatedAt: Date } | null {
  return (
    db
      .select({ mime: userAvatars.mime, data: userAvatars.data, updatedAt: userAvatars.updatedAt })
      .from(userAvatars)
      .where(eq(userAvatars.userId, userId))
      .get() ?? null
  );
}

export function saveAvatar(userId: string, mime: AvatarMime, data: Buffer): number {
  const updatedAt = new Date();
  db.insert(userAvatars)
    .values({ userId, mime, data, updatedAt })
    .onConflictDoUpdate({ target: userAvatars.userId, set: { mime, data, updatedAt } })
    .run();
  return updatedAt.getTime();
}

export function deleteAvatar(userId: string): void {
  db.delete(userAvatars).where(eq(userAvatars.userId, userId)).run();
}

/** A picture is visible to its owner and to anyone holding an active
 *  assignment on a farm the subject is also active on. */
export function canViewAvatar(viewerId: string, subjectId: string): boolean {
  if (viewerId === subjectId) return true;
  unscopedQueryNote('avatar visibility compares farm memberships across tenants');
  const viewerOwners = db
    .select({ ownerId: helperAssignments.ownerId })
    .from(helperAssignments)
    .where(and(eq(helperAssignments.userId, viewerId), eq(helperAssignments.status, 'active')))
    .all()
    .map((r) => r.ownerId);
  if (viewerOwners.length === 0) return false;
  const shared = db
    .select({ ownerId: helperAssignments.ownerId })
    .from(helperAssignments)
    .where(
      and(
        eq(helperAssignments.userId, subjectId),
        eq(helperAssignments.status, 'active'),
        inArray(helperAssignments.ownerId, viewerOwners)
      )
    )
    .get();
  return !!shared;
}

/** The chosen name and picture URL for the app chrome. */
export function profileFor(userId: string): {
  displayName: string | null;
  avatarUrl: string | null;
} {
  const row = db
    .select({ displayName: users.displayName, avatarAt: userAvatars.updatedAt })
    .from(users)
    .leftJoin(userAvatars, eq(userAvatars.userId, users.id))
    .where(eq(users.id, userId))
    .get();
  return {
    displayName: row?.displayName ?? null,
    avatarUrl: avatarUrl(userId, row?.avatarAt?.getTime())
  };
}
