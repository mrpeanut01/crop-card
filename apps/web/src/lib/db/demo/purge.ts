import { and, asc, eq, inArray, like, lt, notExists, sql } from 'drizzle-orm';
import { db, sqliteHandle } from '../client';
import { blobDeletions, helperAssignments, owners, users } from '../schema';
import { unscopedQueryNote } from '../tenant';
import { ownerStoragePrefix } from '../documents';
import {
  DEMO_EMAIL_DOMAIN,
  DEMO_OWNER_PREFIX,
  DEMO_TTL_MS,
  isDemoOwnerId
} from '$lib/demo/identity';
import { realNow } from '$lib/server/clock';

/** Global tables that carry an owner id for context only and outlive the
 *  farm (feedback triage, the superadmin audit trail). */
const KEEP_TABLES = new Set(['feedback_submissions', 'superadmin_audit']);

function tablesWithOwnerId(): string[] {
  const rows = sqliteHandle()
    .prepare(
      `SELECT m.name AS name FROM sqlite_master m, pragma_table_info(m.name) p
       WHERE m.type = 'table' AND p.name = 'owner_id'`
    )
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name).filter((n) => !KEEP_TABLES.has(n) && /^[a-z0-9_]+$/.test(n));
}

/**
 * Deletes one demo farm outright: every row carrying its owner id, the
 * owner row, and the throwaway demo users that belonged to it. Refuses any
 * id that is not a demo id, so a real farm can never reach this path.
 * @hold-exempt: a demo farm is erased whole, every record with it
 */
export function purgeDemoOwner(ownerId: string): { rows: number } {
  if (!isDemoOwnerId(ownerId)) throw new Error('purgeDemoOwner: not a demo owner id');
  unscopedQueryNote('demo purge erases one demo owner by id across every tenant table');
  const sqlite = sqliteHandle();
  const tables = tablesWithOwnerId();
  return db.transaction(() => {
    sqlite.pragma('defer_foreign_keys = ON');
    const memberIds = db
      .select({ userId: helperAssignments.userId })
      .from(helperAssignments)
      .where(eq(helperAssignments.ownerId, ownerId))
      .all()
      .map((r) => r.userId);
    let rows = 0;
    for (const t of tables) {
      rows += sqlite.prepare(`DELETE FROM "${t}" WHERE owner_id = ?`).run(ownerId).changes;
    }
    db.insert(blobDeletions)
      .values({ storagePrefix: ownerStoragePrefix(ownerId) })
      .onConflictDoNothing()
      .run();
    rows += db.delete(owners).where(eq(owners.id, ownerId)).run().changes;
    if (memberIds.length) {
      rows += db
        .delete(users)
        .where(and(inArray(users.id, memberIds), like(users.email, `%@${DEMO_EMAIL_DOMAIN}`)))
        .run().changes;
    }
    return { rows };
  });
}

/** LIKE treats `_` as a wildcard, so the prefix is compared exactly. */
function isDemoIdSql() {
  return sql`substr(${owners.id}, 1, ${DEMO_OWNER_PREFIX.length}) = ${DEMO_OWNER_PREFIX}`;
}

/** Demo owners created before `cutoffMs`, oldest first. */
export function listExpiredDemoOwnerIds(cutoffMs: number, limit: number): string[] {
  unscopedQueryNote('demo expiry sweep reads demo owner ids across all tenants');
  return db
    .select({ id: owners.id })
    .from(owners)
    .where(and(isDemoIdSql(), lt(owners.createdAt, new Date(cutoffMs))))
    .orderBy(asc(owners.createdAt))
    .limit(limit)
    .all()
    .map((r) => r.id);
}

export function countDemoOwners(): number {
  unscopedQueryNote('demo capacity check counts demo owners across all tenants');
  const row = sqliteHandle()
    .prepare(`SELECT COUNT(*) AS n FROM owners WHERE substr(id, 1, ?) = ?`)
    .get(DEMO_OWNER_PREFIX.length, DEMO_OWNER_PREFIX) as { n: number };
  return row.n;
}

/** Deletes up to `limit` demo farms whose time is up, oldest first.
 *  @hold-exempt: only whole demo farms are erased */
export function purgeExpiredDemoOwners(now = realNow(), limit = 25): number {
  let purged = 0;
  for (const id of listExpiredDemoOwnerIds(now - DEMO_TTL_MS, limit)) {
    try {
      purgeDemoOwner(id);
      purged++;
    } catch (err) {
      console.error('[demo] failed to purge an expired demo farm', id, err);
    }
  }
  return purged;
}

/** Deletes a demo user that never got as far as creating a farm. */
export function deleteFarmlessDemoUser(userId: string): void {
  unscopedQueryNote('demo cleanup deletes one farmless demo user by id');
  db.delete(users)
    .where(
      and(
        eq(users.id, userId),
        like(users.email, `%@${DEMO_EMAIL_DOMAIN}`),
        notExists(
          db
            .select({ u: helperAssignments.userId })
            .from(helperAssignments)
            .where(eq(helperAssignments.userId, userId))
        )
      )
    )
    .run();
}

/** Farmless demo users whose time is up (a "Start from scratch" visitor who
 *  left before naming a farm). */
export function purgeExpiredFarmlessDemoUsers(now = realNow(), limit = 25): number {
  unscopedQueryNote('demo expiry sweep reads farmless demo users across all tenants');
  const ids = db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        like(users.email, `%@${DEMO_EMAIL_DOMAIN}`),
        lt(users.createdAt, new Date(now - DEMO_TTL_MS)),
        notExists(
          db
            .select({ u: helperAssignments.userId })
            .from(helperAssignments)
            .where(eq(helperAssignments.userId, users.id))
        )
      )
    )
    .limit(limit)
    .all();
  let purged = 0;
  for (const { id } of ids) {
    try {
      deleteFarmlessDemoUser(id);
      purged++;
    } catch (err) {
      console.error('[demo] failed to delete an expired farmless demo user', id, err);
    }
  }
  return purged;
}
