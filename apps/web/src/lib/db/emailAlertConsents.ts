/**
 * Opt-in consent for field alerts by email, per (active Owner, user, category).
 * Tenant-scoped like push subscriptions: every read and write goes through
 * `withTenant` / `tenantValues`, so a consent given on farm A never sends
 * farm B's alerts. The only cross-tenant read lists Owner ids for the
 * scheduler, which then re-enters each Owner through `runWithTenantAsync`.
 */

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from './client';
import { emailAlertConsents } from './schema';
import { tenantValues, unscopedQueryNote, withTenant } from './tenant';
import {
  DEFAULT_EMAIL_ALERT_PREFS,
  EMAIL_ALERT_CATEGORIES,
  type EmailAlertCategory,
  type EmailAlertPrefs
} from '$lib/email/alertCategories';

export type ConsentSource = 'settings' | 'unsubscribe-page' | 'one-click' | 'pingram-webhook';

export interface ConsentChange {
  source: ConsentSource;
  ip?: string | null;
  at?: number;
}

export interface EmailConsentRecord {
  userId: string;
  category: EmailAlertCategory;
  optedInAt: number | null;
  optedInSource: string | null;
  optedInIp: string | null;
}

export function getEmailPrefsForUser(userId: string): EmailAlertPrefs {
  const prefs: EmailAlertPrefs = { ...DEFAULT_EMAIL_ALERT_PREFS };
  const rows = db
    .select({ category: emailAlertConsents.category, status: emailAlertConsents.status })
    .from(emailAlertConsents)
    .where(withTenant(emailAlertConsents, eq(emailAlertConsents.userId, userId)))
    .all();
  for (const r of rows) prefs[r.category] = r.status === 'opted-in';
  return prefs;
}

export function optIn(userId: string, category: EmailAlertCategory, change: ConsentChange): void {
  const at = new Date(change.at ?? Date.now());
  const fields = {
    status: 'opted-in' as const,
    optedInAt: at,
    optedInSource: change.source,
    optedInIp: change.ip ?? null,
    updatedAt: at
  };
  db.insert(emailAlertConsents)
    .values(tenantValues({ id: randomUUID(), userId, category, ...fields }))
    .onConflictDoUpdate({
      target: [emailAlertConsents.ownerId, emailAlertConsents.userId, emailAlertConsents.category],
      set: fields
    })
    .run();
}

/** Turn one category off. Returns true when it was on. Idempotent. */
export function optOut(
  userId: string,
  category: EmailAlertCategory,
  change: ConsentChange
): boolean {
  const at = new Date(change.at ?? Date.now());
  const res = db
    .update(emailAlertConsents)
    .set({ status: 'opted-out', optedOutAt: at, optedOutSource: change.source, updatedAt: at })
    .where(
      withTenant(
        emailAlertConsents,
        and(
          eq(emailAlertConsents.userId, userId),
          eq(emailAlertConsents.category, category),
          eq(emailAlertConsents.status, 'opted-in')
        )
      )
    )
    .run();
  return res.changes > 0;
}

/** Turn every category off for this user on the active Owner. Returns the
 *  categories that were on. */
export function optOutAll(userId: string, change: ConsentChange): EmailAlertCategory[] {
  const turnedOff: EmailAlertCategory[] = [];
  for (const category of EMAIL_ALERT_CATEGORIES) {
    if (optOut(userId, category, change)) turnedOff.push(category);
  }
  return turnedOff;
}

export function listOptedIn(): EmailConsentRecord[] {
  return db
    .select()
    .from(emailAlertConsents)
    .where(withTenant(emailAlertConsents, eq(emailAlertConsents.status, 'opted-in')))
    .all()
    .map((r) => ({
      userId: r.userId,
      category: r.category,
      optedInAt: r.optedInAt ? r.optedInAt.getTime() : null,
      optedInSource: r.optedInSource,
      optedInIp: r.optedInIp
    }));
}

/** Scheduler entry point: which tenants have at least one email opt-in. */
export function listOwnerIdsWithEmailOptIns(): string[] {
  unscopedQueryNote(
    'alert scheduler enumerates tenants with email opt-ins, then re-enters each via runWithTenant'
  );
  return db
    .selectDistinct({ ownerId: emailAlertConsents.ownerId })
    .from(emailAlertConsents)
    .where(eq(emailAlertConsents.status, 'opted-in'))
    .all()
    .map((r) => r.ownerId);
}

/** Full consent history for the GDPR export: both states, with timestamps. */
export function listConsentHistoryForUser(userId: string) {
  return db
    .select()
    .from(emailAlertConsents)
    .where(withTenant(emailAlertConsents, eq(emailAlertConsents.userId, userId)))
    .all()
    .map((r) => ({
      category: r.category,
      status: r.status,
      optedInAt: r.optedInAt ? r.optedInAt.toISOString() : null,
      optedInSource: r.optedInSource,
      optedInIp: r.optedInIp,
      optedOutAt: r.optedOutAt ? r.optedOutAt.toISOString() : null,
      optedOutSource: r.optedOutSource
    }));
}
