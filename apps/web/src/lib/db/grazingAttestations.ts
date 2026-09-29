import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { GrazingAttestationInput } from '$lib/safety/grazingInterval';
import { db } from './client';
import { grazingAttestations } from './schema';
import { tenantValues, withTenant } from './tenant';

export interface GrazingAttestation extends GrazingAttestationInput {
  fieldId: string;
  reason: string;
  provenance: 'manual';
  attestedBy: string | null;
  createdAt: number;
}

function rowTo(row: typeof grazingAttestations.$inferSelect): GrazingAttestation {
  return {
    id: row.id,
    fieldId: row.fieldId,
    sprayEventRef: row.sprayEventRef ?? null,
    productPluginId: row.productPluginId ?? null,
    grazeDays: row.grazeDays ?? null,
    hayDays: row.hayDays ?? null,
    lactatingGrazeDays: row.lactatingGrazeDays ?? null,
    meatRemovalDays: row.meatRemovalDays ?? null,
    reason: row.reason,
    provenance: row.provenance,
    attestedBy: row.attestedBy ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : Number(row.createdAt)
  };
}

export interface ListGrazingAttestationFilters {
  fieldIds?: readonly string[];
  sprayEventRefs?: readonly string[];
}

/** Append-only (C-27): there is no update or delete. */
export function listGrazingAttestations(
  filters: ListGrazingAttestationFilters = {}
): GrazingAttestation[] {
  const conditions = [];
  if (filters.fieldIds) {
    if (filters.fieldIds.length === 0) return [];
    conditions.push(inArray(grazingAttestations.fieldId, [...filters.fieldIds]));
  }
  if (filters.sprayEventRefs) {
    if (filters.sprayEventRefs.length === 0) return [];
    conditions.push(inArray(grazingAttestations.sprayEventRef, [...filters.sprayEventRefs]));
  }
  return db
    .select()
    .from(grazingAttestations)
    .where(withTenant(grazingAttestations, conditions.length ? and(...conditions) : undefined))
    .orderBy(desc(grazingAttestations.createdAt))
    .all()
    .map(rowTo);
}

export function getGrazingAttestation(id: string): GrazingAttestation | undefined {
  const row = db
    .select()
    .from(grazingAttestations)
    .where(withTenant(grazingAttestations, eq(grazingAttestations.id, id)))
    .get();
  return row ? rowTo(row) : undefined;
}

export interface InsertGrazingAttestationInput {
  fieldId: string;
  sprayEventRef: string;
  productPluginId: string | null;
  grazeDays: number | null;
  hayDays: number | null;
  lactatingGrazeDays?: number | null;
  meatRemovalDays?: number | null;
  reason: string;
  attestedBy: string | null;
}

/** Callers check the owner role, the field and the application first. */
export function insertGrazingAttestation(input: InsertGrazingAttestationInput): GrazingAttestation {
  const row = db
    .insert(grazingAttestations)
    .values(
      tenantValues({
        id: randomUUID(),
        fieldId: input.fieldId,
        productPluginId: input.productPluginId,
        sprayEventRef: input.sprayEventRef,
        grazeDays: input.grazeDays,
        hayDays: input.hayDays,
        lactatingGrazeDays: input.lactatingGrazeDays ?? null,
        meatRemovalDays: input.meatRemovalDays ?? null,
        reason: input.reason,
        provenance: 'manual' as const,
        attestedBy: input.attestedBy
      })
    )
    .returning()
    .get();
  return rowTo(row);
}
