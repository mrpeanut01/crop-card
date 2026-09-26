import { json, type RequestHandler } from '@sveltejs/kit';
import {
  applyPingramEvent,
  PingramWebhookError,
  verifyPingramSignature,
  type PingramEvent
} from '$lib/server/pingramWebhook';

/** Pingram POSTs delivery events here without a session; the signature is
 *  the auth. Unset PINGRAM_WEBHOOK_SECRET answers 503 so a half-configured
 *  server never trusts an unsigned body. */
export const POST: RequestHandler = async ({ request }) => {
  const secret = process.env.PINGRAM_WEBHOOK_SECRET;
  if (!secret) return json({ error: 'webhook not configured' }, { status: 503 });
  const body = await request.text();
  const id = request.headers.get('x-pingram-id');
  try {
    verifyPingramSignature({
      body,
      id,
      signature: request.headers.get('x-pingram-signature'),
      timestamp: request.headers.get('x-pingram-timestamp'),
      secret
    });
  } catch (e) {
    if (e instanceof PingramWebhookError) {
      return json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
  let event: PingramEvent;
  try {
    event = JSON.parse(body) as PingramEvent;
  } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }
  const outcome = applyPingramEvent(event, id as string);
  return json({ received: true, outcome: outcome.action });
};
