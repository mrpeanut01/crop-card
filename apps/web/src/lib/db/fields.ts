/**
 * Fields repo (Phase 13).
 *
 * A Field is a parent grouping for Blocks. Multi-property growers may have
 * several fields; single-field operators get an auto-created "Home Field"
 * via the migration backfill and the UI hides field controls until they
 * add a second.
 *
 * Phase 18a: tenant-scoped. Every read filters by active Owner; every write
 * stamps the active Owner. `ensureHomeField()` is per-Owner — each tenant
 * has its own "Home Field" row.
 */

import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from './client';
import { blocks, fields } from './schema';
import { effectiveAcresFor } from './blocks';
import { sketchAcres, storedSketchAcres } from '$lib/farm/sketch';
import {
  DEFAULT_AREA_KIND,
  GRAZING_AREA_KINDS,
  parseAreaDetails,
  perimeterFtFor,
  type AreaDetails,
  type AreaKind
} from '$lib/farm/areaKinds';
import { tenantValues, tenantWhere, withTenant } from './tenant';

export interface Field {
  id: string;
  name: string;
  acres?: number;
  location?: string;
  notes?: string;
  geometryGeojson?: string;
  widthFt?: number;
  lengthFt?: number;
  kind: AreaKind;
  details: AreaDetails | null;
  perimeterFt?: number;
  /** Where `acres` came from; undefined when there are no acres. */
  acresSource?: AcresSource;
  createdAt: number;
}

export type AcresSource = 'geometry' | 'dimensions' | 'typed';

function acresSourceFor(row: typeof fields.$inferSelect): AcresSource | undefined {
  if (effectiveAcresFor({ acres: undefined, geometryGeojson: row.geometryGeojson }) !== undefined) {
    return 'geometry';
  }
  if (row.acres == null) return undefined;
  const fromDims = sketchAcres(row.widthFt, row.lengthFt);
  const stored = storedSketchAcres(row.acres, row.widthFt, row.lengthFt) ?? row.acres;
  return fromDims !== undefined && Math.abs(fromDims - stored) < 1e-9 ? 'dimensions' : 'typed';
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
    acres: effectiveAcresFor({
      acres: storedSketchAcres(row.acres, row.widthFt, row.lengthFt),
      geometryGeojson: row.geometryGeojson
    }),
    location: row.location ?? undefined,
    notes: row.notes ?? undefined,
    geometryGeojson: row.geometryGeojson ?? undefined,
    widthFt: row.widthFt ?? undefined,
    lengthFt: row.lengthFt ?? undefined,
    kind: row.kind,
    details: parseAreaDetails(row.kind, row.detailsJson),
    // Rows from before migration 0050 have no stored perimeter.
    perimeterFt: row.perimeterFt ?? perimeterFtFor(row) ?? undefined,
    acresSource: acresSourceFor(row),
    createdAt: row.createdAt.getTime()
  };
}

export function listFields(opts: { kinds?: readonly AreaKind[] } = {}): FieldWithBlocks[] {
  if (opts.kinds && opts.kinds.length === 0) return [];
  const fieldRows = db
    .select()
    .from(fields)
    .where(
      opts.kinds ? withTenant(fields, inArray(fields.kind, [...opts.kinds])) : tenantWhere(fields)
    )
    .all();
  if (fieldRows.length === 0) return [];
  const blockRows = db
    .select({
      fieldId: blocks.fieldId,
      acres: blocks.acres,
      widthFt: blocks.widthFt,
      lengthFt: blocks.lengthFt,
      geometryGeojson: blocks.geometryGeojson
    })
    .from(blocks)
    .where(tenantWhere(blocks))
    .all();
  const counts = new Map<string, { count: number; acres: number }>();
  for (const b of blockRows) {
    if (!b.fieldId) continue;
    const cur = counts.get(b.fieldId) ?? { count: 0, acres: 0 };
    cur.count += 1;
    cur.acres +=
      effectiveAcresFor({
        acres: storedSketchAcres(b.acres, b.widthFt, b.lengthFt),
        geometryGeojson: b.geometryGeojson
      }) ?? 0;
    counts.set(b.fieldId, cur);
  }
  return fieldRows
    .map((row) => {
      const c = counts.get(row.id) ?? { count: 0, acres: 0 };
      return { ...rowToField(row), blockCount: c.count, blockAcresTotal: c.acres };
    })
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Ids of the active Owner's Areas whose kind is grazing land. */
export function listGrazingAreaIds(): Set<string> {
  return new Set(
    db
      .select({ id: fields.id })
      .from(fields)
      .where(withTenant(fields, inArray(fields.kind, [...GRAZING_AREA_KINDS])))
      .all()
      .map((r) => r.id)
  );
}

export function getField(id: string): Field | undefined {
  const row = db
    .select()
    .from(fields)
    .where(withTenant(fields, eq(fields.id, id)))
    .get();
  return row ? rowToField(row) : undefined;
}

/** @hold-exempt: a new Area has no blocks or stays, so it holds nothing */
export function createField(input: {
  name: string;
  acres?: number;
  location?: string;
  notes?: string;
  geometryGeojson?: string;
  widthFt?: number;
  lengthFt?: number;
  kind?: AreaKind;
  details?: AreaDetails | null;
}): Field {
  const id = randomUUID();
  const acresToPersist =
    effectiveAcresFor({
      acres: input.acres ?? sketchAcres(input.widthFt, input.lengthFt),
      geometryGeojson: input.geometryGeojson
    }) ?? null;
  const row = db
    .insert(fields)
    .values(
      tenantValues({
        id,
        name: input.name,
        acres: acresToPersist,
        location: input.location ?? null,
        notes: input.notes ?? null,
        geometryGeojson: input.geometryGeojson ?? null,
        widthFt: input.widthFt ?? null,
        lengthFt: input.lengthFt ?? null,
        kind: input.kind ?? DEFAULT_AREA_KIND,
        detailsJson: input.details ? JSON.stringify(input.details) : null,
        perimeterFt: perimeterFtFor(input)
      })
    )
    .returning()
    .get();
  return rowToField(row);
}

/** @hold-exempt: Area attributes; holds key on the Area id, and every patch carrying a kind (grazing land or not) runs inside the hold guard in PATCH /api/fields/:id */
export function updateField(
  id: string,
  patch: {
    name?: string;
    acres?: number | null;
    location?: string | null;
    notes?: string | null;
    geometryGeojson?: string | null;
    widthFt?: number | null;
    lengthFt?: number | null;
    kind?: AreaKind;
    details?: AreaDetails | null;
  }
): Field | undefined {
  const set: Partial<typeof fields.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.acres !== undefined) set.acres = patch.acres;
  if (patch.location !== undefined) set.location = patch.location;
  if (patch.notes !== undefined) set.notes = patch.notes;
  if (patch.widthFt !== undefined) set.widthFt = patch.widthFt;
  if (patch.lengthFt !== undefined) set.lengthFt = patch.lengthFt;
  if (patch.geometryGeojson !== undefined) {
    set.geometryGeojson = patch.geometryGeojson;
    const fromGeo = effectiveAcresFor({ acres: undefined, geometryGeojson: patch.geometryGeojson });
    if (fromGeo !== undefined) set.acres = fromGeo;
  }
  if (patch.details !== undefined) {
    set.detailsJson = patch.details ? JSON.stringify(patch.details) : null;
  }
  const touchesShape =
    patch.geometryGeojson !== undefined ||
    patch.widthFt !== undefined ||
    patch.lengthFt !== undefined;
  if (patch.kind !== undefined || touchesShape) {
    const current = db
      .select()
      .from(fields)
      .where(withTenant(fields, eq(fields.id, id)))
      .get();
    if (!current) return undefined;
    if (patch.kind !== undefined) {
      set.kind = patch.kind;
      if (
        patch.details === undefined &&
        current.detailsJson &&
        parseAreaDetails(patch.kind, current.detailsJson) === null
      ) {
        set.detailsJson = null;
      }
    }
    if (touchesShape) {
      set.perimeterFt = perimeterFtFor({
        geometryGeojson:
          patch.geometryGeojson !== undefined ? patch.geometryGeojson : current.geometryGeojson,
        widthFt: patch.widthFt !== undefined ? patch.widthFt : current.widthFt,
        lengthFt: patch.lengthFt !== undefined ? patch.lengthFt : current.lengthFt
      });
    }
  }
  if (Object.keys(set).length === 0) return getField(id);
  const row = db
    .update(fields)
    .set(set)
    .where(withTenant(fields, eq(fields.id, id)))
    .returning()
    .get();
  return row ? rowToField(row) : undefined;
}

/** Returns the auto-created "Home Field" id for the active Owner (creates
 *  one if missing). Application code calls this on first-block creation
 *  when the user has not yet picked a parent field.
 * @hold-exempt: creates an empty Area at most
 */
export function ensureHomeField(): string {
  const existing = db
    .select({ id: fields.id })
    .from(fields)
    .where(and(tenantWhere(fields), eq(fields.name, 'Home Field')))
    .get();
  if (existing) return existing.id;
  return createField({ name: 'Home Field' }).id;
}
