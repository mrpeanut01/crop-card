import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { billingEndpoint } from '$lib/server/billing/endpoint';
import {
  checkoutPriceId,
  createCheckoutSession,
  getBillingSummary
} from '$lib/server/billing/stripeApi';

const bodySchema = z.object({
  plan: z.enum(['grower', 'farm']).default('grower'),
  interval: z.enum(['month', 'year']).optional()
});

export const POST: RequestHandler = (event) =>
  billingEndpoint(event, async ({ ownerId, email, config }) => {
    const raw = await event.request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw ?? {});
    if (!parsed.success) return { error: 'invalid-plan', status: 400 };
    const { plan } = parsed.data;
    if (getBillingSummary(ownerId)?.hasLiveSubscription) {
      return { error: 'use-portal', status: 409 };
    }
    const interval =
      parsed.data.interval ?? (checkoutPriceId(config, plan, 'year') ? 'year' : 'month');
    const priceId = checkoutPriceId(config, plan, interval);
    if (!priceId) return { error: 'plan-not-available', status: 503 };
    return createCheckoutSession(ownerId, priceId, {
      successUrl: `${event.url.origin}/settings/billing?checkout=success`,
      cancelUrl: `${event.url.origin}/settings/billing?checkout=cancel`,
      email,
      plan,
      interval
    });
  });
