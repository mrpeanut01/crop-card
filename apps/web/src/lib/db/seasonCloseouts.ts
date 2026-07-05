/**
 * UC-44 — Season close-out repo (#349).
 *
 * One row per (owner_id, year). A row whose `reopenedAt` is null marks that
 * season as *closed*: the shared `SEASON_CLOSED` gate (lib/server/seasonClose.ts)
 * consults `getActiveCloseout(year)` and refuses record-writes dated inside a
 * closed year. Reopen within the 7-day window stamps `reopenedAt` (the gate then
 * treats the season as open again); past the window the close is permanent.
 *
 * Tenant-scoped per CLAUDE.md invariant 6 — every read/write funnels through
 * `withTenant` / `tenantValues`. Wired into the cross-tenant property test.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from './client';
import { seasonCloseouts } from './schema';
import { tenantValues, withTenant } from './tenant';

/** Reversible-reopen window. After this elapses since `closedAt`, a closed
 *  season can no longer be reopened — the close is permanent (UC-44). */
export const REOPEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface SeasonCloseout {
  id: string;
  ownerId: string;
  year: number;
  closedAt: number;
  closedById: string | null;
  snapshotJson: string;
  reopenedAt: number | null;
}

function rowToDomain(row: typeof seasonCloseouts.$inferSelect): SeasonCloseout {
  return {
    id: row.id,
    ownerId: row.ownerId,
    year: row.year,
    closedAt: row.closedAt.getTime(),
    closedById: row.closedById,
    snapshotJson: row.snapshotJson,
    reopenedAt: row.reopenedAt ? row.reopenedAt.getTime() : null
  };
}

/** The row for `year`, reopened or not. Null when the season was never closed. */
export function getCloseout(year: number): SeasonCloseout | null {
  const row = db
    .select()
    .from(seasonCloseouts)
    .where(withTenant(seasonCloseouts, eq(seasonCloseouts.year, year)))
    .get();
  return row ? rowToDomain(row) : null;
}

/** The row for `year` only when it represents an *active* (non-reopened)
 *  close — this is what the SEASON_CLOSED gate keys on. Null when the season
 *  is open (never closed, or closed-then-reopened). */
export function getActiveCloseout(year: number): SeasonCloseout | null {
  const row = db
    .select()
    .from(seasonCloseouts)
    .where(
      withTenant(
        seasonCloseouts,
        and(eq(seasonCloseouts.year, year), isNull(seasonCloseouts.reopenedAt))
      )
    )
    .get();
  return row ? rowToDomain(row) : null;
}

/** True iff `year` is currently closed for the active tenant. */
export function isSeasonClosed(year: number): boolean {
  return getActiveCloseout(year) !== null;
}

export function listCloseouts(): SeasonCloseout[] {
  return db
    .select()
    .from(seasonCloseouts)
    .where(withTenant(seasonCloseouts))
    .orderBy(desc(seasonCloseouts.year))
    .all()
    .map(rowToDomain);
}

export interface CreateCloseoutInput {
  year: number;
  snapshotJson: string;
  closedById?: string | null;
  closedAt?: number;
}

/**
 * Insert the close row for `year`. Idempotency + the "already closed"
 * decision live in the caller (lib/server/seasonClose.ts) — this repo throws
 * on the `(owner_id, year)` UNIQUE conflict so a double-close is a hard error,
 * not a silent overwrite. To re-close after a reopen, the caller drops the
 * stale reopened row first (see `closeSeason` in lib/server/seasonClose.ts).
 */
export function createCloseout(input: CreateCloseoutInput): SeasonCloseout {
  const row = db
    .insert(seasonCloseouts)
    .values(
      tenantValues({
        id: randomUUID(),
        year: input.year,
        snapshotJson: input.snapshotJson,
        closedById: input.closedById ?? null,
        ...(input.closedAt !== undefined ? { closedAt: new Date(input.closedAt) } : {})
      })
    )
    .returning()
    .get();
  return rowToDomain(row);
}

/**
 * Stamp `reopenedAt` on the active close for `year`, reopening the season.
 * Returns the updated row, or null when there is no active close to reopen.
 * The 7-day-window enforcement lives in the caller so it can return a precise
 * error; this repo just performs the write.
 */
export function reopenCloseout(
  year: number,
  reopenedAt: number = Date.now()
): SeasonCloseout | null {
  const active = getActiveCloseout(year);
  if (!active) return null;
  const row = db
    .update(seasonCloseouts)
    .set({ reopenedAt: new Date(reopenedAt) })
    .where(withTenant(seasonCloseouts, eq(seasonCloseouts.id, active.id)))
    .returning()
    .get();
  return row ? rowToDomain(row) : null;
}
