/**
 * Provider-reported opt-outs and failures, keyed by normalized address.
 * Global by design (see the schema note): Pingram reports an email address
 * or phone number, never a farm.
 */

import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { db } from './client';
import { contactSuppressions } from './schema';

export type SuppressionChannel = 'email' | 'sms';
export type SuppressionReason = 'unsubscribe' | 'complaint' | 'bounce' | 'failed';

/** Reasons that stop opt-in email. A plain delivery failure is logged only. */
export const BLOCKING_EMAIL_REASONS: readonly SuppressionReason[] = [
  'unsubscribe',
  'complaint',
  'bounce'
];

export function normalizeAddress(channel: SuppressionChannel, address: string): string {
  const trimmed = address.trim();
  return channel === 'email' ? trimmed.toLowerCase() : trimmed;
}

export function recordSuppression(input: {
  address: string;
  channel: SuppressionChannel;
  reason: SuppressionReason;
  source: string;
  eventId?: string | null;
  notificationType?: string | null;
  at?: number;
}): boolean {
  const res = db
    .insert(contactSuppressions)
    .values({
      id: randomUUID(),
      address: normalizeAddress(input.channel, input.address),
      channel: input.channel,
      reason: input.reason,
      source: input.source,
      eventId: input.eventId ?? null,
      notificationType: input.notificationType ?? null,
      createdAt: new Date(input.at ?? Date.now())
    })
    .onConflictDoNothing()
    .run();
  return res.changes > 0;
}

/**
 * Whether opt-in email to this address is stopped. With `pingramType`, an
 * unsubscribe Pingram reported for a different notification type does not
 * count, so leaving the Monday summary on Pingram's page leaves field alerts
 * alone (F4-11). Bounces, complaints and untyped unsubscribes always count.
 */
export function isEmailSuppressed(address: string, pingramType?: string): boolean {
  const rows = db
    .select({
      reason: contactSuppressions.reason,
      notificationType: contactSuppressions.notificationType
    })
    .from(contactSuppressions)
    .where(
      and(
        eq(contactSuppressions.address, normalizeAddress('email', address)),
        eq(contactSuppressions.channel, 'email'),
        inArray(contactSuppressions.reason, [...BLOCKING_EMAIL_REASONS])
      )
    )
    .all();
  return rows.some(
    (r) =>
      !pingramType ||
      r.reason !== 'unsubscribe' ||
      !r.notificationType ||
      r.notificationType === pingramType
  );
}

/** A fresh, explicit opt-in in CropCard lifts an earlier unsubscribe. Bounces
 *  and complaints stay: those need a person to look at them. With
 *  `pingramType`, only an untyped unsubscribe or one for that type is lifted,
 *  so turning on a field alert leaves a Monday summary unsubscribe in place. */
export function clearEmailUnsubscribe(address: string, pingramType?: string): void {
  if (!pingramType) {
    clearUnsubscribe('email', address);
    return;
  }
  db.delete(contactSuppressions)
    .where(
      and(
        eq(contactSuppressions.address, normalizeAddress('email', address)),
        eq(contactSuppressions.channel, 'email'),
        eq(contactSuppressions.reason, 'unsubscribe'),
        or(
          isNull(contactSuppressions.notificationType),
          eq(contactSuppressions.notificationType, pingramType)
        )
      )
    )
    .run();
}

export function clearUnsubscribe(channel: SuppressionChannel, address: string): void {
  db.delete(contactSuppressions)
    .where(
      and(
        eq(contactSuppressions.address, normalizeAddress(channel, address)),
        eq(contactSuppressions.channel, channel),
        eq(contactSuppressions.reason, 'unsubscribe')
      )
    )
    .run();
}

export function listSuppressions(address: string, channel: SuppressionChannel) {
  return db
    .select()
    .from(contactSuppressions)
    .where(
      and(
        eq(contactSuppressions.address, normalizeAddress(channel, address)),
        eq(contactSuppressions.channel, channel)
      )
    )
    .all();
}
