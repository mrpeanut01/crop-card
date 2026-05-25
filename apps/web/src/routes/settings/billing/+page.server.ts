/**
 * Phase 25c (#88) — /settings/billing loader.
 *
 * Plan + usage. Real billing infrastructure (Stripe / Lemon Squeezy)
 * lands in Phase 26; today this page surfaces the AI spend snapshot
 * + Owner billing status so the operator can see "what does CropCard
 * cost me this month" without spelunking through /settings/ai.
 */

import { error, redirect, type ServerLoad } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { spendSnapshot } from '$lib/server/aiGuard';

export const load: ServerLoad = ({ locals }) => {
  if (!locals.user) throw redirect(303, '/');
  if (locals.user.role !== 'owner') throw error(403, 'owner-only');

  const ownerRow = locals.user.activeOwnerId
    ? db.select().from(owners).where(eq(owners.id, locals.user.activeOwnerId)).get()
    : null;

  return {
    billingStatus: ownerRow?.billingStatus ?? 'unknown',
    ai: spendSnapshot()
  };
};
