/**
 * Provider-reported opt-outs and failures, keyed by normalized address.
 * Global by design (see the schema note): Pingram reports an email address
 * or phone number, never a farm.
 */

import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
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

export function isEmailSuppressed(address: string): boolean {
  const row = db
    .select({ id: contactSuppressions.id })
    .from(contactSuppressions)
    .where(
      and(
        eq(contactSuppressions.address, normalizeAddress('email', address)),
        eq(contactSuppressions.channel, 'email'),
        inArray(contactSuppressions.reason, [...BLOCKING_EMAIL_REASONS])
      )
    )
    .get();
  return !!row;
}

/** A fresh, explicit opt-in in CropCard lifts an earlier unsubscribe. Bounces
 *  and complaints stay: those need a person to look at them. */
export function clearEmailUnsubscribe(address: string): void {
  clearUnsubscribe('email', address);
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
