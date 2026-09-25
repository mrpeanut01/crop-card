import type { RequestHandler } from '@sveltejs/kit';
import { billingEndpoint } from '$lib/server/billing/endpoint';
import { createCheckoutSession } from '$lib/server/billing/stripeApi';

export const POST: RequestHandler = (event) =>
  billingEndpoint(event, ({ ownerId, email, config }) =>
    createCheckoutSession(ownerId, config.priceId, {
      successUrl: `${event.url.origin}/settings/billing?checkout=success`,
      cancelUrl: `${event.url.origin}/settings/billing?checkout=cancel`,
      email
    })
  );
