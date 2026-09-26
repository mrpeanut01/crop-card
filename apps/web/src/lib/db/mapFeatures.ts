import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from './client';
import { mapFeatures } from './schema';
import { tenantValues, withTenant } from './tenant';
import {
  isMapFeatureKind,
  lineLengthFt,
  parseFeatureDetails,
  parseFeatureGeometry,
  type FeatureGeometry,
  type MapFeatureDetails,
  type MapFeatureKind,
  type MapFeatureView
} from '$lib/farm/mapFeatures';

export interface MapFeature extends MapFeatureView {
  createdAt: number;
}

function rowToFeature(row: typeof mapFeatures.$inferSelect): MapFeature | null {
  if (!isMapFeatureKind(row.kind)) return null;
  const geom = parseFeatureGeometry(row.kind, row.geometryGeojson);
  const geometry = geom.ok ? geom.geometry : null;
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    fieldId: row.fieldId ?? null,
    geometry,
    details: parseFeatureDetails(row.kind, row.detailsJson),
    lengthFt: lineLengthFt(geometry),
    createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : Number(row.createdAt)
  };
}

function present(rows: Array<typeof mapFeatures.$inferSelect>): MapFeature[] {
  return rows.map(rowToFeature).filter((f): f is MapFeature => f !== null);
}

export interface CreateMapFeatureInput {
  kind: MapFeatureKind;
  name: string;
  geometry: FeatureGeometry;
  fieldId?: string | null;
  details?: MapFeatureDetails | null;
}

/** Callers validate geometry and details first (`parseFeatureGeometry`,
 *  `validateFeatureDetails`); the repo stores what it's given. */
export function createMapFeature(input: CreateMapFeatureInput): MapFeature {
  const row = db
    .insert(mapFeatures)
    .values(
      tenantValues({
        id: randomUUID(),
        kind: input.kind,
        name: input.name,
        fieldId: input.fieldId ?? null,
        geometryGeojson: JSON.stringify(input.geometry),
        detailsJson: input.details ? JSON.stringify(input.details) : null,
        createdAt: new Date(Date.now())
      })
    )
    .returning()
    .get();
  return rowToFeature(row)!;
}

export function listMapFeatures(opts: { kind?: MapFeatureKind; fieldId?: string } = {}) {
  const rows = db
    .select()
    .from(mapFeatures)
    .where(
      withTenant(
        mapFeatures,
        opts.kind ? eq(mapFeatures.kind, opts.kind) : undefined,
        opts.fieldId ? eq(mapFeatures.fieldId, opts.fieldId) : undefined
      )
    )
    .orderBy(mapFeatures.createdAt)
    .all();
  return present(rows);
}

export function getMapFeature(id: string): MapFeature | undefined {
  const row = db
    .select()
    .from(mapFeatures)
    .where(withTenant(mapFeatures, eq(mapFeatures.id, id)))
    .get();
  return (row && rowToFeature(row)) || undefined;
}

export interface UpdateMapFeatureInput {
  name?: string;
  geometry?: FeatureGeometry;
  fieldId?: string | null;
  details?: MapFeatureDetails | null;
}

export function updateMapFeature(id: string, patch: UpdateMapFeatureInput): MapFeature | undefined {
  const set: Partial<typeof mapFeatures.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.geometry !== undefined) set.geometryGeojson = JSON.stringify(patch.geometry);
  if (patch.fieldId !== undefined) set.fieldId = patch.fieldId;
  if (patch.details !== undefined) {
    set.detailsJson = patch.details ? JSON.stringify(patch.details) : null;
  }
  if (Object.keys(set).length === 0) return getMapFeature(id);
  const row = db
    .update(mapFeatures)
    .set(set)
    .where(withTenant(mapFeatures, eq(mapFeatures.id, id)))
    .returning()
    .get();
  return (row && rowToFeature(row)) || undefined;
}

export function deleteMapFeature(id: string): boolean {
  return (
    db
      .delete(mapFeatures)
      .where(withTenant(mapFeatures, eq(mapFeatures.id, id)))
      .run().changes > 0
  );
}

/** Keeps a feature on the map when the Area it was tied to is deleted. */
export function unlinkMapFeaturesFromField(fieldId: string): number {
  return db
    .update(mapFeatures)
    .set({ fieldId: null })
    .where(withTenant(mapFeatures, eq(mapFeatures.fieldId, fieldId)))
    .run().changes;
}

/** The client-safe shape (no timestamps), sorted for a stable snapshot. */
export function listMapFeatureViews(): MapFeatureView[] {
  return listMapFeatures()
    .map(({ createdAt: _createdAt, ...view }) => view)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}
