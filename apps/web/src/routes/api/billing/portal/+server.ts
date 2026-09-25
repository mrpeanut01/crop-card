import type { RequestHandler } from '@sveltejs/kit';
import { billingEndpoint } from '$lib/server/billing/endpoint';
import { createBillingPortalSession } from '$lib/server/billing/stripeApi';

export const POST: RequestHandler = (event) =>
  billingEndpoint(event, ({ ownerId }) =>
    createBillingPortalSession(ownerId, `${event.url.origin}/settings/billing`)
  );
