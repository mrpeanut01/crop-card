/**
 * /settings/billing loader — plan status from owner_subscriptions (the
 * Stripe webhook keeps it converged) + whether this server has Stripe
 * configured, so the UI can show honest Checkout / Portal actions.
 */

import { error, redirect, type ServerLoad } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { spendSnapshot } from '$lib/server/aiGuard';
import { billingConfig, getBillingSummary } from '$lib/server/billing/stripeApi';

export const load: ServerLoad = ({ locals, url }) => {
  if (!locals.user) throw redirect(303, '/');
  if (locals.user.role !== 'owner') throw error(403, 'owner-only');

  const ownerId = locals.user.activeOwnerId;
  const ownerRow = ownerId ? db.select().from(owners).where(eq(owners.id, ownerId)).get() : null;
  const summary = ownerId ? getBillingSummary(ownerId) : null;
  const checkout = url.searchParams.get('checkout');

  return {
    billingStatus: summary?.status ?? ownerRow?.billingStatus ?? 'unknown',
    subscription: summary,
    billingConfigured: billingConfig() !== null,
    impersonating: locals.user.impersonating,
    checkoutResult: checkout === 'success' || checkout === 'cancel' ? checkout : null,
    ai: spendSnapshot()
  };
};
