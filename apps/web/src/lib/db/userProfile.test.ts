import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from './client';
import { helperAssignments, owners, users } from './schema';
import {
  avatarVersion,
  canViewAvatar,
  deleteAvatar,
  getAvatar,
  profileFor,
  saveAvatar,
  updateProfile
} from './userProfile';

function seedUser(): string {
  const id = `profile-${randomUUID()}`;
  db.insert(users)
    .values({ id, email: `${id}@profile.test` })
    .run();
  return id;
}

function seedOwner(): string {
  const id = `profile-owner-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

function assign(ownerId: string, userId: string, status: 'active' | 'revoked' = 'active') {
  db.insert(helperAssignments)
    .values({ ownerId, userId, roleWithinOwner: 'helper', status, acceptedAt: new Date() })
    .run();
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe('userProfile repo', () => {
  it('stores the profile fields and clears the display name', () => {
    const u = seedUser();
    const fresh = db.select().from(users).where(eq(users.id, u)).get();
    expect(fresh?.timeZone).toBe('America/New_York');
    expect(fresh?.displayUnits).toBe('us');

    updateProfile(u, {
      displayName: 'Dale Ridge',
      timeZone: 'America/Chicago',
      displayUnits: 'metric'
    });
    expect(profileFor(u).displayName).toBe('Dale Ridge');
    const row = db.select().from(users).where(eq(users.id, u)).get();
    expect(row?.timeZone).toBe('America/Chicago');
    expect(row?.displayUnits).toBe('metric');
    expect(row?.email).toBe(`${u}@profile.test`);

    updateProfile(u, { displayName: null, timeZone: 'UTC', displayUnits: 'us' });
    expect(profileFor(u).displayName).toBeNull();
  });

  it('replaces the avatar in place and versions the URL', () => {
    const u = seedUser();
    expect(profileFor(u).avatarUrl).toBeNull();
    const v1 = saveAvatar(u, 'image/jpeg', JPEG);
    expect(profileFor(u).avatarUrl).toBe(`/api/account/avatar/${u}?v=${v1}`);
    saveAvatar(u, 'image/png', Buffer.from([0x89, 0x50]));
    expect(getAvatar(u)?.mime).toBe('image/png');
    deleteAvatar(u);
    expect(getAvatar(u)).toBeNull();
    expect(avatarVersion(u)).toBeNull();
  });

  it('shows a picture only to its owner and active members of a shared farm', () => {
    const [subject, farmmate, stranger, revoked] = [seedUser(), seedUser(), seedUser(), seedUser()];
    const farm = seedOwner();
    const otherFarm = seedOwner();
    assign(farm, subject);
    assign(farm, farmmate);
    assign(otherFarm, stranger);
    assign(farm, revoked, 'revoked');

    expect(canViewAvatar(subject, subject)).toBe(true);
    expect(canViewAvatar(farmmate, subject)).toBe(true);
    expect(canViewAvatar(stranger, subject)).toBe(false);
    expect(canViewAvatar(revoked, subject)).toBe(false);
  });

  it('deleting the user removes the picture', () => {
    const u = seedUser();
    saveAvatar(u, 'image/jpeg', JPEG);
    db.delete(users).where(eq(users.id, u)).run();
    expect(getAvatar(u)).toBeNull();
  });
});
