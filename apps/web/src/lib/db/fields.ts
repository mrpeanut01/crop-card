/**
 * Fields repo (Phase 13).
 *
 * A Field is a parent grouping for Blocks. Multi-property growers may have
 * several fields; single-field operators get an auto-created "Home Field"
 * via the migration backfill and the UI hides field controls until they
 * add a second.
 */

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from './client';
import { blocks, fields } from './schema';
import { effectiveAcresFor } from './blocks';

export interface Field {
  id: string;
  name: string;
  acres?: number;
  location?: string;
  notes?: string;
  geometryGeojson?: string;
  createdAt: number;
}

export interface FieldWithBlocks extends Field {
  blockCount: number;
  /** Sum of `blocks.acres` for member blocks (ignores nulls). */
  blockAcresTotal: number;
}

function rowToField(row: typeof fields.$inferSelect): Field {
  return {
    id: row.id,
    name: row.name,
    acres: effectiveAcresFor({ acres: row.acres, geometryGeojson: row.geometryGeojson }),
    location: row.location ?? undefined,
    notes: row.notes ?? undefined,
    geometryGeojson: row.geometryGeojson ?? undefined,
    createdAt: row.createdAt.getTime()
  };
}

export function listFields(): FieldWithBlocks[] {
  const fieldRows = db.select().from(fields).all();
  if (fieldRows.length === 0) return [];
  const blockRows = db
    .select({ fieldId: blocks.fieldId, acres: blocks.acres, geometryGeojson: blocks.geometryGeojson })
    .from(blocks)
    .all();
  const counts = new Map<string, { count: number; acres: number }>();
  for (const b of blockRows) {
    if (!b.fieldId) continue;
    const cur = counts.get(b.fieldId) ?? { count: 0, acres: 0 };
    cur.count += 1;
    cur.acres += effectiveAcresFor({ acres: b.acres, geometryGeojson: b.geometryGeojson }) ?? 0;
    counts.set(b.fieldId, cur);
  }
  return fieldRows
    .map((row) => {
      const c = counts.get(row.id) ?? { count: 0, acres: 0 };
      return { ...rowToField(row), blockCount: c.count, blockAcresTotal: c.acres };
    })
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function getField(id: string): Field | undefined {
  const row = db.select().from(fields).where(eq(fields.id, id)).get();
  return row ? rowToField(row) : undefined;
}

export function createField(input: {
  name: string;
  acres?: number;
  location?: string;
  notes?: string;
  geometryGeojson?: string;
}): Field {
  const id = randomUUID();
  const acresToPersist =
    effectiveAcresFor({ acres: input.acres, geometryGeojson: input.geometryGeojson }) ?? null;
  const row = db
    .insert(fields)
    .values({
      id,
      name: input.name,
      acres: acresToPersist,
      location: input.location ?? null,
      notes: input.notes ?? null,
      geometryGeojson: input.geometryGeojson ?? null
    })
    .returning()
    .get();
  return rowToField(row);
}

export function updateField(
  id: string,
  patch: {
    name?: string;
    acres?: number | null;
    location?: string | null;
    notes?: string | null;
    geometryGeojson?: string | null;
  }
): Field | undefined {
  const set: Partial<typeof fields.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.acres !== undefined) set.acres = patch.acres;
  if (patch.location !== undefined) set.location = patch.location;
  if (patch.notes !== undefined) set.notes = patch.notes;
  if (patch.geometryGeojson !== undefined) {
    set.geometryGeojson = patch.geometryGeojson;
    // Mirror the blocks repo: when geometry changes, persist the
    // geometry-derived acres so raw queries / exports stay truthful.
    const fromGeo = effectiveAcresFor({ acres: undefined, geometryGeojson: patch.geometryGeojson });
    if (fromGeo !== undefined) set.acres = fromGeo;
  }
  if (Object.keys(set).length === 0) return getField(id);
  const row = db.update(fields).set(set).where(eq(fields.id, id)).returning().get();
  return row ? rowToField(row) : undefined;
}

/** Returns the auto-created "Home Field" id (creates one if missing).
 *  Application code calls this on first-block creation when the user has
 *  not yet picked a parent field. */
export function ensureHomeField(): string {
  const existing = db
    .select({ id: fields.id })
    .from(fields)
    .where(eq(fields.name, 'Home Field'))
    .get();
  if (existing) return existing.id;
  return createField({ name: 'Home Field' }).id;
}
