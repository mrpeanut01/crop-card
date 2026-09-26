import { error, redirect, type ServerLoad } from '@sveltejs/kit';
import { spendSnapshot } from '$lib/server/aiGuard';
import { resolvePlan, seatUsage } from '$lib/server/billing/plans';
import {
  availableCheckouts,
  billingConfig,
  getBillingSummary
} from '$lib/server/billing/stripeApi';

export const load: ServerLoad = ({ locals, url }) => {
  if (!locals.user) throw redirect(303, '/');
  if (locals.user.role !== 'owner') throw error(403, 'owner-only');
  const ownerId = locals.user.activeOwnerId;
  if (!ownerId) throw redirect(303, '/owner-picker');

  const plan = resolvePlan(ownerId);
  const summary = getBillingSummary(ownerId);
  const config = billingConfig();
  const checkout = url.searchParams.get('checkout');

  return {
    plan: {
      id: plan.plan,
      source: plan.source,
      starterBoost: plan.starterBoost,
      boostEndsAt: plan.boostEndsAt,
      graceEndsAt: plan.graceEndsAt
    },
    subscription: summary,
    billingConfigured: config !== null,
    checkouts: availableCheckouts(config),
    impersonating: locals.user.impersonating,
    checkoutResult: checkout === 'success' || checkout === 'cancel' ? checkout : null,
    ai: spendSnapshot(),
    seats: seatUsage(ownerId)
  };
};
