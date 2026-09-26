/**
 * Stripe billing — webhook half (Sprint 21 / Phase 21 launch readiness).
 *
 *   - verifyWebhookSignature() — verifies Stripe-Signature headers using
 *     the v1 scheme (HMAC-SHA256 over timestamped payload).
 *   - applyWebhookEvent() — small dispatcher that maps the Stripe event
 *     types we care about onto the owner_subscriptions row: status, the
 *     plan behind the subscription's price, and the start of any dunning
 *     run. Status is mirrored onto owners.billing_status for display, but
 *     Stripe never suspends a farm: 'suspended' is a superadmin action and
 *     a webhook never overwrites it.
 *
 * Customer creation + hosted Checkout / Billing Portal sessions live in
 * `stripeApi.ts` (direct REST, no SDK). This module stays the source of
 * truth for owner_subscriptions state: every status change arrives here.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { ownerSubscriptions, owners } from '$lib/db/schema';
import { unscopedQueryNote } from '$lib/db/tenant';
import { planForPriceId, type BillingInterval, type PlanId } from '$lib/billing/plans';
import { stripePrices } from './stripeApi';

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
  /** Unix seconds when Stripe created the event. */
  created?: number;
  data: {
    object: {
      // Subscription objects
      id?: string;
      customer?: string;
      status?:
        | 'trialing'
        | 'active'
        | 'past_due'
        | 'canceled'
        | 'unpaid'
        | 'incomplete'
        | 'incomplete_expired';
      items?: {
        data?: Array<{ price?: { id?: string | null } | null } | null> | null;
      } | null;
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

type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'canceled' | 'incomplete';

/** unpaid and incomplete_expired end the paid plan (the owner drops to Free,
 *  records untouched). incomplete is a first checkout whose payment has not
 *  gone through, so it never grants a paid plan. */
const STRIPE_TO_OWNER_STATUS: Record<string, SubscriptionStatus> = {
  trialing: 'trial',
  active: 'active',
  past_due: 'past_due',
  canceled: 'canceled',
  unpaid: 'canceled',
  incomplete_expired: 'canceled',
  incomplete: 'incomplete'
};

const PAID_STATUSES: ReadonlySet<string> = new Set(['active', 'trial', 'past_due']);

function subscriptionPriceId(event: StripeEvent): string | null {
  return event.data.object.items?.data?.[0]?.price?.id ?? null;
}

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
  const skip = staleOrForeign(ownerId, event);
  if (skip) return { applied: false, ownerId, reason: skip };
  const eventAt = {
    lastStripeEventAt: new Date(event.created ? event.created * 1000 : Date.now())
  };
  switch (event.type) {
    case 'checkout.session.completed': {
      if (!obj.customer) {
        return { applied: false, ownerId, reason: 'checkout session has no customer' };
      }
      const keepLive = hasConfirmedLiveSubscription(ownerId);
      if (
        !convergeSubscription(ownerId, {
          stripeCustomerId: obj.customer,
          ...(obj.subscription && !keepLive ? { stripeSubscriptionId: obj.subscription } : {})
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
      const priced = planForPriceId(stripePrices(), subscriptionPriceId(event));
      if (
        !convergeSubscription(ownerId, {
          status: localStatus,
          stripeCustomerId: obj.customer ?? null,
          stripeSubscriptionId: obj.id ?? null,
          periodStart: obj.current_period_start ? new Date(obj.current_period_start * 1000) : null,
          periodEnd: obj.current_period_end ? new Date(obj.current_period_end * 1000) : null,
          ...(priced ? { planCode: priced.plan, billingInterval: priced.interval } : {}),
          ...eventAt
        })
      ) {
        return { applied: false, ownerId, reason: 'unknown owner' };
      }
      const planNote = priced ? ` on ${priced.plan}/${priced.interval}` : ' (price not mapped)';
      return { applied: true, ownerId, reason: `subscription → ${localStatus}${planNote}` };
    }
    case 'customer.subscription.deleted': {
      if (
        !convergeSubscription(ownerId, {
          status: 'canceled',
          planCode: 'free',
          billingInterval: null,
          ...eventAt
        })
      ) {
        return { applied: false, ownerId, reason: 'unknown owner' };
      }
      return { applied: true, ownerId, reason: 'subscription canceled → free' };
    }
    case 'invoice.payment_failed': {
      const current = readStatus(ownerId);
      if (current === undefined) return { applied: false, ownerId, reason: 'unknown owner' };
      if (!current || !PAID_STATUSES.has(current)) {
        return {
          applied: false,
          ownerId,
          reason: `payment failed while ${current ?? 'unsubscribed'}; stays free`
        };
      }
      convergeSubscription(ownerId, { status: 'past_due', ...eventAt });
      return { applied: true, ownerId, reason: 'invoice failed → past_due' };
    }
    default:
      return { applied: false, ownerId, reason: `unhandled event type ${event.type}` };
  }
}

interface SubscriptionPatch {
  status?: SubscriptionStatus;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  planCode?: PlanId;
  billingInterval?: BillingInterval | null;
  lastStripeEventAt?: Date;
}

const ORDERED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed'
]);

/**
 * Stripe neither orders deliveries nor stops retrying for three days, so a
 * subscription or invoice event is skipped when it is older than the newest
 * one already applied, or when it belongs to a different subscription while
 * the one on record is still live (a duplicate checkout, an old incomplete
 * attempt). Returns the skip reason, or null to apply the event.
 */
function staleOrForeign(ownerId: string, event: StripeEvent): string | null {
  if (!ORDERED_EVENT_TYPES.has(event.type)) return null;
  unscopedQueryNote('Stripe webhook reads the stored subscription by owner id before applying');
  const stored = db
    .select({
      status: ownerSubscriptions.status,
      subscriptionId: ownerSubscriptions.stripeSubscriptionId,
      lastEventAt: ownerSubscriptions.lastStripeEventAt
    })
    .from(ownerSubscriptions)
    .where(eq(ownerSubscriptions.ownerId, ownerId))
    .get();
  if (!stored) return null;
  const lastMs = stored.lastEventAt?.getTime() ?? null;
  if (event.created && lastMs != null && event.created * 1000 < lastMs) {
    return 'stale event: a newer subscription event was already applied';
  }
  const obj = event.data.object;
  const eventSubscription = event.type.startsWith('customer.subscription.')
    ? (obj.id ?? null)
    : (obj.subscription ?? null);
  if (
    eventSubscription &&
    stored.subscriptionId &&
    eventSubscription !== stored.subscriptionId &&
    lastMs != null &&
    PAID_STATUSES.has(stored.status)
  ) {
    return `event for subscription ${eventSubscription}, not the current ${stored.subscriptionId}`;
  }
  return null;
}

/** A second checkout (another tab) must not replace a subscription that a
 *  Stripe subscription event has already confirmed as live. */
function hasConfirmedLiveSubscription(ownerId: string): boolean {
  unscopedQueryNote('Stripe webhook reads the stored subscription by owner id before linking');
  const row = db
    .select({
      status: ownerSubscriptions.status,
      subscriptionId: ownerSubscriptions.stripeSubscriptionId,
      lastEventAt: ownerSubscriptions.lastStripeEventAt
    })
    .from(ownerSubscriptions)
    .where(eq(ownerSubscriptions.ownerId, ownerId))
    .get();
  return !!row?.subscriptionId && row.lastEventAt != null && PAID_STATUSES.has(row.status);
}

/** undefined = no such owner; null = owner without a subscription row. */
function readStatus(ownerId: string): string | null | undefined {
  unscopedQueryNote('Stripe webhook reads the current subscription status by owner id');
  const owner = db.select({ id: owners.id }).from(owners).where(eq(owners.id, ownerId)).get();
  if (!owner) return undefined;
  const row = db
    .select({ status: ownerSubscriptions.status })
    .from(ownerSubscriptions)
    .where(eq(ownerSubscriptions.ownerId, ownerId))
    .get();
  return row?.status ?? null;
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
 * Absolute-value upsert of owner_subscriptions. A move into past_due stamps
 * past_due_since once (the 7-day grace runs from the first failure, however
 * many retries fail after it); any other status clears it. The status is
 * mirrored onto owners.billing_status except over a superadmin suspension.
 * Returns false when the owner is unknown.
 */
function convergeSubscription(ownerId: string, patch: SubscriptionPatch): boolean {
  unscopedQueryNote(
    'Stripe webhook writes owner_subscriptions across tenants; ownerId comes from the Stripe event'
  );
  const owner = db
    .select({ id: owners.id, billingStatus: owners.billingStatus })
    .from(owners)
    .where(eq(owners.id, ownerId))
    .get();
  if (!owner) return false;
  const now = new Date();
  const existing = db
    .select({ pastDueSince: ownerSubscriptions.pastDueSince })
    .from(ownerSubscriptions)
    .where(eq(ownerSubscriptions.ownerId, ownerId))
    .get();
  const set: SubscriptionPatch & { pastDueSince?: Date | null } = { ...patch };
  if (patch.status === 'past_due') set.pastDueSince = existing?.pastDueSince ?? now;
  else if (patch.status) set.pastDueSince = null;
  db.transaction((tx) => {
    tx.insert(ownerSubscriptions)
      .values({ ownerId, ...set, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: ownerSubscriptions.ownerId,
        set: { ...set, updatedAt: now }
      })
      .run();
    if (patch.status && patch.status !== 'incomplete' && owner.billingStatus !== 'suspended') {
      tx.update(owners).set({ billingStatus: patch.status }).where(eq(owners.id, ownerId)).run();
    }
  });
  return true;
}
