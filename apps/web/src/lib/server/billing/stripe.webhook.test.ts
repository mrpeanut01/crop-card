import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { ownerSubscriptions, owners } from '$lib/db/schema';
import { applyWebhookEvent, type StripeEvent } from './stripe';
import { resolvePlan } from './plans';

function freshOwner(): string {
  const id = `stripe-wh-${randomUUID().slice(0, 12)}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'trial' }).run();
  db.insert(ownerSubscriptions).values({ ownerId: id, status: 'trial' }).run();
  return id;
}
const sub = (ownerId: string) =>
  db.select().from(ownerSubscriptions).where(eq(ownerSubscriptions.ownerId, ownerId)).get();
const owner = (ownerId: string) => db.select().from(owners).where(eq(owners.id, ownerId)).get();

function checkoutCompleted(
  ownerId: string,
  customer: string,
  subscription: string | null = 'sub_1'
): StripeEvent {
  return {
    id: `evt_${randomUUID()}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_1',
        customer,
        subscription,
        client_reference_id: ownerId,
        metadata: null
      }
    }
  };
}

describe('applyWebhookEvent', () => {
  it('checkout.session.completed links customer + subscription via client_reference_id', () => {
    const ownerId = freshOwner();
    const r = applyWebhookEvent(checkoutCompleted(ownerId, 'cus_A'));
    expect(r).toMatchObject({ applied: true, ownerId });
    expect(sub(ownerId)).toMatchObject({
      stripeCustomerId: 'cus_A',
      stripeSubscriptionId: 'sub_1',
      status: 'trial'
    });
  });

  it('checkout.session.completed is idempotent on replay', () => {
    const ownerId = freshOwner();
    const evt = checkoutCompleted(ownerId, 'cus_B');
    applyWebhookEvent(evt);
    const first = sub(ownerId);
    const second = applyWebhookEvent(evt);
    expect(second.applied).toBe(true);
    expect(sub(ownerId)).toMatchObject({
      stripeCustomerId: first?.stripeCustomerId,
      stripeSubscriptionId: first?.stripeSubscriptionId,
      status: first?.status
    });
  });

  it('checkout.session.completed without a subscription id keeps any existing one', () => {
    const ownerId = freshOwner();
    applyWebhookEvent(checkoutCompleted(ownerId, 'cus_C', 'sub_keep'));
    applyWebhookEvent(checkoutCompleted(ownerId, 'cus_C', null));
    expect(sub(ownerId)?.stripeSubscriptionId).toBe('sub_keep');
  });

  it('checkout.session.completed creates the subscription row if the owner has none', () => {
    const id = `stripe-wh-${randomUUID().slice(0, 12)}`;
    db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'trial' }).run();
    expect(applyWebhookEvent(checkoutCompleted(id, 'cus_new_row')).applied).toBe(true);
    expect(sub(id)?.stripeCustomerId).toBe('cus_new_row');
  });

  it('skips a checkout session for an unknown owner', () => {
    const r = applyWebhookEvent(checkoutCompleted('owner-does-not-exist', 'cus_X'));
    expect(r.applied).toBe(false);
    expect(sub('owner-does-not-exist')).toBeUndefined();
  });

  it('invoice.payment_failed without metadata resolves the owner by customer id', () => {
    const ownerId = freshOwner();
    applyWebhookEvent(checkoutCompleted(ownerId, `cus_${ownerId}`));
    const r = applyWebhookEvent({
      id: 'evt_inv',
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_1', customer: `cus_${ownerId}`, subscription: 'sub_1' } }
    });
    expect(r).toMatchObject({ applied: true, ownerId });
    expect(sub(ownerId)?.status).toBe('past_due');
    expect(owner(ownerId)?.billingStatus).toBe('past_due');
  });

  it('subscription unpaid ends the paid plan (canceled, never suspended)', () => {
    const ownerId = freshOwner();
    applyWebhookEvent({
      id: 'evt_sub',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_9',
          customer: 'cus_9',
          status: 'unpaid',
          current_period_start: 1_800_000_000,
          current_period_end: 1_802_592_000,
          metadata: { ownerId }
        }
      }
    });
    expect(sub(ownerId)).toMatchObject({ status: 'canceled', stripeSubscriptionId: 'sub_9' });
    expect(sub(ownerId)?.periodEnd?.getTime()).toBe(1_802_592_000_000);
    expect(owner(ownerId)?.billingStatus).toBe('canceled');
    expect(resolvePlan(ownerId).plan).toBe('free');
  });

  it('subscription active after unpaid restores active', () => {
    const ownerId = freshOwner();
    const evt = (status: 'unpaid' | 'active'): StripeEvent => ({
      id: `evt_${status}`,
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_2', customer: 'cus_2', status, metadata: { ownerId } } }
    });
    applyWebhookEvent(evt('unpaid'));
    applyWebhookEvent(evt('active'));
    expect(owner(ownerId)?.billingStatus).toBe('active');
    expect(sub(ownerId)?.status).toBe('active');
  });

  it('accepts snake_case metadata.owner_id', () => {
    const ownerId = freshOwner();
    const r = applyWebhookEvent({
      id: 'evt_del',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', metadata: { owner_id: ownerId } } }
    });
    expect(r.applied).toBe(true);
    expect(owner(ownerId)?.billingStatus).toBe('canceled');
  });

  it('ignores events with no resolvable owner', () => {
    const r = applyWebhookEvent({
      id: 'evt_ping',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_x', customer: 'cus_unknown_anywhere', status: 'active' } }
    });
    expect(r).toEqual({ applied: false, ownerId: null, reason: 'event has no resolvable owner' });
  });
});

const PRICES = {
  STRIPE_PRICE_GROWER_MONTHLY: 'price_gm',
  STRIPE_PRICE_GROWER_ANNUAL: 'price_ga',
  STRIPE_PRICE_FARM_MONTHLY: 'price_fm',
  STRIPE_PRICE_FARM_ANNUAL: 'price_fa'
};

function subEvent(
  ownerId: string,
  status: NonNullable<StripeEvent['data']['object']['status']>,
  priceId: string | null = 'price_ga',
  type = 'customer.subscription.updated'
): StripeEvent {
  return {
    id: `evt_${randomUUID()}`,
    type,
    data: {
      object: {
        id: 'sub_plan',
        customer: `cus_${ownerId}`,
        status,
        metadata: { ownerId },
        items: { data: priceId ? [{ price: { id: priceId } }] : [] }
      }
    }
  };
}

describe('applyWebhookEvent plan mapping', () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(PRICES)) vi.stubEnv(k, v);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ['price_gm', 'grower', 'month'],
    ['price_ga', 'grower', 'year'],
    ['price_fm', 'farm', 'month'],
    ['price_fa', 'farm', 'year']
  ] as const)('price %s maps to %s/%s', (priceId, plan, interval) => {
    const ownerId = freshOwner();
    applyWebhookEvent(subEvent(ownerId, 'active', priceId, 'customer.subscription.created'));
    expect(sub(ownerId)).toMatchObject({
      planCode: plan,
      billingInterval: interval,
      status: 'active'
    });
    expect(resolvePlan(ownerId).plan).toBe(plan);
  });

  it('the legacy STRIPE_PRICE_ID maps to grower monthly', () => {
    vi.stubEnv('STRIPE_PRICE_GROWER_MONTHLY', '');
    vi.stubEnv('STRIPE_PRICE_ID', 'price_legacy');
    const ownerId = freshOwner();
    applyWebhookEvent(subEvent(ownerId, 'active', 'price_legacy'));
    expect(sub(ownerId)).toMatchObject({ planCode: 'grower', billingInterval: 'month' });
  });

  it('an unknown price leaves the plan alone', () => {
    const ownerId = freshOwner();
    applyWebhookEvent(subEvent(ownerId, 'active', 'price_fm'));
    applyWebhookEvent(subEvent(ownerId, 'active', 'price_unknown'));
    expect(sub(ownerId)?.planCode).toBe('farm');
  });

  it('incomplete never grants a paid plan and leaves the gate status alone', () => {
    const ownerId = freshOwner();
    applyWebhookEvent(subEvent(ownerId, 'incomplete', 'price_fa'));
    expect(sub(ownerId)?.status).toBe('incomplete');
    expect(owner(ownerId)?.billingStatus).toBe('trial');
    expect(resolvePlan(ownerId).plan).toBe('free');
  });

  it('a failed first payment on an incomplete checkout stays free', () => {
    const ownerId = freshOwner();
    applyWebhookEvent(subEvent(ownerId, 'incomplete', 'price_ga'));
    const r = applyWebhookEvent({
      id: 'evt_fail_first',
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_first', customer: `cus_${ownerId}`, metadata: { ownerId } } }
    });
    expect(r.applied).toBe(false);
    expect(sub(ownerId)?.status).toBe('incomplete');
    expect(sub(ownerId)?.pastDueSince).toBeNull();
    expect(resolvePlan(ownerId).plan).toBe('free');
  });

  it('incomplete_expired maps to canceled', () => {
    const ownerId = freshOwner();
    applyWebhookEvent(subEvent(ownerId, 'incomplete_expired', 'price_ga'));
    expect(sub(ownerId)?.status).toBe('canceled');
    expect(resolvePlan(ownerId).plan).toBe('free');
  });

  it('past_due stamps past_due_since once and active clears it', () => {
    const ownerId = freshOwner();
    applyWebhookEvent(subEvent(ownerId, 'active', 'price_ga'));
    applyWebhookEvent(subEvent(ownerId, 'past_due', 'price_ga'));
    const first = sub(ownerId)?.pastDueSince?.getTime();
    expect(first).toBeTypeOf('number');
    applyWebhookEvent({
      id: 'evt_retry_fail',
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_2', customer: `cus_${ownerId}`, metadata: { ownerId } } }
    });
    expect(sub(ownerId)?.pastDueSince?.getTime()).toBe(first);
    expect(resolvePlan(ownerId)).toMatchObject({ plan: 'grower', source: 'grace' });
    applyWebhookEvent(subEvent(ownerId, 'active', 'price_ga'));
    expect(sub(ownerId)?.pastDueSince).toBeNull();
    expect(resolvePlan(ownerId).source).toBe('stripe');
  });

  it('invoice.payment_failed on an active plan starts the grace window', () => {
    const ownerId = freshOwner();
    applyWebhookEvent(subEvent(ownerId, 'active', 'price_fm'));
    applyWebhookEvent({
      id: 'evt_fail',
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_3', customer: `cus_${ownerId}`, metadata: { ownerId } } }
    });
    expect(sub(ownerId)?.status).toBe('past_due');
    expect(resolvePlan(ownerId).plan).toBe('farm');
    const eightDays = Date.now() + 8 * 86_400_000;
    expect(resolvePlan(ownerId, eightDays).plan).toBe('free');
  });

  it('customer.subscription.deleted moves the owner to free', () => {
    const ownerId = freshOwner();
    applyWebhookEvent(subEvent(ownerId, 'active', 'price_fa'));
    applyWebhookEvent(subEvent(ownerId, 'canceled', 'price_fa', 'customer.subscription.deleted'));
    expect(sub(ownerId)).toMatchObject({ status: 'canceled', planCode: 'free' });
    expect(resolvePlan(ownerId).plan).toBe('free');
  });

  it('never overwrites a superadmin suspension', () => {
    const ownerId = freshOwner();
    db.update(owners).set({ billingStatus: 'suspended' }).where(eq(owners.id, ownerId)).run();
    applyWebhookEvent(subEvent(ownerId, 'active', 'price_ga'));
    expect(owner(ownerId)?.billingStatus).toBe('suspended');
    expect(sub(ownerId)?.status).toBe('active');
  });

  it('replaying the same event is idempotent', () => {
    const ownerId = freshOwner();
    const evt = subEvent(ownerId, 'past_due', 'price_ga');
    applyWebhookEvent(evt);
    const first = sub(ownerId);
    applyWebhookEvent(evt);
    expect(sub(ownerId)).toMatchObject({
      status: first?.status,
      planCode: first?.planCode,
      pastDueSince: first?.pastDueSince
    });
  });
});
