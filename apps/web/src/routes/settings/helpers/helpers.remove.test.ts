// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ userId: '', ownerId: '' }));

vi.mock('$lib/server/auth', () => ({
  requireOwner: () => ({
    id: m.userId,
    role: 'owner',
    activeOwnerId: m.ownerId,
    email: null,
    impersonating: true
  })
}));

import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { addAssignment, usersForOwner } from '$lib/db/users';
import { farmTimeZone } from '$lib/db/userProfile';
import { actions } from './+page.server';

function form(userId: string) {
  const body = new FormData();
  body.set('userId', userId);
  return {
    request: new Request('http://localhost/settings/helpers?/remove', { method: 'POST', body })
  };
}

describe('/settings/helpers ?/remove (review round 7)', () => {
  it("an impersonating superadmin cannot remove the farm owner's assignment", async () => {
    const ownerId = `helpers-owner-${randomUUID()}`;
    const farmOwner = `helpers-farmer-${randomUUID()}`;
    const helper = `helpers-helper-${randomUUID()}`;
    m.ownerId = ownerId;
    m.userId = `helpers-superadmin-${randomUUID()}`;
    db.insert(owners).values({ id: ownerId, name: ownerId, slug: ownerId }).run();
    db.insert(users)
      .values([
        { id: farmOwner, email: `${farmOwner}@t.test`, timeZone: 'America/Chicago' },
        { id: helper, email: `${helper}@t.test` }
      ])
      .run();
    addAssignment({ ownerId, userId: farmOwner, roleWithinOwner: 'owner' });
    addAssignment({ ownerId, userId: helper, roleWithinOwner: 'helper' });

    const refused = await actions.remove(form(farmOwner) as never);
    expect(refused).toMatchObject({ status: 403 });
    expect(usersForOwner(ownerId).find((a) => a.userId === farmOwner)?.status).toBe('active');
    expect(runWithTenant(ownerId, () => farmTimeZone())).toBe('America/Chicago');

    expect(await actions.remove(form(helper) as never)).toEqual({ ok: true });
    expect(usersForOwner(ownerId).find((a) => a.userId === helper)?.status).toBe('revoked');
  });
});
