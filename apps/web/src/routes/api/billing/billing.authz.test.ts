import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { ownerSubscriptions, owners } from '$lib/db/schema';
import type { SessionPayload, SessionRole } from '$lib/server/session';

let session: SessionPayload | null = null;

vi.mock('$lib/server/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/session')>();
  return { ...actual, readSession: () => session };
});

import { POST as checkoutPost } from './checkout/+server';
import { POST as portalPost } from './portal/+server';

function asRole(role: SessionRole, ownerId: string, impersonating = false) {
  session = {
    userId: 'user-billing',
    email: 'owner@example.com',
    phone: null,
    isSuperadmin: false,
    activeOwnerId: ownerId,
    activeRole: role,
    impersonating,
    exp: Date.now() + 60_000
  };
}

function makeEvent(body?: unknown) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cookies: { get: () => undefined } as any,
    locals: {},
    url: new URL('https://app.test/api/billing/checkout'),
    params: {},
    request: new Request('https://app.test/api/billing/checkout', {
      method: 'POST',
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

async function status(
  handler: typeof checkoutPost,
  body?: unknown
): Promise<{ status: number; body: unknown }> {
  try {
    const res = await handler(makeEvent(body));
    return { status: res.status, body: await res.json() };
  } catch (e) {
    const err = e as { status?: number; body?: unknown };
    if (typeof err.status === 'number') return { status: err.status, body: err.body };
    throw e;
  }
}

let ownerId: string;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
  if (url.endsWith('/customers')) return new Response(JSON.stringify({ id: 'cus_authz' }));
  if (url.endsWith('/checkout/sessions'))
    return new Response(JSON.stringify({ id: 'cs', url: 'https://checkout.stripe.com/c/cs' }));
  return new Response(JSON.stringify({ id: 'bps', url: 'https://billing.stripe.com/p/bps' }));
});

beforeEach(() => {
  ownerId = `billing-authz-${randomUUID().slice(0, 12)}`;
  db.insert(owners).values({ id: ownerId, name: 'Authz Farm', slug: ownerId }).run();
  db.insert(ownerSubscriptions).values({ ownerId, status: 'trial' }).run();
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_authz');
  vi.stubEnv('STRIPE_PRICE_ID', 'price_authz');
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  session = null;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe.each([
  ['checkout', checkoutPost, 'https://checkout.stripe.com/c/cs'],
  ['portal', portalPost, 'https://billing.stripe.com/p/bps']
] as const)('POST /api/billing/%s', (_name, handler, expectedUrl) => {
  it('401 when anonymous', async () => {
    session = null;
    expect((await status(handler)).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['helper', 'inspector'] as const)('403 for %s role', async (role) => {
    asRole(role, ownerId);
    expect((await status(handler)).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('403 while a superadmin is impersonating the owner', async () => {
    asRole('owner', ownerId, true);
    expect((await status(handler)).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('503 billing-not-configured when Stripe env is unset', async () => {
    asRole('owner', ownerId);
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const r = await status(handler);
    expect(r).toEqual({ status: 503, body: { error: 'billing-not-configured' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('200 with the hosted Stripe url for the owner', async () => {
    asRole('owner', ownerId);
    const r = await status(handler);
    expect(r).toEqual({ status: 200, body: { url: expectedUrl } });
  });

  it('502 when Stripe rejects the call', async () => {
    asRole('owner', ownerId);
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ error: { message: 'No such price' } }), { status: 400 })
    );
    const r = await status(handler);
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ error: 'stripe-error' });
  });
});

describe('checkout request wiring', () => {
  it('uses STRIPE_PRICE_ID and origin-relative return urls', async () => {
    asRole('owner', ownerId);
    await status(checkoutPost);
    const [, init] = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/checkout/sessions'))!;
    const form = new URLSearchParams(String((init as RequestInit).body));
    expect(form.get('line_items[0][price]')).toBe('price_authz');
    expect(form.get('success_url')).toBe('https://app.test/settings/billing?checkout=success');
    expect(form.get('cancel_url')).toBe('https://app.test/settings/billing?checkout=cancel');
    expect(form.get('client_reference_id')).toBe(ownerId);
  });
});

describe('checkout picks the price for the plan and period', () => {
  const PRICES = {
    STRIPE_PRICE_GROWER_MONTHLY: 'price_gm',
    STRIPE_PRICE_GROWER_ANNUAL: 'price_ga',
    STRIPE_PRICE_FARM_MONTHLY: 'price_fm',
    STRIPE_PRICE_FARM_ANNUAL: 'price_fa'
  };

  function sentPrice(): string | null {
    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/checkout/sessions'));
    if (!call) return null;
    return new URLSearchParams(String((call[1] as RequestInit).body)).get('line_items[0][price]');
  }

  it.each([
    [{ plan: 'grower', interval: 'month' }, 'price_gm'],
    [{ plan: 'grower', interval: 'year' }, 'price_ga'],
    [{ plan: 'farm', interval: 'month' }, 'price_fm'],
    [{ plan: 'farm', interval: 'year' }, 'price_fa'],
    [{ plan: 'farm' }, 'price_fa']
  ])('%o uses %s', async (body, price) => {
    for (const [k, v] of Object.entries(PRICES)) vi.stubEnv(k, v);
    asRole('owner', ownerId);
    const r = await status(checkoutPost, body);
    expect(r.status).toBe(200);
    expect(sentPrice()).toBe(price);
    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/checkout/sessions'));
    const form = new URLSearchParams(String((call![1] as RequestInit).body));
    expect(form.get('subscription_data[metadata][plan]')).toBe(body.plan);
  });

  it('400 for a plan that is not sold', async () => {
    asRole('owner', ownerId);
    const r = await status(checkoutPost, { plan: 'free' });
    expect(r).toEqual({ status: 400, body: { error: 'invalid-plan' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('503 plan-not-available when that price is not configured', async () => {
    asRole('owner', ownerId);
    const r = await status(checkoutPost, { plan: 'farm', interval: 'year' });
    expect(r).toEqual({ status: 503, body: { error: 'plan-not-available' } });
  });

  it('409 use-portal when the farm already has a live paid subscription', async () => {
    db.update(ownerSubscriptions)
      .set({ planCode: 'grower', status: 'active', stripeSubscriptionId: 'sub_live' })
      .where(eq(ownerSubscriptions.ownerId, ownerId))
      .run();
    asRole('owner', ownerId);
    const r = await status(checkoutPost, { plan: 'farm', interval: 'month' });
    expect(r).toEqual({ status: 409, body: { error: 'use-portal' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
