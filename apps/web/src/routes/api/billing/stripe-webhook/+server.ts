/**
 * POST /api/billing/stripe-webhook
 *
 * Sprint 21 — receives signed Stripe events and converges
 * owner_subscriptions on the Stripe state. Idempotent: Stripe retries
 * delivered events on 5xx + every event has a unique id; replaying
 * resolves to the same target state because we set fields by absolute
 * value (not increment).
 *
 * STRIPE_WEBHOOK_SECRET must be set in production. Without it the
 * endpoint returns 503 so the misconfiguration is loud rather than
 * silently accepting forged events.
 *
 * Auth: this endpoint is unauthenticated by design — Stripe POSTs from
 * its own IPs and the signature is the only auth. CSRF is handled at
 * the framework level (Bearer/cookie checks); webhook bodies don't go
 * through the cookie session.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import {
  applyWebhookEvent,
  verifyWebhookSignature,
  StripeWebhookError,
  type StripeEvent
} from '$lib/server/billing/stripe';

export const POST: RequestHandler = async ({ request }) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return json({ error: 'STRIPE_WEBHOOK_SECRET not configured' }, { status: 503 });
  }
  const signature = request.headers.get('stripe-signature');
  const rawBody = await request.text();

  try {
    verifyWebhookSignature(rawBody, signature, secret);
  } catch (e) {
    if (e instanceof StripeWebhookError) {
      return json({ error: e.message }, { status: e.status });
    }
    throw error(500, e instanceof Error ? e.message : 'signature verification failed');
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return json({ error: 'malformed JSON body' }, { status: 400 });
  }
  if (!event.id || !event.type || !event.data?.object) {
    return json({ error: 'unrecognised Stripe event shape' }, { status: 400 });
  }

  const result = applyWebhookEvent(event);
  // eslint-disable-next-line no-console
  console.log(
    `[stripe-webhook] event=${event.id} type=${event.type} owner=${result.ownerId ?? '(none)'} applied=${result.applied} reason="${result.reason}"`
  );
  // Return 200 for both applied + unhandled events so Stripe doesn't
  // retry events we intentionally ignored (e.g. platform-level pings).
  return json({ received: true, applied: result.applied, reason: result.reason });
};
