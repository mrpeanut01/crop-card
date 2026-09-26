/**
 * Pingram events webhook: verify, then mirror unsubscribes and failures into
 * `contact_suppressions`. Signature scheme (from the pingram SDK's
 * webhooks.js): header `X-Pingram-Signature: v1,<hex>`, HMAC-SHA256 with the
 * endpoint secret over `${X-Pingram-Id}.${X-Pingram-Timestamp}.${rawBody}`,
 * timestamp in milliseconds, 300 s tolerance.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { users } from '$lib/db/schema';
import {
  clearUnsubscribe,
  normalizeAddress,
  recordSuppression,
  type SuppressionChannel,
  type SuppressionReason
} from '$lib/db/contactSuppressions';

export const PINGRAM_TOLERANCE_SECONDS = 300;

export class PingramWebhookError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'PingramWebhookError';
  }
}

export function signPingramPayload(
  id: string,
  timestamp: string,
  body: string,
  secret: string
): string {
  return `v1,${createHmac('sha256', secret).update(`${id}.${timestamp}.${body}`).digest('hex')}`;
}

export function verifyPingramSignature(input: {
  body: string;
  id: string | null;
  signature: string | null;
  timestamp: string | null;
  secret: string;
  nowMs?: number;
}): void {
  const { id, signature, timestamp } = input;
  if (!id || !signature || !timestamp) {
    throw new PingramWebhookError('missing Pingram signature headers', 400);
  }
  if (!/^\d{10,16}$/.test(timestamp)) throw new PingramWebhookError('invalid timestamp', 400);
  const age = Math.abs((input.nowMs ?? Date.now()) - Number(timestamp)) / 1000;
  if (age > PINGRAM_TOLERANCE_SECONDS) {
    throw new PingramWebhookError('timestamp outside tolerance', 400);
  }
  const [version, given] = signature.split(',', 2);
  if (version !== 'v1' || !given) throw new PingramWebhookError('invalid signature format', 400);
  const expected = signPingramPayload(id, timestamp, input.body, input.secret).slice(3);
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new PingramWebhookError('signature mismatch', 400);
  }
}

export interface PingramEvent {
  eventType: string;
  channel?: string;
  userId?: string;
  notificationId?: string;
  trackingId?: string;
  failureCode?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+[1-9]\d{6,14}$/;

/** POST /email and /sms take only an address, so Pingram's `userId` is
 *  normally that address. A CropCard user id is resolved as a fallback. */
export function resolveAddress(channel: SuppressionChannel, userId: string): string | null {
  const v = userId.trim();
  if (channel === 'email' && EMAIL_RE.test(v)) return normalizeAddress('email', v);
  if (channel === 'sms' && PHONE_RE.test(v)) return v;
  const row = db
    .select({ email: users.email, phone: users.phone })
    .from(users)
    .where(eq(users.id, v))
    .get();
  if (!row) return null;
  return channel === 'email' ? row.email : row.phone;
}

export function failureReason(code: string | undefined): SuppressionReason {
  if (!code) return 'failed';
  if (/complain/i.test(code)) return 'complaint';
  if (/bounce|permanent|suppress/i.test(code)) return 'bounce';
  return 'failed';
}

export type ApplyOutcome =
  | { action: 'recorded'; address: string; channel: SuppressionChannel; reason: SuppressionReason }
  | { action: 'cleared'; address: string }
  | { action: 'ignored'; why: string };

export function applyPingramEvent(event: PingramEvent, eventId: string): ApplyOutcome {
  if (!event || typeof event.eventType !== 'string') return { action: 'ignored', why: 'no type' };
  if (typeof event.userId !== 'string' || !event.userId) {
    return { action: 'ignored', why: 'no user' };
  }
  const plan: Record<string, { channel: SuppressionChannel; reason?: SuppressionReason }> = {
    EMAIL_UNSUBSCRIBE: { channel: 'email', reason: 'unsubscribe' },
    EMAIL_FAILED: { channel: 'email', reason: failureReason(event.failureCode) },
    SMS_UNSUBSCRIBE: { channel: 'sms', reason: 'unsubscribe' },
    SMS_SUBSCRIBE: { channel: 'sms' }
  };
  const step = plan[event.eventType];
  if (!step) return { action: 'ignored', why: `event ${event.eventType}` };
  const address = resolveAddress(step.channel, event.userId);
  if (!address) return { action: 'ignored', why: 'unknown address' };
  if (!step.reason) {
    clearUnsubscribe(step.channel, address);
    return { action: 'cleared', address };
  }
  recordSuppression({
    address,
    channel: step.channel,
    reason: step.reason,
    source: 'pingram-webhook',
    eventId,
    notificationType: event.notificationId ?? null
  });
  return { action: 'recorded', address, channel: step.channel, reason: step.reason };
}
