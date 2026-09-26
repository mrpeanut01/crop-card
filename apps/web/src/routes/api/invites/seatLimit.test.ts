import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import { helperAssignments, owners, users } from '$lib/db/schema';
import type { SessionPayload } from '$lib/server/session';

let session: SessionPayload | null = null;

vi.mock('$lib/server/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/session')>();
  return { ...actual, readSession: () => session };
});

vi.mock('$lib/server/email', () => ({ dispatchEmail: async () => undefined }));

import { POST } from './+server';

function seedFarm(plan: 'grower' | null): { ownerId: string; userId: string } {
  const ownerId = `seat-owner-${randomUUID().slice(0, 10)}`;
  const userId = `seat-user-${randomUUID().slice(0, 10)}`;
  db.insert(owners).values({ id: ownerId, name: ownerId, slug: ownerId, planOverride: plan }).run();
  db.insert(users)
    .values({ id: userId, email: `${userId}@test` })
    .run();
  db.insert(helperAssignments)
    .values({ ownerId, userId, roleWithinOwner: 'owner', status: 'active' })
    .run();
  session = {
    userId,
    email: `${userId}@test`,
    phone: null,
    isSuperadmin: false,
    activeOwnerId: ownerId,
    activeRole: 'owner',
    impersonating: false,
    exp: Date.now() + 60_000
  };
  return { ownerId, userId };
}

async function invite(role = 'helper'): Promise<Response> {
  return POST({
    cookies: { get: () => undefined },
    locals: {},
    url: new URL('https://farm.example/api/invites'),
    request: new Request('https://farm.example/api/invites', {
      method: 'POST',
      body: JSON.stringify({ email: `h-${randomUUID().slice(0, 6)}@example.test`, role })
    })
  } as unknown as RequestEvent);
}

describe('POST /api/invites seat limit', () => {
  it('Free allows two helper seats, then refuses with a seat-limit error', async () => {
    seedFarm(null);
    expect((await invite()).status).toBe(200);
    expect((await invite()).status).toBe(200);
    const third = await invite();
    expect(third.status).toBe(409);
    expect(await third.json()).toMatchObject({ error: 'seat-limit', used: 2, limit: 2 });
  });

  it('inspectors never take a seat', async () => {
    seedFarm(null);
    await invite();
    await invite();
    expect((await invite('inspector')).status).toBe(200);
  });

  it('Grower allows five', async () => {
    seedFarm('grower');
    for (let i = 0; i < 5; i++) expect((await invite()).status).toBe(200);
    expect((await invite()).status).toBe(409);
  });
});
