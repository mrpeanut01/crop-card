/**
 * NFR-06 — Web Push subscriptions + the scheduled-alert sent-log.
 *
 * Tenant-scoped per CLAUDE.md invariant 6: every read/write funnels through
 * `withTenant` / `tenantValues`, so a subscription registered under Owner A
 * is invisible (and undeliverable) under Owner B. The only cross-tenant read
 * is `listOwnerIdsWithPushSubscriptions`, which the in-process scheduler uses
 * to decide which tenants to visit; it returns ids only.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from './client';
import { pushDeliveries, pushSubscriptions } from './schema';
import { tenantValues, unscopedQueryNote, withTenant } from './tenant';
import {
  DEFAULT_PUSH_PREFS,
  parsePushPrefs,
  type PushAlertKind,
  type PushPrefs
} from '$lib/push/prefs';

export interface PushSubscriptionRecord {
  id: string;
  ownerId: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: number;
  lastSuccessAt: number | null;
  failureCount: number;
  prefs: PushPrefs;
}

function toRecord(row: typeof pushSubscriptions.$inferSelect): PushSubscriptionRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    userId: row.userId,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    createdAt: row.createdAt.getTime(),
    lastSuccessAt: row.lastSuccessAt ? row.lastSuccessAt.getTime() : null,
    failureCount: row.failureCount,
    prefs: parsePushPrefs(row.prefsJson)
  };
}

export interface UpsertSubscriptionInput {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  prefs?: PushPrefs;
}

/**
 * Register (or re-register) a browser endpoint for the active Owner. The
 * browser owns the endpoint, so a re-subscribe from a different signed-in
 * user on the same device re-points the row at that user and resets the
 * failure counter; stored prefs survive unless new ones are passed.
 */
export function upsertSubscription(input: UpsertSubscriptionInput): PushSubscriptionRecord {
  const prefsJson = JSON.stringify(input.prefs ?? DEFAULT_PUSH_PREFS);
  const row = db
    .insert(pushSubscriptions)
    .values(
      tenantValues({
        id: randomUUID(),
        userId: input.userId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        prefsJson
      })
    )
    .onConflictDoUpdate({
      target: [pushSubscriptions.ownerId, pushSubscriptions.endpoint],
      set: {
        userId: input.userId,
        p256dh: input.p256dh,
        auth: input.auth,
        failureCount: 0,
        ...(input.prefs ? { prefsJson } : {})
      }
    })
    .returning()
    .get();
  return toRecord(row);
}

export function listSubscriptions(): PushSubscriptionRecord[] {
  return db
    .select()
    .from(pushSubscriptions)
    .where(withTenant(pushSubscriptions))
    .orderBy(desc(pushSubscriptions.createdAt))
    .all()
    .map(toRecord);
}

export function listSubscriptionsForUser(userId: string): PushSubscriptionRecord[] {
  return db
    .select()
    .from(pushSubscriptions)
    .where(withTenant(pushSubscriptions, eq(pushSubscriptions.userId, userId)))
    .orderBy(desc(pushSubscriptions.createdAt))
    .all()
    .map(toRecord);
}

export function getSubscriptionForUser(
  userId: string,
  endpoint: string
): PushSubscriptionRecord | null {
  const row = db
    .select()
    .from(pushSubscriptions)
    .where(
      withTenant(
        pushSubscriptions,
        and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint))
      )
    )
    .get();
  return row ? toRecord(row) : null;
}

export function deleteSubscriptionForUser(userId: string, endpoint: string): boolean {
  const res = db
    .delete(pushSubscriptions)
    .where(
      withTenant(
        pushSubscriptions,
        and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint))
      )
    )
    .run();
  return res.changes > 0;
}

export function updatePrefsForUser(
  userId: string,
  endpoint: string,
  prefs: PushPrefs
): PushSubscriptionRecord | null {
  const row = db
    .update(pushSubscriptions)
    .set({ prefsJson: JSON.stringify(prefs) })
    .where(
      withTenant(
        pushSubscriptions,
        and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint))
      )
    )
    .returning()
    .get();
  return row ? toRecord(row) : null;
}

export function deleteSubscriptionById(id: string): boolean {
  const res = db
    .delete(pushSubscriptions)
    .where(withTenant(pushSubscriptions, eq(pushSubscriptions.id, id)))
    .run();
  return res.changes > 0;
}

export function markSubscriptionSuccess(id: string, at: number = Date.now()): void {
  db.update(pushSubscriptions)
    .set({ lastSuccessAt: new Date(at), failureCount: 0 })
    .where(withTenant(pushSubscriptions, eq(pushSubscriptions.id, id)))
    .run();
}

export function markSubscriptionFailure(id: string): void {
  db.update(pushSubscriptions)
    .set({ failureCount: sql`${pushSubscriptions.failureCount} + 1` })
    .where(withTenant(pushSubscriptions, eq(pushSubscriptions.id, id)))
    .run();
}

/** Scheduler entry point: which tenants have at least one subscription. */
export function listOwnerIdsWithPushSubscriptions(): string[] {
  unscopedQueryNote(
    'push scheduler enumerates tenants with subscriptions, then re-enters each via runWithTenant'
  );
  return db
    .selectDistinct({ ownerId: pushSubscriptions.ownerId })
    .from(pushSubscriptions)
    .all()
    .map((r) => r.ownerId);
}

// ─── Sent-log ────────────────────────────────────────────────────────────

/**
 * Claim an alert before sending it. Returns true only for the first caller
 * per (owner, kind, subject); every later claim — a later tick, a restart,
 * a concurrent run — gets false, so each alert is delivered at most once.
 */
export function claimDelivery(kind: PushAlertKind, subjectId: string, at = Date.now()): boolean {
  const res = db
    .insert(pushDeliveries)
    .values(tenantValues({ id: randomUUID(), kind, subjectId, sentAt: new Date(at) }))
    .onConflictDoNothing()
    .run();
  return res.changes > 0;
}

export function setDeliveryRecipientCount(
  kind: PushAlertKind,
  subjectId: string,
  count: number
): void {
  db.update(pushDeliveries)
    .set({ recipientCount: count })
    .where(
      withTenant(
        pushDeliveries,
        and(eq(pushDeliveries.kind, kind), eq(pushDeliveries.subjectId, subjectId))
      )
    )
    .run();
}

export interface PushDeliveryRecord {
  id: string;
  ownerId: string;
  kind: PushAlertKind;
  subjectId: string;
  sentAt: number;
  recipientCount: number;
}

export function listDeliveries(): PushDeliveryRecord[] {
  return db
    .select()
    .from(pushDeliveries)
    .where(withTenant(pushDeliveries))
    .orderBy(desc(pushDeliveries.sentAt))
    .all()
    .map((r) => ({
      id: r.id,
      ownerId: r.ownerId,
      kind: r.kind,
      subjectId: r.subjectId,
      sentAt: r.sentAt.getTime(),
      recipientCount: r.recipientCount
    }));
}
