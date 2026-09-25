import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { ownerSubscriptions, owners } from '$lib/db/schema';
import { applyWebhookEvent, type StripeEvent } from './stripe';

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

  it('subscription unpaid → suspended mirrors onto owners.billing_status (the hooks gate)', () => {
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
    expect(sub(ownerId)).toMatchObject({ status: 'suspended', stripeSubscriptionId: 'sub_9' });
    expect(sub(ownerId)?.periodEnd?.getTime()).toBe(1_802_592_000_000);
    expect(owner(ownerId)?.billingStatus).toBe('suspended');
  });

  it('subscription active after suspension lifts the gate', () => {
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
