import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { db } from './client';
import { mapFeatureAreas, mapFeatures } from './schema';
import { tenantValues, withTenant } from './tenant';
import {
  isMapFeatureKind,
  lineLengthFt,
  parseFeatureDetails,
  parseFeatureGeometry,
  servesManyAreas,
  type FeatureGeometry,
  type MapFeatureDetails,
  type MapFeatureKind,
  type MapFeatureView
} from '$lib/farm/mapFeatures';

export interface MapFeature extends MapFeatureView {
  createdAt: number;
}

function rowToFeature(
  row: typeof mapFeatures.$inferSelect,
  links: ReadonlyMap<string, string[]> = new Map()
): MapFeature | null {
  if (!isMapFeatureKind(row.kind)) return null;
  const geom = parseFeatureGeometry(row.kind, row.geometryGeojson);
  const geometry = geom.ok ? geom.geometry : null;
  const linked = servesManyAreas(row.kind) ? (links.get(row.id) ?? []) : [];
  const fieldId = row.fieldId ?? linked[0] ?? null;
  const areaIds = servesManyAreas(row.kind)
    ? linked.length
      ? linked
      : fieldId
        ? [fieldId]
        : []
    : fieldId
      ? [fieldId]
      : [];
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    fieldId,
    areaIds,
    geometry,
    details: parseFeatureDetails(row.kind, row.detailsJson),
    lengthFt: lineLengthFt(geometry),
    createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : Number(row.createdAt)
  };
}

/** Linked Areas per feature, in the owner's order. */
function linksFor(featureId?: string): Map<string, string[]> {
  const rows = db
    .select({ featureId: mapFeatureAreas.featureId, fieldId: mapFeatureAreas.fieldId })
    .from(mapFeatureAreas)
    .where(
      withTenant(mapFeatureAreas, featureId ? eq(mapFeatureAreas.featureId, featureId) : undefined)
    )
    .orderBy(asc(mapFeatureAreas.position), asc(mapFeatureAreas.fieldId))
    .all();
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const list = out.get(r.featureId) ?? [];
    list.push(r.fieldId);
    out.set(r.featureId, list);
  }
  return out;
}

function present(rows: Array<typeof mapFeatures.$inferSelect>): MapFeature[] {
  if (!rows.length) return [];
  const links = rows.some((r) => isMapFeatureKind(r.kind) && servesManyAreas(r.kind))
    ? linksFor()
    : new Map<string, string[]>();
  return rows.map((r) => rowToFeature(r, links)).filter((f): f is MapFeature => f !== null);
}

/** Replaces the Areas a hydrant or waterer serves. Callers check the ids
 *  belong to the active Owner (`rejectForeignRefs`). */
function writeLinks(featureId: string, areaIds: readonly string[]): void {
  db.delete(mapFeatureAreas)
    .where(withTenant(mapFeatureAreas, eq(mapFeatureAreas.featureId, featureId)))
    .run();
  const unique = [...new Set(areaIds)];
  if (!unique.length) return;
  db.insert(mapFeatureAreas)
    .values(unique.map((fieldId, position) => tenantValues({ featureId, fieldId, position })))
    .run();
}

export interface CreateMapFeatureInput {
  kind: MapFeatureKind;
  name: string;
  geometry: FeatureGeometry;
  fieldId?: string | null;
  details?: MapFeatureDetails | null;
  /** Hydrants and waterers only: every Area served, primary first. */
  areaIds?: readonly string[];
}

/** Callers validate geometry and details first (`parseFeatureGeometry`,
 *  `validateFeatureDetails`); the repo stores what it's given. */
export function createMapFeature(input: CreateMapFeatureInput): MapFeature {
  const multi = servesManyAreas(input.kind) && input.areaIds !== undefined;
  const fieldId = multi ? (input.areaIds![0] ?? null) : (input.fieldId ?? null);
  return db.transaction(() => {
    const row = db
      .insert(mapFeatures)
      .values(
        tenantValues({
          id: randomUUID(),
          kind: input.kind,
          name: input.name,
          fieldId,
          geometryGeojson: JSON.stringify(input.geometry),
          detailsJson: input.details ? JSON.stringify(input.details) : null,
          createdAt: new Date(Date.now())
        })
      )
      .returning()
      .get();
    if (servesManyAreas(input.kind)) {
      writeLinks(row.id, multi ? input.areaIds! : fieldId ? [fieldId] : []);
    }
    return rowToFeature(row, linksFor(row.id))!;
  });
}

export function listMapFeatures(opts: { kind?: MapFeatureKind; fieldId?: string } = {}) {
  const rows = db
    .select()
    .from(mapFeatures)
    .where(withTenant(mapFeatures, opts.kind ? eq(mapFeatures.kind, opts.kind) : undefined))
    .orderBy(mapFeatures.createdAt)
    .all();
  const all = present(rows);
  return opts.fieldId ? all.filter((f) => f.areaIds?.includes(opts.fieldId!)) : all;
}

export function getMapFeature(id: string): MapFeature | undefined {
  const row = db
    .select()
    .from(mapFeatures)
    .where(withTenant(mapFeatures, eq(mapFeatures.id, id)))
    .get();
  return (row && rowToFeature(row, linksFor(row.id))) || undefined;
}

export interface UpdateMapFeatureInput {
  name?: string;
  geometry?: FeatureGeometry;
  fieldId?: string | null;
  details?: MapFeatureDetails | null;
  /** Hydrants and waterers only; replaces every link and the primary. */
  areaIds?: readonly string[];
}

export function updateMapFeature(id: string, patch: UpdateMapFeatureInput): MapFeature | undefined {
  const { areaIds, ...rest } = patch;
  const relink =
    areaIds ?? (patch.fieldId !== undefined ? (patch.fieldId ? [patch.fieldId] : []) : undefined);
  if (relink !== undefined) {
    const current = getMapFeature(id);
    if (!current) return undefined;
    if (servesManyAreas(current.kind)) {
      return db.transaction(() => {
        writeLinks(id, relink);
        return updateRow(id, { ...rest, fieldId: relink[0] ?? null });
      });
    }
  }
  return updateRow(id, rest);
}

function updateRow(
  id: string,
  patch: Omit<UpdateMapFeatureInput, 'areaIds'>
): MapFeature | undefined {
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
  return (row && rowToFeature(row, linksFor(row.id))) || undefined;
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
  db.delete(mapFeatureAreas)
    .where(withTenant(mapFeatureAreas, eq(mapFeatureAreas.fieldId, fieldId)))
    .run();
  return db
    .update(mapFeatures)
    .set({ fieldId: null })
    .where(withTenant(mapFeatures, eq(mapFeatures.fieldId, fieldId)))
    .run().changes;
}

/** Every hydrant-to-Area link for the active Owner, for the GDPR export. */
export function listMapFeatureAreaLinks(): Array<{
  featureId: string;
  fieldId: string;
  position: number;
}> {
  return db
    .select({
      featureId: mapFeatureAreas.featureId,
      fieldId: mapFeatureAreas.fieldId,
      position: mapFeatureAreas.position
    })
    .from(mapFeatureAreas)
    .where(withTenant(mapFeatureAreas))
    .orderBy(asc(mapFeatureAreas.featureId), asc(mapFeatureAreas.position))
    .all();
}

/** The client-safe shape (no timestamps), sorted for a stable snapshot. */
export function listMapFeatureViews(): MapFeatureView[] {
  return listMapFeatures()
    .map(({ createdAt: _createdAt, ...view }) => view)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}
