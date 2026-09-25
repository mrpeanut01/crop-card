import { json, type RequestEvent } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import {
  BILLING_NOT_CONFIGURED,
  BillingNotConfiguredError,
  StripeApiError,
  billingConfig,
  type BillingConfig
} from './stripeApi';

export async function billingEndpoint(
  event: RequestEvent,
  run: (ctx: { ownerId: string; email: string | undefined; config: BillingConfig }) => Promise<{ url: string }>
): Promise<Response> {
  const user = requireOwner(event);
  if (user.impersonating) {
    return json({ error: 'billing changes are disabled while impersonating' }, { status: 403 });
  }
  if (!user.activeOwnerId) {
    return json({ error: 'no active owner' }, { status: 400 });
  }
  const config = billingConfig();
  if (!config) {
    return json({ error: BILLING_NOT_CONFIGURED }, { status: 503 });
  }
  try {
    const { url } = await run({ ownerId: user.activeOwnerId, email: user.email ?? undefined, config });
    return json({ url }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof BillingNotConfiguredError) {
      return json({ error: BILLING_NOT_CONFIGURED }, { status: 503 });
    }
    if (e instanceof StripeApiError) {
      console.error(`[billing] Stripe error ${e.status}: ${e.message}`);
      return json({ error: 'stripe-error', message: e.message }, { status: 502 });
    }
    throw e;
  }
}
