/**
 * Where a harvest went (Phase 33B, B2): sold, kept, given away or thrown
 * out. Each row takes the FR-09 48-hour lock from its own date (B-29) and
 * is never a hold fact (O-13). Tenant-scoped like every record repo.
 */

import { randomUUID } from 'node:crypto';
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { db } from './client';
import { harvestDispositions } from './schema';
import { tenantValues, withTenant } from './tenant';
import { fromHundredths, toHundredths, type HarvestDispositionKind } from '$lib/harvest/apiSchemas';

export const DISPOSITION_LOCK_WINDOW_MS = 48 * 60 * 60 * 1000;

export interface HarvestDisposition {
  id: string;
  harvestEventId: string;
  kind: HarvestDispositionKind;
  quantity: number;
  unit: string;
  occurredAt: number;
  recipient: string | null;
  soldAsOrganic: boolean | null;
  ledgerEntryId: string | null;
  createdBy: string | null;
  createdAt: number;
  lockedAt: number | null;
}

export interface HarvestDispositionInput {
  harvestEventId: string;
  kind: HarvestDispositionKind;
  quantity: number;
  unit: string;
  occurredAt: number;
  recipient: string | null;
  soldAsOrganic: boolean | null;
}

type Row = typeof harvestDispositions.$inferSelect;

function rowTo(row: Row): HarvestDisposition {
  return {
    id: row.id,
    harvestEventId: row.harvestEventId,
    kind: row.kind,
    quantity: fromHundredths(row.quantityHundredths),
    unit: row.unit,
    occurredAt: row.occurredAt.getTime(),
    recipient: row.recipient ?? null,
    soldAsOrganic: row.soldAsOrganic ?? null,
    ledgerEntryId: row.ledgerEntryId ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt.getTime(),
    lockedAt: row.lockedAt?.getTime() ?? null
  };
}

export function insertHarvestDisposition(
  input: HarvestDispositionInput,
  opts: { createdBy?: string | null; clientRecordId?: string | null; now?: number } = {}
): HarvestDisposition {
  const id = randomUUID();
  const row = db
    .insert(harvestDispositions)
    .values(
      tenantValues({
        id,
        harvestEventId: input.harvestEventId,
        kind: input.kind,
        quantityHundredths: toHundredths(input.quantity),
        unit: input.unit,
        occurredAt: new Date(input.occurredAt),
        recipient: input.recipient,
        soldAsOrganic: input.kind === 'sold' ? input.soldAsOrganic : null,
        clientRecordId: opts.clientRecordId ?? null,
        createdBy: opts.createdBy ?? null,
        createdAt: new Date(opts.now ?? Date.now())
      })
    )
    .returning()
    .get();
  return rowTo(row);
}

export function getHarvestDisposition(id: string): HarvestDisposition | undefined {
  const row = db
    .select()
    .from(harvestDispositions)
    .where(withTenant(harvestDispositions, eq(harvestDispositions.id, id)))
    .get();
  return row ? rowTo(row) : undefined;
}

/** Live dispositions per harvest, oldest first. Harvests with none are
 *  absent from the map. */
export function listDispositionsForHarvests(
  harvestIds: readonly string[]
): Map<string, HarvestDisposition[]> {
  const out = new Map<string, HarvestDisposition[]>();
  if (harvestIds.length === 0) return out;
  const ids = [...new Set(harvestIds)];
  for (let i = 0; i < ids.length; i += 500) {
    const rows = db
      .select()
      .from(harvestDispositions)
      .where(
        withTenant(
          harvestDispositions,
          inArray(harvestDispositions.harvestEventId, ids.slice(i, i + 500))
        )
      )
      .orderBy(asc(harvestDispositions.occurredAt), asc(harvestDispositions.createdAt))
      .all();
    for (const row of rows) {
      const d = rowTo(row);
      const list = out.get(d.harvestEventId);
      if (list) list.push(d);
      else out.set(d.harvestEventId, [d]);
    }
  }
  return out;
}

/** Every disposition dated inside the window (inclusive), oldest first. */
export function listDispositions(window: { fromMs: number; toMs: number }): HarvestDisposition[] {
  return db
    .select()
    .from(harvestDispositions)
    .where(
      withTenant(
        harvestDispositions,
        gte(harvestDispositions.occurredAt, new Date(window.fromMs)),
        lte(harvestDispositions.occurredAt, new Date(window.toMs))
      )
    )
    .orderBy(asc(harvestDispositions.occurredAt), asc(harvestDispositions.createdAt))
    .all()
    .map(rowTo);
}

export function countDispositionsForHarvest(harvestEventId: string): number {
  return db
    .select({ id: harvestDispositions.id })
    .from(harvestDispositions)
    .where(withTenant(harvestDispositions, eq(harvestDispositions.harvestEventId, harvestEventId)))
    .all().length;
}

/** FR-09 (B-29): stamps `locked_at` on the first read past the window and
 *  returns it; undefined while the disposition can still change. */
export function evaluateDispositionLock(
  d: Pick<HarvestDisposition, 'id' | 'occurredAt' | 'createdAt' | 'lockedAt'>,
  now: number = Date.now()
): number | undefined {
  if (d.lockedAt) return d.lockedAt;
  // Measured from the earlier of its date and when it was saved, so moving
  // the date later can never push the lock back past 48 h after the save.
  const lockedAt = Math.min(d.occurredAt, d.createdAt) + DISPOSITION_LOCK_WINDOW_MS;
  if (now < lockedAt) return undefined;
  db.update(harvestDispositions)
    .set({ lockedAt: new Date(lockedAt) })
    .where(withTenant(harvestDispositions, eq(harvestDispositions.id, d.id)))
    .run();
  return lockedAt;
}

export interface DispositionFieldChanges {
  kind?: HarvestDispositionKind;
  quantity?: number;
  unit?: string;
  occurredAt?: number;
  recipient?: string | null;
  soldAsOrganic?: boolean | null;
}

/** Writes already-checked field changes. The caller enforces the lock. */
export function updateHarvestDisposition(
  id: string,
  changes: DispositionFieldChanges
): HarvestDisposition | undefined {
  const set: Partial<typeof harvestDispositions.$inferInsert> = {};
  if (changes.kind !== undefined) set.kind = changes.kind;
  if (changes.quantity !== undefined) set.quantityHundredths = toHundredths(changes.quantity);
  if (changes.unit !== undefined) set.unit = changes.unit;
  if (changes.occurredAt !== undefined) set.occurredAt = new Date(changes.occurredAt);
  if (changes.recipient !== undefined) set.recipient = changes.recipient;
  if (changes.soldAsOrganic !== undefined) set.soldAsOrganic = changes.soldAsOrganic;
  if (Object.keys(set).length > 0) {
    db.update(harvestDispositions)
      .set(set)
      .where(withTenant(harvestDispositions, eq(harvestDispositions.id, id)))
      .run();
  }
  return getHarvestDisposition(id);
}

/** Sets or clears the ledger link (B-31). Allowed after the lock. */
export function setDispositionLedgerEntry(
  id: string,
  ledgerEntryId: string | null
): HarvestDisposition | undefined {
  db.update(harvestDispositions)
    .set({ ledgerEntryId })
    .where(withTenant(harvestDispositions, eq(harvestDispositions.id, id)))
    .run();
  return getHarvestDisposition(id);
}

/** Links a new sale from /finance/new (B-31): only when the disposition is
 *  this Owner's, belongs to `harvestEventId` and has no link yet. Returns
 *  whether it linked. */
export function linkNewSaleToDisposition(
  dispositionId: string,
  harvestEventId: string,
  ledgerEntryId: string
): boolean {
  const r = db
    .update(harvestDispositions)
    .set({ ledgerEntryId })
    .where(
      withTenant(
        harvestDispositions,
        and(
          eq(harvestDispositions.id, dispositionId),
          eq(harvestDispositions.harvestEventId, harvestEventId),
          isNull(harvestDispositions.ledgerEntryId)
        )
      )
    )
    .run();
  return r.changes > 0;
}
