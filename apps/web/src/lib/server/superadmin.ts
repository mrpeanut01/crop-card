/**
 * Superadmin operations (Phase 18g).
 *
 * Superadmin is cross-tenant: a single boolean on the users table (NOT
 * a role enum value) because roles describe in-tenant permissions and
 * adding a fifth case would force every role check in the codebase to
 * handle it. Read-only by default; impersonation requires an explicit
 * action and writes an audit row per mutation.
 */

import { randomUUID } from 'node:crypto';
import { db } from '$lib/db/client';
import { owners, ownerSubscriptions, ownerUsageCounters, superadminAudit, users } from '$lib/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { unscopedQueryNote } from '$lib/db/tenant';

export interface OwnerSummary {
  id: string;
  name: string;
  slug: string;
  billingStatus: string;
  createdAt: number;
  /** Most-recent month's AI calls + spray events. Null if no counter row exists. */
  currentPeriodAiCalls: number;
  currentPeriodSprayEvents: number;
}

export function listAllOwners(): OwnerSummary[] {
  unscopedQueryNote('superadmin needs to enumerate every tenant');
  const ownerRows = db
    .select({
      id: owners.id,
      name: owners.name,
      slug: owners.slug,
      billingStatus: owners.billingStatus,
      createdAt: owners.createdAt
    })
    .from(owners)
    .orderBy(desc(owners.createdAt))
    .all();
  if (ownerRows.length === 0) return [];

  unscopedQueryNote('per-tenant usage counters for the superadmin dashboard');
  const period = yyyymm(Date.now());
  return ownerRows.map((row) => {
    const usage = db
      .select()
      .from(ownerUsageCounters)
      .where(eq(ownerUsageCounters.ownerId, row.id))
      .all()
      .find((r) => r.periodYyyymm === period);
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      billingStatus: row.billingStatus,
      createdAt: row.createdAt.getTime(),
      currentPeriodAiCalls: usage?.aiCalls ?? 0,
      currentPeriodSprayEvents: usage?.sprayEventsCount ?? 0
    };
  });
}

export function setBillingStatus(
  ownerId: string,
  status: 'trial' | 'active' | 'past_due' | 'canceled' | 'suspended',
  superadminUserId: string
): void {
  unscopedQueryNote('superadmin billing-status flip is intentionally cross-tenant');
  db.transaction(() => {
    db.update(owners).set({ billingStatus: status }).where(eq(owners.id, ownerId)).run();
    db.update(ownerSubscriptions)
      .set({ status, updatedAt: new Date(Date.now()) })
      .where(eq(ownerSubscriptions.ownerId, ownerId))
      .run();
    writeAuditRow({
      superadminUserId,
      action: 'set_billing_status',
      ownerId,
      payload: { status }
    });
  });
}

export function setSuperadmin(userId: string, value: boolean, byUserId: string): void {
  unscopedQueryNote('promote/demote a global superadmin');
  db.update(users).set({ isSuperadmin: value }).where(eq(users.id, userId)).run();
  writeAuditRow({
    superadminUserId: byUserId,
    action: value ? 'grant_superadmin' : 'revoke_superadmin',
    ownerId: null,
    targetTable: 'users',
    targetId: userId,
    payload: null
  });
}

export interface AuditRowInput {
  superadminUserId: string;
  action: string;
  ownerId: string | null;
  targetTable?: string;
  targetId?: string;
  payload?: Record<string, unknown> | null;
}

export function writeAuditRow(input: AuditRowInput): void {
  unscopedQueryNote('superadmin_audit is intentionally cross-tenant by design');
  db.insert(superadminAudit)
    .values({
      id: `sa_${randomUUID().slice(0, 12)}`,
      superadminUserId: input.superadminUserId,
      action: input.action,
      ownerId: input.ownerId,
      targetTable: input.targetTable ?? null,
      targetId: input.targetId ?? null,
      payloadJson: input.payload === undefined || input.payload === null ? null : JSON.stringify(input.payload),
      at: new Date(Date.now())
    })
    .run();
}

export interface AuditEntry {
  id: string;
  superadminUserId: string;
  action: string;
  ownerId: string | null;
  targetTable: string | null;
  targetId: string | null;
  at: number;
}

export function listAudit(limit = 200): AuditEntry[] {
  unscopedQueryNote('superadmin_audit list is cross-tenant');
  return db
    .select()
    .from(superadminAudit)
    .orderBy(desc(superadminAudit.at))
    .limit(limit)
    .all()
    .map((r) => ({
      id: r.id,
      superadminUserId: r.superadminUserId,
      action: r.action,
      ownerId: r.ownerId,
      targetTable: r.targetTable,
      targetId: r.targetId,
      at: r.at.getTime()
    }));
}

/** YYYYMM integer for a millisecond timestamp. Used as the partition key
 *  for usage counters. */
export function yyyymm(ms: number): number {
  const d = new Date(ms);
  return d.getUTCFullYear() * 100 + (d.getUTCMonth() + 1);
}

/** UPSERT an increment onto the (owner, period) counter row. SQLite's
 *  `excluded.<column>` pseudo-row gives access to the proposed values, so
 *  the conflict path can read the new counts and add them to the existing
 *  totals atomically. */
export function incrementUsageCounter(
  ownerId: string,
  patch: { aiCalls?: number; sprayEventsCount?: number; storageBytes?: number }
): void {
  unscopedQueryNote('usage counter UPSERT — keyed by (owner, period_yyyymm)');
  const period = yyyymm(Date.now());
  const aiCalls = patch.aiCalls ?? 0;
  const sprayEventsCount = patch.sprayEventsCount ?? 0;
  const storageBytes = patch.storageBytes ?? 0;
  if (aiCalls === 0 && sprayEventsCount === 0 && storageBytes === 0) return;
  db.run(sql`
    INSERT INTO owner_usage_counters
      (owner_id, period_yyyymm, ai_calls, spray_events_count, storage_bytes, updated_at)
    VALUES
      (${ownerId}, ${period}, ${aiCalls}, ${sprayEventsCount}, ${storageBytes}, ${Date.now()})
    ON CONFLICT(owner_id, period_yyyymm) DO UPDATE SET
      ai_calls = ai_calls + excluded.ai_calls,
      spray_events_count = spray_events_count + excluded.spray_events_count,
      storage_bytes = storage_bytes + excluded.storage_bytes,
      updated_at = excluded.updated_at
  `);
}
