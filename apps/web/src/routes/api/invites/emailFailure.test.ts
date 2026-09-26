import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import type { SessionPayload } from '$lib/server/session';

vi.mock('$lib/server/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/session')>();
  return {
    ...actual,
    readSession: (): SessionPayload => ({
      userId: 'user-inv',
      email: 'owner@example.test',
      phone: null,
      isSuperadmin: false,
      activeOwnerId: 'owner-inv',
      activeRole: 'owner',
      impersonating: false,
      exp: Date.now() + 60_000
    })
  };
});

vi.mock('$lib/server/invites', () => ({
  issueInvite: () => ({ id: 'inv-1', token: 'tok-1', expiresAt: Date.now() + 86_400_000 }),
  listInvitesForOwner: () => [],
  revokeInvite: () => true
}));

vi.mock('$lib/server/billing/plans', () => ({
  SEAT_LIMIT_MESSAGE: 'Seat limit reached.',
  roleTakesSeat: () => true,
  seatUsage: () => ({ used: 0, limit: 2, plan: 'free', canInvite: true, overLimit: false })
}));

vi.mock('$lib/db/client', () => {
  const chain = { from: () => chain, where: () => chain, get: () => ({ name: 'Test Farm' }) };
  return { db: { select: () => chain } };
});

let transportFails = false;
let dispatched = 0;
vi.mock('$lib/server/email', () => ({
  dispatchEmail: async () => {
    dispatched++;
    if (transportFails) throw new Error('Postmark dispatch failed: 422');
  }
}));

import { POST } from './+server';

function makeEvent(): RequestEvent {
  return {
    cookies: { get: () => undefined },
    locals: {},
    url: new URL('https://farm.example/api/invites'),
    request: new Request('https://farm.example/api/invites', {
      method: 'POST',
      body: JSON.stringify({ email: 'helper@example.test', role: 'helper' })
    })
  } as unknown as RequestEvent;
}

describe('POST /api/invites email dispatch', () => {
  beforeEach(() => {
    transportFails = false;
    dispatched = 0;
  });

  it('reports emailSent=true when the transport succeeds', async () => {
    const res = await POST(makeEvent() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.emailSent).toBe(true);
    expect(dispatched).toBe(1);
    expect(body.acceptUrl).toBe('https://farm.example/invite/tok-1');
  });

  it('still returns the accept URL (not a 500) when the transport throws', async () => {
    transportFails = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(makeEvent() as never);
    spy.mockRestore();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.emailSent).toBe(false);
    expect(dispatched).toBe(1);
    expect(body.acceptUrl).toBe('https://farm.example/invite/tok-1');
  });
});
