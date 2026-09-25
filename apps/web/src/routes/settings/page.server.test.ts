import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { helperAssignments, owners, users } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { load } from './+page.server';

function seedUser(prefix: string): string {
  const id = `${prefix}-${randomUUID().slice(0, 8)}`;
  db.insert(users)
    .values({ id, email: `${id}@test` })
    .run();
  return id;
}

describe('/settings index helper counts', () => {
  it('counts the owner separately from helpers and ignores revoked assignments', async () => {
    const ownerId = `sidx-owner-${randomUUID().slice(0, 8)}`;
    db.insert(owners)
      .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
      .run();
    const ownerUser = seedUser('sidx-o');
    const helperA = seedUser('sidx-h');
    const helperB = seedUser('sidx-h');
    const gone = seedUser('sidx-r');
    db.insert(helperAssignments)
      .values([
        { ownerId, userId: ownerUser, roleWithinOwner: 'owner', status: 'active' },
        { ownerId, userId: helperA, roleWithinOwner: 'helper', status: 'active' },
        { ownerId, userId: helperB, roleWithinOwner: 'inspector', status: 'active' },
        { ownerId, userId: gone, roleWithinOwner: 'helper', status: 'revoked' }
      ])
      .run();

    const data = (await runWithTenant(ownerId, () =>
      load({
        locals: { user: { id: ownerUser, role: 'owner', activeOwnerId: ownerId, email: null } }
      } as never)
    )) as { counts: { owners: number; helpers: number } };

    expect(data.counts.owners).toBe(1);
    expect(data.counts.helpers).toBe(2);
  });
});
