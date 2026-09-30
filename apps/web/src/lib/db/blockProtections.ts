import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from './client';
import { blockProtections } from './schema';
import { tenantValues, withTenant } from './tenant';
import type {
  BlockProtection,
  ProtectionKind,
  ProtectionProvenance
} from '$lib/climate/protection';

export interface BlockProtectionRow extends BlockProtection {
  notes: string | null;
  createdAt: number;
}

const ms = (v: Date | number | null): number | null =>
  v === null ? null : v instanceof Date ? v.getTime() : Number(v);

function toRow(r: typeof blockProtections.$inferSelect): BlockProtectionRow {
  return {
    id: r.id,
    blockId: r.blockId,
    kind: r.kind,
    springShiftDays: r.springShiftDays,
    fallShiftDays: r.fallShiftDays,
    provenance: r.provenance,
    installedOn: ms(r.installedOn),
    removedOn: ms(r.removedOn),
    seasonYear: r.seasonYear,
    notes: r.notes,
    createdAt: ms(r.createdAt) ?? 0
  };
}

/** Covers on the given blocks, one query. */
export function listBlockProtections(blockIds: readonly string[]): BlockProtectionRow[] {
  if (blockIds.length === 0) return [];
  return db
    .select()
    .from(blockProtections)
    .where(withTenant(blockProtections, inArray(blockProtections.blockId, [...new Set(blockIds)])))
    .orderBy(asc(blockProtections.createdAt), asc(blockProtections.id))
    .all()
    .map(toRow);
}

/** Every cover on the farm, one query. */
export function listAllBlockProtections(): BlockProtectionRow[] {
  return db
    .select()
    .from(blockProtections)
    .where(withTenant(blockProtections))
    .orderBy(asc(blockProtections.createdAt), asc(blockProtections.id))
    .all()
    .map(toRow);
}

export interface InsertBlockProtectionInput {
  blockId: string;
  kind: ProtectionKind;
  springShiftDays: number | null;
  fallShiftDays: number | null;
  provenance: ProtectionProvenance;
  installedOn: number | null;
  removedOn: number | null;
  seasonYear: number | null;
  notes: string | null;
}

/** Callers check the block belongs to the active Owner first. */
export function insertBlockProtection(input: InsertBlockProtectionInput): BlockProtectionRow {
  const row = db
    .insert(blockProtections)
    .values(
      tenantValues({
        id: randomUUID(),
        blockId: input.blockId,
        kind: input.kind,
        springShiftDays: input.springShiftDays,
        fallShiftDays: input.fallShiftDays,
        provenance: input.provenance,
        installedOn: input.installedOn === null ? null : new Date(input.installedOn),
        removedOn: input.removedOn === null ? null : new Date(input.removedOn),
        seasonYear: input.seasonYear,
        notes: input.notes,
        createdAt: new Date(Date.now())
      })
    )
    .returning()
    .get();
  return toRow(row);
}

/** Hard delete: a cover is planning data, not a record. */
export function deleteBlockProtection(blockId: string, id: string): boolean {
  const res = db
    .delete(blockProtections)
    .where(
      withTenant(
        blockProtections,
        and(eq(blockProtections.id, id), eq(blockProtections.blockId, blockId))
      )
    )
    .run();
  return res.changes > 0;
}
