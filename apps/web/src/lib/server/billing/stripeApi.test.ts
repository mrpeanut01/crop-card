import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { ownerSubscriptions, owners } from '$lib/db/schema';
import {
  BillingNotConfiguredError,
  StripeApiError,
  billingConfig,
  createBillingPortalSession,
  createCheckoutSession,
  ensureStripeCustomer,
  getBillingSummary
} from './stripeApi';

interface Captured {
  url: string;
  headers: Record<string, string>;
  form: URLSearchParams;
}

let calls: Captured[] = [];
let responder: (url: string) => { status: number; body: unknown };

function freshOwner(withSubscriptionRow = true): string {
  const id = `stripe-api-${randomUUID().slice(0, 12)}`;
  db.insert(owners)
    .values({ id, name: `Farm ${id}`, slug: id, billingStatus: 'trial' })
    .run();
  if (withSubscriptionRow) {
    db.insert(ownerSubscriptions).values({ ownerId: id, status: 'trial' }).run();
  }
  return id;
}

function subRow(ownerId: string) {
  return db.select().from(ownerSubscriptions).where(eq(ownerSubscriptions.ownerId, ownerId)).get();
}

beforeEach(() => {
  calls = [];
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123');
  vi.stubEnv('STRIPE_PRICE_ID', 'price_solo');
  responder = (url) => {
    if (url.endsWith('/customers')) return { status: 200, body: { id: 'cus_new' } };
    if (url.endsWith('/checkout/sessions'))
      return { status: 200, body: { id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' } };
    if (url.endsWith('/billing_portal/sessions'))
      return { status: 200, body: { id: 'bps_1', url: 'https://billing.stripe.com/p/bps_1' } };
    return { status: 404, body: { error: { message: 'nope' } } };
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        headers: init.headers as Record<string, string>,
        form: new URLSearchParams(String(init.body))
      });
      const r = responder(url);
      return new Response(JSON.stringify(r.body), { status: r.status });
    })
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('billingConfig', () => {
  it('is null unless both STRIPE_SECRET_KEY and STRIPE_PRICE_ID are set', () => {
    expect(billingConfig()).toEqual({
      secretKey: 'sk_test_123',
      prices: {
        growerMonthly: 'price_solo',
        growerAnnual: null,
        farmMonthly: null,
        farmAnnual: null
      }
    });
    vi.stubEnv('STRIPE_PRICE_ID', '');
    expect(billingConfig()).toBeNull();
    vi.stubEnv('STRIPE_PRICE_ID', 'price_solo');
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    expect(billingConfig()).toBeNull();
  });

  it('throws BillingNotConfiguredError without calling Stripe', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const ownerId = freshOwner();
    await expect(ensureStripeCustomer(ownerId)).rejects.toBeInstanceOf(BillingNotConfiguredError);
    expect(calls).toHaveLength(0);
  });
});

describe('ensureStripeCustomer', () => {
  it('creates a customer with form-encoded owner metadata, Bearer auth and an idempotency key', async () => {
    const ownerId = freshOwner();
    const id = await ensureStripeCustomer(ownerId, { email: 'o@example.com' });
    expect(id).toBe('cus_new');
    expect(calls).toHaveLength(1);
    const c = calls[0];
    expect(c.url).toBe('https://api.stripe.com/v1/customers');
    expect(c.headers.Authorization).toBe('Bearer sk_test_123');
    expect(c.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(c.headers['Idempotency-Key']).toMatch(new RegExp(`^cropcard:customer:${ownerId}:`));
    expect(c.form.get('name')).toBe(`Farm ${ownerId}`);
    expect(c.form.get('email')).toBe('o@example.com');
    expect(c.form.get('metadata[ownerId]')).toBe(ownerId);
    expect(c.form.get('metadata[owner_id]')).toBe(ownerId);
    expect(subRow(ownerId)?.stripeCustomerId).toBe('cus_new');
  });

  it('is idempotent: a persisted customer id short-circuits the Stripe call', async () => {
    const ownerId = freshOwner();
    await ensureStripeCustomer(ownerId);
    await ensureStripeCustomer(ownerId);
    expect(calls).toHaveLength(1);
  });

  it('uses the same idempotency key for identical concurrent requests', async () => {
    const ownerId = freshOwner();
    const [a, b] = await Promise.all([
      ensureStripeCustomer(ownerId),
      ensureStripeCustomer(ownerId)
    ]);
    expect(a).toBe(b);
    expect(calls).toHaveLength(2);
    expect(calls[0].headers['Idempotency-Key']).toBe(calls[1].headers['Idempotency-Key']);
  });

  it('never overwrites a customer id already linked (e.g. by the webhook)', async () => {
    const ownerId = freshOwner();
    responder = () => {
      db.update(ownerSubscriptions)
        .set({ stripeCustomerId: 'cus_webhook' })
        .where(eq(ownerSubscriptions.ownerId, ownerId))
        .run();
      return { status: 200, body: { id: 'cus_racing' } };
    };
    expect(await ensureStripeCustomer(ownerId)).toBe('cus_webhook');
  });

  it('creates the owner_subscriptions row when the owner has none', async () => {
    const ownerId = freshOwner(false);
    await ensureStripeCustomer(ownerId);
    expect(subRow(ownerId)).toMatchObject({ stripeCustomerId: 'cus_new', status: 'trial' });
  });

  it('surfaces Stripe errors as StripeApiError and persists nothing', async () => {
    const ownerId = freshOwner();
    responder = () => ({ status: 401, body: { error: { message: 'Invalid API Key' } } });
    await expect(ensureStripeCustomer(ownerId)).rejects.toEqual(
      new StripeApiError('Invalid API Key', 401)
    );
    expect(subRow(ownerId)?.stripeCustomerId).toBeNull();
  });
});

describe('createCheckoutSession', () => {
  it('posts a subscription-mode session tied to the owner', async () => {
    const ownerId = freshOwner();
    const session = await createCheckoutSession(ownerId, 'price_solo', {
      successUrl: 'https://app.test/settings/billing?checkout=success',
      cancelUrl: 'https://app.test/settings/billing?checkout=cancel'
    });
    expect(session).toEqual({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' });
    const c = calls.find((x) => x.url.endsWith('/checkout/sessions'))!;
    expect(Object.fromEntries(c.form)).toEqual({
      mode: 'subscription',
      customer: 'cus_new',
      client_reference_id: ownerId,
      'line_items[0][price]': 'price_solo',
      'line_items[0][quantity]': '1',
      success_url: 'https://app.test/settings/billing?checkout=success',
      cancel_url: 'https://app.test/settings/billing?checkout=cancel',
      'metadata[ownerId]': ownerId,
      'metadata[owner_id]': ownerId,
      'subscription_data[metadata][ownerId]': ownerId,
      'subscription_data[metadata][owner_id]': ownerId
    });
    expect(c.headers['Idempotency-Key']).toMatch(new RegExp(`^cropcard:checkout:${ownerId}:`));
  });

  it('dedupes double-clicks within a minute but not across minutes', async () => {
    const ownerId = freshOwner();
    const urls = { successUrl: 'https://a/s', cancelUrl: 'https://a/c' };
    const t = 1_800_000_000_000;
    await createCheckoutSession(ownerId, 'price_solo', urls, t);
    await createCheckoutSession(ownerId, 'price_solo', urls, t + 5_000);
    await createCheckoutSession(ownerId, 'price_solo', urls, t + 120_000);
    const keys = calls
      .filter((x) => x.url.endsWith('/checkout/sessions'))
      .map((x) => x.headers['Idempotency-Key']);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });
});

describe('createBillingPortalSession', () => {
  it('posts customer + return_url and returns the portal url', async () => {
    const ownerId = freshOwner();
    const s = await createBillingPortalSession(ownerId, 'https://app.test/settings/billing');
    expect(s.url).toBe('https://billing.stripe.com/p/bps_1');
    const c = calls.find((x) => x.url.endsWith('/billing_portal/sessions'))!;
    expect(Object.fromEntries(c.form)).toEqual({
      customer: 'cus_new',
      return_url: 'https://app.test/settings/billing'
    });
    expect(c.headers['Idempotency-Key']).toMatch(new RegExp(`^cropcard:portal:${ownerId}:`));
  });
});

describe('getBillingSummary', () => {
  it('reports status + linkage flags from owner_subscriptions', async () => {
    const ownerId = freshOwner();
    expect(getBillingSummary(ownerId)).toMatchObject({
      status: 'trial',
      hasCustomer: false,
      hasSubscription: false
    });
    await ensureStripeCustomer(ownerId);
    expect(getBillingSummary(ownerId)?.hasCustomer).toBe(true);
    expect(getBillingSummary(freshOwner(false))).toBeNull();
  });
});
