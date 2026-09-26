/**
 * Stripe billing — webhook half (Sprint 21 / Phase 21 launch readiness).
 *
 *   - verifyWebhookSignature() — verifies Stripe-Signature headers using
 *     the v1 scheme (HMAC-SHA256 over timestamped payload).
 *   - applyWebhookEvent() — small dispatcher that maps the Stripe event
 *     types we care about onto the owner_subscriptions row (and mirrors
 *     status onto owners.billing_status, which hooks.server.ts gates on).
 *
 * Customer creation + hosted Checkout / Billing Portal sessions live in
 * `stripeApi.ts` (direct REST, no SDK). This module stays the source of
 * truth for owner_subscriptions state: every status change arrives here.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, writeTransaction } from '$lib/db/client';
import { ownerSubscriptions, owners } from '$lib/db/schema';
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
      metadata?: { ownerId?: string; owner_id?: string } | null;
      // Invoice + Checkout Session objects
      subscription?: string | null;
      // Checkout Session objects
      client_reference_id?: string | null;
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
  const ownerId = resolveOwnerId(event);
  if (!ownerId) {
    // Not ours (platform-level pings, customers created outside CropCard).
    // Log + skip rather than fail so Stripe does not retry forever.
    return { applied: false, ownerId: null, reason: 'event has no resolvable owner' };
  }
  switch (event.type) {
    case 'checkout.session.completed': {
      if (!obj.customer) {
        return { applied: false, ownerId, reason: 'checkout session has no customer' };
      }
      if (
        !convergeSubscription(ownerId, {
          stripeCustomerId: obj.customer,
          ...(obj.subscription ? { stripeSubscriptionId: obj.subscription } : {})
        })
      ) {
        return { applied: false, ownerId, reason: 'unknown owner' };
      }
      return { applied: true, ownerId, reason: 'checkout completed → customer linked' };
    }
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
      if (
        !convergeSubscription(ownerId, {
          status: localStatus,
          stripeCustomerId: obj.customer ?? null,
          stripeSubscriptionId: obj.id ?? null,
          periodStart: obj.current_period_start ? new Date(obj.current_period_start * 1000) : null,
          periodEnd: obj.current_period_end ? new Date(obj.current_period_end * 1000) : null
        })
      ) {
        return { applied: false, ownerId, reason: 'unknown owner' };
      }
      return { applied: true, ownerId, reason: `subscription → ${localStatus}` };
    }
    case 'customer.subscription.deleted': {
      if (!convergeSubscription(ownerId, { status: 'canceled' })) {
        return { applied: false, ownerId, reason: 'unknown owner' };
      }
      return { applied: true, ownerId, reason: 'subscription canceled' };
    }
    case 'invoice.payment_failed': {
      if (!convergeSubscription(ownerId, { status: 'past_due' })) {
        return { applied: false, ownerId, reason: 'unknown owner' };
      }
      return { applied: true, ownerId, reason: 'invoice failed → past_due' };
    }
    default:
      return { applied: false, ownerId, reason: `unhandled event type ${event.type}` };
  }
}

type OwnerStatus = (typeof STRIPE_TO_OWNER_STATUS)[string];

interface SubscriptionPatch {
  status?: OwnerStatus;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
}

/**
 * Owner resolution order: explicit metadata (set at Checkout via
 * subscription_data.metadata), then the Checkout Session's
 * client_reference_id, then a reverse lookup of the Stripe customer id
 * (invoices carry no subscription metadata).
 */
function resolveOwnerId(event: StripeEvent): string | null {
  const obj = event.data.object;
  const fromMetadata = obj.metadata?.ownerId ?? obj.metadata?.owner_id;
  if (fromMetadata) return fromMetadata;
  if (event.type === 'checkout.session.completed' && obj.client_reference_id) {
    return obj.client_reference_id;
  }
  if (obj.customer) {
    unscopedQueryNote('Stripe webhook resolves the owner by stripe_customer_id across tenants');
    const row = db
      .select({ ownerId: ownerSubscriptions.ownerId })
      .from(ownerSubscriptions)
      .where(eq(ownerSubscriptions.stripeCustomerId, obj.customer))
      .get();
    if (row) return row.ownerId;
  }
  return null;
}

/**
 * Absolute-value upsert of owner_subscriptions, mirrored onto
 * owners.billing_status (the column hooks.server.ts gates on) so a
 * Stripe `unpaid → suspended` actually suspends — same pairing as
 * superadmin.setBillingStatus. Returns false when the owner is unknown.
 */
function convergeSubscription(ownerId: string, patch: SubscriptionPatch): boolean {
  unscopedQueryNote(
    'Stripe webhook writes owner_subscriptions across tenants; ownerId comes from the Stripe event'
  );
  const owner = db.select({ id: owners.id }).from(owners).where(eq(owners.id, ownerId)).get();
  if (!owner) return false;
  const now = new Date();
  writeTransaction((tx) => {
    tx.insert(ownerSubscriptions)
      .values({ ownerId, ...patch, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: ownerSubscriptions.ownerId,
        set: { ...patch, updatedAt: now }
      })
      .run();
    if (patch.status) {
      tx.update(owners).set({ billingStatus: patch.status }).where(eq(owners.id, ownerId)).run();
    }
  });
  return true;
}
