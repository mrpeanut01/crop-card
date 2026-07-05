/**
 * UC-44 — SEASON_CLOSED gate + close/reopen orchestration (#349).
 *
 * The single check-site every record-write endpoint consults. This mirrors
 * the FR-09 lock pattern: a server-enforced immutability boundary that no UI
 * bypass can reach. Where FR-09 locks one record after 48h, this gate locks
 * every record dated inside a *closed season* — the preflight-verified,
 * operator-attested year roll-up.
 *
 * This is an app-layer gate, NOT a safety-kernel rule. RULES_VERSION is not
 * bumped by this feature; it is only stamped into the close snapshot for
 * provenance.
 *
 * Server-only — reads the active tenant via the seasonCloseouts repo.
 */

import { eq } from 'drizzle-orm';
import { RULES_VERSION } from '$lib/safety/version';
import { db } from '$lib/db/client';
import { seasonCloseouts } from '$lib/db/schema';
import { withTenant } from '$lib/db/tenant';
import {
  REOPEN_WINDOW_MS,
  createCloseout,
  getActiveCloseout,
  getCloseout,
  isSeasonClosed,
  reopenCloseout,
  type SeasonCloseout
} from '$lib/db/seasonCloseouts';

/** Machine-readable error code returned to clients when a write is rejected
 *  for landing in a closed season. Endpoints surface this with HTTP 422. */
export const SEASON_CLOSED = 'SEASON_CLOSED' as const;

export interface SeasonClosedBlock {
  code: typeof SEASON_CLOSED;
  year: number;
  closedAt: number;
  message: string;
}

/** The calendar year (local time) a record timestamp falls in. Season
 *  close-outs are keyed on this year. */
export function seasonYearOf(occurredAtMs: number): number {
  return new Date(occurredAtMs).getFullYear();
}

/**
 * THE gate. Call from every record-write endpoint with the record's
 * effective timestamp. Returns a `SeasonClosedBlock` when the write must be
 * refused (the record's year is a currently-closed season for the active
 * tenant); returns `null` when the write may proceed.
 *
 * One check-site: endpoints translate a non-null result into a 422 with the
 * `SEASON_CLOSED` code. Do not re-implement the year→closed lookup elsewhere.
 */
export function checkSeasonClosed(occurredAtMs: number): SeasonClosedBlock | null {
  const year = seasonYearOf(occurredAtMs);
  const active = getActiveCloseout(year);
  if (!active) return null;
  return {
    code: SEASON_CLOSED,
    year,
    closedAt: active.closedAt,
    message: `The ${year} season is closed. Records dated in ${year} can no longer be added or changed. Reopen the season first if a correction is needed.`
  };
}

// ─── Close / reopen orchestration ───────────────────────────────────────

export interface CloseSnapshotInput {
  /** Per-planting resolution roll-up: how each active planting was resolved
   *  (harvested / failed / archived) at close time. */
  plantingResolutions: Array<{ cropId: string; status: string }>;
  /** Harvest roll-up (e.g. event count, or richer totals) for the year. */
  harvestRollup: Record<string, unknown>;
  /** Count of pending offline records still queued at close time. Close is
   *  only allowed at zero, but the value is snapshotted for the audit. */
  pendingCount: number;
}

export interface CloseSeasonInput extends CloseSnapshotInput {
  year: number;
  closedById?: string | null;
  closedAt?: number;
}

export type CloseSeasonResult =
  | { ok: true; closeout: SeasonCloseout }
  | { ok: false; code: 'ALREADY_CLOSED'; year: number };

/**
 * Close `year` for the active tenant. Writes one `season_closeouts` row with
 * the preflight snapshot + a RULES_VERSION stamp (provenance only). Refuses
 * when the season is already actively closed. Preflight enforcement (pending
 * drained, plantings resolved, harvest attested) is the caller's job — this
 * function assumes the checklist passed and records the outcome.
 */
export function closeSeason(input: CloseSeasonInput): CloseSeasonResult {
  if (isSeasonClosed(input.year)) {
    return { ok: false, code: 'ALREADY_CLOSED', year: input.year };
  }

  const snapshot = {
    version: 1,
    rulesVersion: RULES_VERSION,
    closedAtIso: new Date(input.closedAt ?? Date.now()).toISOString(),
    plantingResolutions: input.plantingResolutions,
    harvestRollup: input.harvestRollup,
    pendingCount: input.pendingCount
  };

  // If a reopened (stale) row exists for this year, drop it so the new close
  // can take the (owner_id, year) UNIQUE slot. The reopen keeps its own audit
  // via the superadmin/close audit trail; the row itself is disposable.
  const existing = getCloseout(input.year);
  if (existing && existing.reopenedAt !== null) {
    // Re-close after a reopen: delete the stale reopened row, then insert.
    deleteReopenedRow(existing.id);
  }

  const closeout = createCloseout({
    year: input.year,
    snapshotJson: JSON.stringify(snapshot),
    closedById: input.closedById ?? null,
    closedAt: input.closedAt
  });
  return { ok: true, closeout };
}

export type ReopenSeasonResult =
  | { ok: true; closeout: SeasonCloseout }
  | { ok: false; code: 'NOT_CLOSED'; year: number }
  | { ok: false; code: 'WINDOW_EXPIRED'; year: number; closedAt: number };

/**
 * Reopen `year` for the active tenant — allowed only within
 * `REOPEN_WINDOW_MS` of the close. Past the window the close is permanent.
 */
export function reopenSeason(year: number, now: number = Date.now()): ReopenSeasonResult {
  const active = getActiveCloseout(year);
  if (!active) return { ok: false, code: 'NOT_CLOSED', year };
  if (now - active.closedAt > REOPEN_WINDOW_MS) {
    return { ok: false, code: 'WINDOW_EXPIRED', year, closedAt: active.closedAt };
  }
  const reopened = reopenCloseout(year, now);
  if (!reopened) return { ok: false, code: 'NOT_CLOSED', year };
  return { ok: true, closeout: reopened };
}

/** True while `year` can still be reopened (closed + inside the window). */
export function canReopen(year: number, now: number = Date.now()): boolean {
  const active = getActiveCloseout(year);
  if (!active) return false;
  return now - active.closedAt <= REOPEN_WINDOW_MS;
}

// ─── internal ───────────────────────────────────────────────────────────

function deleteReopenedRow(id: string): void {
  db.delete(seasonCloseouts)
    .where(withTenant(seasonCloseouts, eq(seasonCloseouts.id, id)))
    .run();
}
