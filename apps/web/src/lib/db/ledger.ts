/**
 * Owner-only expenses and income (Phase 32F, F2). Every write lands with a
 * `ledger_entry_changes` row in the same transaction (F2-9). There is no
 * lock and no hard delete: delete sets `deleted_at` and restore clears it
 * (F2-10). The farm wipe is the only path that removes rows.
 */

import { randomUUID } from 'node:crypto';
import { asc, desc, eq, gte, isNotNull, isNull, lt, ne, type SQL } from 'drizzle-orm';
import { db } from './client';
import { ledgerEntries, ledgerEntryChanges, LEDGER_CHANGE_ACTIONS } from './schema';
import { tenantValues, withTenant } from './tenant';
import type { LedgerKind } from '$lib/finance/categories';

export type LedgerChangeAction = (typeof LEDGER_CHANGE_ACTIONS)[number];

export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  occurredAt: number;
  amountCents: number;
  category: string | null;
  description: string | null;
  cropId: string | null;
  blockId: string | null;
  fieldId: string | null;
  animalId: string | null;
  animalGroupId: string | null;
  stockLotId: string | null;
  harvestEventId: string | null;
  enterprise: string | null;
  quantity: number | null;
  unit: string | null;
  provenance: 'manual' | 'data';
  createdById: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface LedgerChange {
  id: string;
  entryId: string;
  action: LedgerChangeAction;
  changedById: string | null;
  changedAt: number;
  before: Partial<LedgerEntry> | null;
  after: Partial<LedgerEntry> | null;
}

/** The fields a caller may set. Links are checked by the route. */
export interface LedgerEntryInput {
  kind: LedgerKind;
  occurredAt: number;
  amountCents: number;
  category: string;
  description?: string | null;
  cropId?: string | null;
  blockId?: string | null;
  fieldId?: string | null;
  animalId?: string | null;
  animalGroupId?: string | null;
  stockLotId?: string | null;
  harvestEventId?: string | null;
  enterprise?: string | null;
  quantity?: number | null;
  unit?: string | null;
}

/** F2-11: a lot may have at most one live linked expense. */
export class LotAlreadyExpensedError extends Error {
  constructor(readonly entryId: string) {
    super('This stock lot already has a purchase expense.');
    this.name = 'LotAlreadyExpensedError';
  }
}

type Row = typeof ledgerEntries.$inferSelect;

function rowToEntry(r: Row): LedgerEntry {
  return {
    id: r.id,
    kind: r.kind,
    occurredAt: r.occurredAt.getTime(),
    amountCents: r.amountCents,
    category: r.category ?? null,
    description: r.description ?? null,
    cropId: r.cropId ?? null,
    blockId: r.blockId ?? null,
    fieldId: r.fieldId ?? null,
    animalId: r.animalId ?? null,
    animalGroupId: r.animalGroupId ?? null,
    stockLotId: r.stockLotId ?? null,
    harvestEventId: r.harvestEventId ?? null,
    enterprise: r.enterprise ?? null,
    quantity: r.quantity ?? null,
    unit: r.unit ?? null,
    provenance: r.provenance,
    createdById: r.createdById ?? null,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
    deletedAt: r.deletedAt ? r.deletedAt.getTime() : null
  };
}

function clean(s: string | null | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}

function toColumns(input: LedgerEntryInput) {
  return {
    kind: input.kind,
    occurredAt: new Date(input.occurredAt),
    amountCents: input.amountCents,
    category: input.category,
    description: clean(input.description),
    cropId: input.cropId ?? null,
    blockId: input.blockId ?? null,
    fieldId: input.fieldId ?? null,
    animalId: input.animalId ?? null,
    animalGroupId: input.animalGroupId ?? null,
    stockLotId: input.stockLotId ?? null,
    harvestEventId: input.harvestEventId ?? null,
    enterprise: clean(input.enterprise),
    quantity: input.quantity ?? null,
    unit: clean(input.unit)
  };
}

/** What the audit row keeps: the entry's own fields, not its timestamps. */
function auditCopy(e: LedgerEntry): Partial<LedgerEntry> {
  const { createdAt: _c, updatedAt: _u, ...rest } = e;
  void _c;
  void _u;
  return rest;
}

function writeChange(
  entryId: string,
  action: LedgerChangeAction,
  changedById: string | null,
  before: LedgerEntry | null,
  after: LedgerEntry | null,
  at: number
): void {
  db.insert(ledgerEntryChanges)
    .values(
      tenantValues({
        id: randomUUID(),
        entryId,
        action,
        changedById,
        changedAt: new Date(at),
        beforeJson: before ? JSON.stringify(auditCopy(before)) : null,
        afterJson: after ? JSON.stringify(auditCopy(after)) : null
      })
    )
    .run();
}

function readEntry(id: string): LedgerEntry | undefined {
  const row = db
    .select()
    .from(ledgerEntries)
    .where(withTenant(ledgerEntries, eq(ledgerEntries.id, id)))
    .get();
  return row ? rowToEntry(row) : undefined;
}

function assertLotFree(stockLotId: string | null, exceptId: string | null): void {
  if (!stockLotId) return;
  const clash = db
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .where(
      withTenant(
        ledgerEntries,
        eq(ledgerEntries.stockLotId, stockLotId),
        eq(ledgerEntries.kind, 'expense'),
        isNull(ledgerEntries.deletedAt),
        exceptId ? ne(ledgerEntries.id, exceptId) : undefined
      )
    )
    .get();
  if (clash) throw new LotAlreadyExpensedError(clash.id);
}

export function getLedgerEntry(id: string): LedgerEntry | undefined {
  return readEntry(id);
}

export type LedgerListState = 'live' | 'deleted' | 'all';

export function listLedgerEntries(
  opts: { fromMs?: number; toMs?: number; state?: LedgerListState } = {}
): LedgerEntry[] {
  const state = opts.state ?? 'live';
  const filters: Array<SQL | undefined> = [
    opts.fromMs !== undefined ? gte(ledgerEntries.occurredAt, new Date(opts.fromMs)) : undefined,
    opts.toMs !== undefined ? lt(ledgerEntries.occurredAt, new Date(opts.toMs)) : undefined,
    state === 'live'
      ? isNull(ledgerEntries.deletedAt)
      : state === 'deleted'
        ? isNotNull(ledgerEntries.deletedAt)
        : undefined
  ];
  return db
    .select()
    .from(ledgerEntries)
    .where(withTenant(ledgerEntries, ...filters))
    .orderBy(desc(ledgerEntries.occurredAt), desc(ledgerEntries.createdAt))
    .all()
    .map(rowToEntry);
}

/** The live purchase expense recorded for a lot, if any. */
export function liveExpenseForLot(stockLotId: string): LedgerEntry | undefined {
  const row = db
    .select()
    .from(ledgerEntries)
    .where(
      withTenant(
        ledgerEntries,
        eq(ledgerEntries.stockLotId, stockLotId),
        eq(ledgerEntries.kind, 'expense'),
        isNull(ledgerEntries.deletedAt)
      )
    )
    .get();
  return row ? rowToEntry(row) : undefined;
}

export function hasAnyLedgerEntry(): boolean {
  return (
    db
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(withTenant(ledgerEntries))
      .limit(1)
      .get() !== undefined
  );
}

export function insertLedgerEntry(
  input: LedgerEntryInput,
  changedById: string | null,
  now = Date.now()
): LedgerEntry {
  return db.transaction(() => {
    if (input.kind === 'expense') assertLotFree(input.stockLotId ?? null, null);
    const id = randomUUID();
    db.insert(ledgerEntries)
      .values(
        tenantValues({
          id,
          ...toColumns(input),
          provenance: 'manual' as const,
          createdById: changedById,
          createdAt: new Date(now),
          updatedAt: new Date(now)
        })
      )
      .run();
    const after = readEntry(id)!;
    writeChange(id, 'create', changedById, null, after, now);
    return after;
  });
}

/** Replaces the entry's fields with `next` (already merged and checked by
 *  the caller). Undefined when there is no such entry. */
export function updateLedgerEntry(
  id: string,
  next: LedgerEntryInput,
  changedById: string | null,
  now = Date.now()
): LedgerEntry | undefined {
  return db.transaction(() => {
    const before = readEntry(id);
    if (!before) return undefined;
    if (next.kind === 'expense' && before.deletedAt === null) {
      assertLotFree(next.stockLotId ?? null, id);
    }
    db.update(ledgerEntries)
      .set({ ...toColumns(next), updatedAt: new Date(now) })
      .where(withTenant(ledgerEntries, eq(ledgerEntries.id, id)))
      .run();
    const after = readEntry(id)!;
    writeChange(id, 'update', changedById, before, after, now);
    return after;
  });
}

function setDeleted(
  id: string,
  deleted: boolean,
  changedById: string | null,
  now: number
): LedgerEntry | undefined {
  return db.transaction(() => {
    const before = readEntry(id);
    if (!before) return undefined;
    if ((before.deletedAt !== null) === deleted) return before;
    if (!deleted && before.kind === 'expense') assertLotFree(before.stockLotId, id);
    db.update(ledgerEntries)
      .set({ deletedAt: deleted ? new Date(now) : null, updatedAt: new Date(now) })
      .where(withTenant(ledgerEntries, eq(ledgerEntries.id, id)))
      .run();
    const after = readEntry(id)!;
    writeChange(id, deleted ? 'delete' : 'restore', changedById, before, after, now);
    return after;
  });
}

export function softDeleteLedgerEntry(
  id: string,
  changedById: string | null,
  now = Date.now()
): LedgerEntry | undefined {
  return setDeleted(id, true, changedById, now);
}

export function restoreLedgerEntry(
  id: string,
  changedById: string | null,
  now = Date.now()
): LedgerEntry | undefined {
  return setDeleted(id, false, changedById, now);
}

function parseSnapshot(raw: string | null): Partial<LedgerEntry> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Partial<LedgerEntry>;
  } catch {
    return null;
  }
}

export function listLedgerChanges(entryId: string): LedgerChange[] {
  return db
    .select()
    .from(ledgerEntryChanges)
    .where(withTenant(ledgerEntryChanges, eq(ledgerEntryChanges.entryId, entryId)))
    .orderBy(asc(ledgerEntryChanges.changedAt), asc(ledgerEntryChanges.id))
    .all()
    .map((r) => ({
      id: r.id,
      entryId: r.entryId,
      action: r.action,
      changedById: r.changedById ?? null,
      changedAt: r.changedAt.getTime(),
      before: parseSnapshot(r.beforeJson),
      after: parseSnapshot(r.afterJson)
    }));
}

/** Plain input from a stored entry, for merging a patch over it. */
export function entryToInput(e: LedgerEntry): LedgerEntryInput {
  return {
    kind: e.kind,
    occurredAt: e.occurredAt,
    amountCents: e.amountCents,
    category: e.category ?? 'other',
    description: e.description,
    cropId: e.cropId,
    blockId: e.blockId,
    fieldId: e.fieldId,
    animalId: e.animalId,
    animalGroupId: e.animalGroupId,
    stockLotId: e.stockLotId,
    harvestEventId: e.harvestEventId,
    enterprise: e.enterprise,
    quantity: e.quantity,
    unit: e.unit
  };
}
