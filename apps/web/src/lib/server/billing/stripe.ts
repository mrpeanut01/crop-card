/**
 * Stripe billing scaffold (Sprint 21 / Phase 21 launch readiness).
 *
 * Minimal viable Stripe surface for v1 launch:
 *   - verifyWebhookSignature() — verifies Stripe-Signature headers using
 *     the v1 scheme (HMAC-SHA256 over timestamped payload).
 *   - applyWebhookEvent() — small dispatcher that maps the Stripe event
 *     types we care about onto the existing owner_subscriptions row.
 *
 * Not in scope (deferred to a launch-followup sprint):
 *   - Stripe.customers.create() on Owner provision.
 *   - Stripe.subscriptions.create() / update() server-side calls.
 *   - The full Stripe Elements payment-method UI on /settings/billing.
 *
 * Rationale: the webhook receiver is the safety-critical piece (Stripe
 * pushes state changes; we must converge on them). Customer + Subscription
 * creation can happen via Stripe Checkout (hosted) in v1 — no client
 * library required. When Phase 28 adds Stripe Elements for in-app
 * payment-method editing, extend this module with the create-call
 * helpers and an integration test.
 *
 * Stripe SDK intentionally NOT installed yet — we read JSON bodies
 * directly so the dependency surface stays minimal until the broader
 * billing UI lands.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { ownerSubscriptions } from '$lib/db/schema';
import { unscopedQueryNote } from '$lib/db/tenant';

const SIGNATURE_TOLERANCE_SECONDS = 300; // Stripe default

export class StripeWebhookError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'StripeWebhookError';
  }
}

/**
 * Verify a Stripe-Signature header per Stripe's v1 webhook scheme.
 * Throws StripeWebhookError on any tampering, mismatch, or expired
 * timestamp. The caller catches and returns the right HTTP status.
 *
 * See https://stripe.com/docs/webhooks/signatures
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  nowMs = Date.now()
): void {
  if (!signatureHeader) {
    throw new StripeWebhookError('missing Stripe-Signature header', 400);
  }
  const parts = signatureHeader.split(',').reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split('=');
    if (k && v) acc[k] = v;
    return acc;
  }, {});
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) {
    throw new StripeWebhookError('malformed Stripe-Signature header', 400);
  }
  const tsSeconds = Number(t);
  if (!Number.isFinite(tsSeconds)) {
    throw new StripeWebhookError('non-numeric Stripe-Signature timestamp', 400);
  }
  const skewSeconds = Math.abs(Math.floor(nowMs / 1000) - tsSeconds);
  if (skewSeconds > SIGNATURE_TOLERANCE_SECONDS) {
    throw new StripeWebhookError(
      `Stripe-Signature timestamp skew ${skewSeconds}s > ${SIGNATURE_TOLERANCE_SECONDS}s tolerance`,
      400
    );
  }
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const actual = Buffer.from(v1, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (actual.length !== expectedBuf.length || !timingSafeEqual(actual, expectedBuf)) {
    throw new StripeWebhookError('Stripe-Signature mismatch', 400);
  }
}

/**
 * Minimal Stripe event shape we read in the dispatcher. The full event
 * payload is much larger; we deliberately only typecheck the slice we
 * use so adding a new event handler doesn't require widening this
 * interface every time.
 */
export interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: {
      // Subscription objects
      id?: string;
      customer?: string;
      status?: 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete';
      current_period_start?: number; // unix seconds
      current_period_end?: number;
      metadata?: { ownerId?: string };
      // Invoice objects
      subscription?: string;
    };
  };
}

const STRIPE_TO_OWNER_STATUS: Record<
  string,
  'active' | 'past_due' | 'canceled' | 'suspended' | 'trial'
> = {
  trialing: 'trial',
  active: 'active',
  past_due: 'past_due',
  canceled: 'canceled',
  unpaid: 'suspended',
  incomplete: 'past_due'
};

/**
 * Apply a verified Stripe event to the local owner_subscriptions row.
 * Idempotent: re-processing the same event (Stripe retries on 5xx)
 * resolves to the same target state. Returns the action taken so the
 * caller can audit-log it.
 */
export function applyWebhookEvent(event: StripeEvent): {
  applied: boolean;
  ownerId: string | null;
  reason: string;
} {
  const obj = event.data.object;
  const ownerId = obj.metadata?.ownerId;
  if (!ownerId) {
    // Events without metadata.ownerId aren't ours — Stripe lets the
    // creator set it at subscription create. We log + skip; this is
    // not a failure mode because Stripe may send platform-level events
    // (test pings, account.updated, etc.).
    return { applied: false, ownerId: null, reason: 'event has no metadata.ownerId' };
  }
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const localStatus = obj.status ? STRIPE_TO_OWNER_STATUS[obj.status] : null;
      if (!localStatus) {
        return {
          applied: false,
          ownerId,
          reason: `unhandled Stripe subscription status: ${obj.status}`
        };
      }
      unscopedQueryNote(
        'Stripe webhook writes owner_subscriptions across tenants; ownerId comes from the Stripe event metadata'
      );
      db.update(ownerSubscriptions)
        .set({
          status: localStatus,
          stripeCustomerId: obj.customer ?? null,
          stripeSubscriptionId: obj.id ?? null,
          periodStart: obj.current_period_start ? new Date(obj.current_period_start * 1000) : null,
          periodEnd: obj.current_period_end ? new Date(obj.current_period_end * 1000) : null,
          updatedAt: new Date()
        })
        .where(eq(ownerSubscriptions.ownerId, ownerId))
        .run();
      return { applied: true, ownerId, reason: `subscription → ${localStatus}` };
    }
    case 'customer.subscription.deleted': {
      unscopedQueryNote('Stripe webhook cancels owner_subscriptions across tenants');
      db.update(ownerSubscriptions)
        .set({ status: 'canceled', updatedAt: new Date() })
        .where(eq(ownerSubscriptions.ownerId, ownerId))
        .run();
      return { applied: true, ownerId, reason: 'subscription canceled' };
    }
    case 'invoice.payment_failed': {
      unscopedQueryNote('Stripe webhook marks owner past_due across tenants');
      db.update(ownerSubscriptions)
        .set({ status: 'past_due', updatedAt: new Date() })
        .where(eq(ownerSubscriptions.ownerId, ownerId))
        .run();
      return { applied: true, ownerId, reason: 'invoice failed → past_due' };
    }
    default:
      return { applied: false, ownerId, reason: `unhandled event type ${event.type}` };
  }
}
