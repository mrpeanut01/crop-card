import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { ownerSubscriptions, owners } from '$lib/db/schema';
import { unscopedQueryNote } from '$lib/db/tenant';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

export const BILLING_NOT_CONFIGURED = 'billing-not-configured';

export class BillingNotConfiguredError extends Error {
  constructor() {
    super(BILLING_NOT_CONFIGURED);
    this.name = 'BillingNotConfiguredError';
  }
}

export class StripeApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'StripeApiError';
  }
}

export interface BillingConfig {
  secretKey: string;
  priceId: string;
}

export function billingConfig(): BillingConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  const priceId = process.env.STRIPE_PRICE_ID?.trim();
  if (!secretKey || !priceId) return null;
  return { secretKey, priceId };
}

function requireSecretKey(): string {
  const cfg = billingConfig();
  if (!cfg) throw new BillingNotConfiguredError();
  return cfg.secretKey;
}

type FormParams = Record<string, string | number | undefined>;

export function formEncode(params: FormParams): string {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    body.append(k, String(v));
  }
  return body.toString();
}

function bodyDigest(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 16);
}

async function stripePost<T>(path: string, params: FormParams, idempotencyKey: string): Promise<T> {
  const secretKey = requireSecretKey();
  const res = await fetch(`${STRIPE_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': idempotencyKey
    },
    body: formEncode(params)
  });
  const payload = (await res.json().catch(() => null)) as
    | (T & { error?: { message?: string } })
    | null;
  if (!res.ok || !payload) {
    const msg = payload?.error?.message ?? `Stripe ${path} failed with ${res.status}`;
    throw new StripeApiError(msg, res.status);
  }
  return payload;
}

function readSubscriptionRow(ownerId: string) {
  unscopedQueryNote('owner_subscriptions is keyed by owner_id; ownerId is the caller-vetted owner');
  return db.select().from(ownerSubscriptions).where(eq(ownerSubscriptions.ownerId, ownerId)).get();
}

export interface BillingSummary {
  status: 'trial' | 'active' | 'past_due' | 'canceled' | 'suspended';
  planCode: string;
  periodEnd: number | null;
  hasCustomer: boolean;
  hasSubscription: boolean;
}

export function getBillingSummary(ownerId: string): BillingSummary | null {
  const row = readSubscriptionRow(ownerId);
  if (!row) return null;
  return {
    status: row.status,
    planCode: row.planCode,
    periodEnd: row.periodEnd ? row.periodEnd.getTime() : null,
    hasCustomer: !!row.stripeCustomerId,
    hasSubscription: !!row.stripeSubscriptionId
  };
}

export async function ensureStripeCustomer(
  ownerId: string,
  opts: { email?: string } = {}
): Promise<string> {
  const existing = readSubscriptionRow(ownerId);
  if (existing?.stripeCustomerId) return existing.stripeCustomerId;

  unscopedQueryNote('owners row lookup by id to label the Stripe customer');
  const owner = db.select().from(owners).where(eq(owners.id, ownerId)).get();
  if (!owner) throw new StripeApiError(`owner ${ownerId} not found`, 404);

  const params: FormParams = {
    name: owner.name,
    email: opts.email,
    'metadata[ownerId]': ownerId,
    'metadata[owner_id]': ownerId
  };
  const customer = await stripePost<{ id: string }>(
    '/customers',
    params,
    `cropcard:customer:${ownerId}:${bodyDigest(formEncode(params))}`
  );

  const now = new Date();
  unscopedQueryNote('persist Stripe customer id on the owner_subscriptions row keyed by owner_id');
  if (existing) {
    db.update(ownerSubscriptions)
      .set({ stripeCustomerId: customer.id, updatedAt: now })
      .where(
        and(eq(ownerSubscriptions.ownerId, ownerId), isNull(ownerSubscriptions.stripeCustomerId))
      )
      .run();
  } else {
    db.insert(ownerSubscriptions)
      .values({
        ownerId,
        status: owner.billingStatus,
        stripeCustomerId: customer.id,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoNothing()
      .run();
  }
  return readSubscriptionRow(ownerId)?.stripeCustomerId ?? customer.id;
}

export interface CheckoutUrls {
  successUrl: string;
  cancelUrl: string;
  email?: string;
}

function minuteBucket(nowMs: number): number {
  return Math.floor(nowMs / 60_000);
}

export async function createCheckoutSession(
  ownerId: string,
  priceId: string,
  urls: CheckoutUrls,
  nowMs = Date.now()
): Promise<{ id: string; url: string }> {
  const customer = await ensureStripeCustomer(ownerId, { email: urls.email });
  const params: FormParams = {
    mode: 'subscription',
    customer,
    client_reference_id: ownerId,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': 1,
    success_url: urls.successUrl,
    cancel_url: urls.cancelUrl,
    'metadata[ownerId]': ownerId,
    'metadata[owner_id]': ownerId,
    'subscription_data[metadata][ownerId]': ownerId,
    'subscription_data[metadata][owner_id]': ownerId
  };
  const session = await stripePost<{ id: string; url: string | null }>(
    '/checkout/sessions',
    params,
    `cropcard:checkout:${ownerId}:${bodyDigest(formEncode(params))}:${minuteBucket(nowMs)}`
  );
  if (!session.url) throw new StripeApiError('Stripe Checkout returned no url', 502);
  return { id: session.id, url: session.url };
}

export async function createBillingPortalSession(
  ownerId: string,
  returnUrl: string,
  nowMs = Date.now()
): Promise<{ id: string; url: string }> {
  const customer = await ensureStripeCustomer(ownerId);
  const params: FormParams = { customer, return_url: returnUrl };
  const session = await stripePost<{ id: string; url: string }>(
    '/billing_portal/sessions',
    params,
    `cropcard:portal:${ownerId}:${bodyDigest(formEncode(params))}:${minuteBucket(nowMs)}`
  );
  return { id: session.id, url: session.url };
}
