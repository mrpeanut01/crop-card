/**
 * Block + planting-record repo. A block is a named field area; planting
 * records associate a crop variety + planting date with a block. The Safety
 * Kernel evaluates against the union of crops present in a block.
 *
 * Phase 13: blocks now belong to a Field (auto "Home Field" for single-field
 * users). On creation, an unspecified fieldId resolves via ensureHomeField().
 *
 * Phase 14 (swim-lane): blocks carry `eastWestIndex` / `northSouthIndex`
 * dense ranks computed from `geometryGeojson` centroid. Convention is
 * documented in the schema (E increases east, N increases north).
 *
 * Phase 18a (multi-tenant): every read filters by the active Owner; every
 * write stamps the active Owner. The axes recompute reads / writes only
 * within the current tenant — cross-tenant blocks never compete for axis
 * ranks.
 */

import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from './client';
import { ensureHomeField } from './fields';
import { blocks, plantingRecords } from './schema';
import { tenantValues, tenantWhere, withTenant } from './tenant';
import { geojsonAreaAcres } from '$lib/geo/area';

export type TillageMethod = 'conventional' | 'reduced-till' | 'no-till';
export type SunExposure = 'full' | 'partial' | 'shade';

export interface Block {
  id: string;
  name: string;
  acres?: number;
  blockLabel?: string;
  fieldId?: string;
  /** GeoJSON Polygon or MultiPolygon (Phase 10 GPS stub). */
  geometryGeojson?: string;
  tillageMethod: TillageMethod;
  /** Phase 14: increases going east; null for blocks without geometry. */
  eastWestIndex?: number;
  /** Phase 14: increases going north. */
  northSouthIndex?: number;
  /** Phase 14: when true, `inferBlockAxes` won't overwrite this row's indices. */
  axesLocked: boolean;
  sunExposure?: SunExposure;
  slopePercent?: number;
  slopeAspectDeg?: number;
}

export interface PlantingRecord {
  id: string;
  blockId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  plantingDate: number | null;
  quantityPlanted?: number;
  quantityUnit?: string;
}

export interface BlockWithPlantings extends Block {
  plantings: PlantingRecord[];
}

export function effectiveAcresFor(input: {
  acres: number | null | undefined;
  geometryGeojson: string | null | undefined;
}): number | undefined {
  const fromGeo = geojsonAreaAcres(input.geometryGeojson ?? null);
  if (fromGeo !== null && Number.isFinite(fromGeo) && fromGeo > 0) return fromGeo;
  return input.acres == null ? undefined : input.acres;
}

function rowToBlock(row: typeof blocks.$inferSelect): Block {
  return {
    id: row.id,
    name: row.name,
    acres: effectiveAcresFor({ acres: row.acres, geometryGeojson: row.geometryGeojson }),
    blockLabel: row.blockLabel ?? undefined,
    fieldId: row.fieldId ?? undefined,
    geometryGeojson: row.geometryGeojson ?? undefined,
    tillageMethod: (row.tillageMethod ?? 'conventional') as TillageMethod,
    eastWestIndex: row.eastWestIndex ?? undefined,
    northSouthIndex: row.northSouthIndex ?? undefined,
    axesLocked: row.axesLocked ?? false,
    sunExposure: (row.sunExposure as SunExposure | null) ?? undefined,
    slopePercent: row.slopePercent ?? undefined,
    slopeAspectDeg: row.slopeAspectDeg ?? undefined
  };
}

export function listBlocks(): BlockWithPlantings[] {
  const blockRows = db.select().from(blocks).where(tenantWhere(blocks)).all();
  if (blockRows.length === 0) return [];
  const all = db.select().from(plantingRecords).where(tenantWhere(plantingRecords)).all();
  const grouped = new Map<string, PlantingRecord[]>();
  for (const p of all) {
    const list = grouped.get(p.blockId) ?? [];
    list.push({
      id: p.id,
      blockId: p.blockId,
      cropPluginId: p.cropPluginId,
      varietyDisplayName: p.varietyDisplayName,
      plantingDate: p.plantingDate?.getTime() ?? null,
      quantityPlanted:
        p.quantityPlantedHundredths != null ? p.quantityPlantedHundredths / 100 : undefined,
      quantityUnit: p.quantityUnit ?? undefined
    });
    grouped.set(p.blockId, list);
  }
  return blockRows.map((b) => ({
    ...rowToBlock(b),
    plantings: grouped.get(b.id) ?? []
  }));
}

export function getBlock(id: string): BlockWithPlantings | undefined {
  const row = db.select().from(blocks).where(withTenant(blocks, eq(blocks.id, id))).get();
  if (!row) return undefined;
  const plantings = db
    .select()
    .from(plantingRecords)
    .where(withTenant(plantingRecords, eq(plantingRecords.blockId, id)))
    .all()
    .map((p) => ({
      id: p.id,
      blockId: p.blockId,
      cropPluginId: p.cropPluginId,
      varietyDisplayName: p.varietyDisplayName,
      plantingDate: p.plantingDate?.getTime() ?? null,
      quantityPlanted:
        p.quantityPlantedHundredths != null ? p.quantityPlantedHundredths / 100 : undefined,
      quantityUnit: p.quantityUnit ?? undefined
    }));
  return { ...rowToBlock(row), plantings };
}

export function createBlock(input: {
  name: string;
  acres?: number;
  blockLabel?: string;
  fieldId?: string;
  geometryGeojson?: string;
  tillageMethod?: TillageMethod;
  sunExposure?: SunExposure;
  /** Manual override; if provided, axes are written and locked. */
  eastWestIndex?: number;
  northSouthIndex?: number;
}): Block {
  const id = randomUUID();
  const fieldId = input.fieldId ?? ensureHomeField();
  const acresToPersist =
    effectiveAcresFor({ acres: input.acres, geometryGeojson: input.geometryGeojson }) ?? null;
  const row = db
    .insert(blocks)
    .values(
      tenantValues({
        id,
        name: input.name,
        acres: acresToPersist,
        blockLabel: input.blockLabel ?? null,
        fieldId,
        geometryGeojson: input.geometryGeojson ?? null,
        tillageMethod: input.tillageMethod ?? 'conventional',
        sunExposure: input.sunExposure ?? null,
        eastWestIndex: input.eastWestIndex ?? null,
        northSouthIndex: input.northSouthIndex ?? null,
        axesLocked: input.eastWestIndex !== undefined || input.northSouthIndex !== undefined
      })
    )
    .returning()
    .get();
  recomputeBlockAxes();
  const fresh = db.select().from(blocks).where(withTenant(blocks, eq(blocks.id, id))).get();
  return fresh ? rowToBlock(fresh) : rowToBlock(row);
}

export function setBlockGeometry(
  blockId: string,
  geometryGeojson: string | null
): Block | undefined {
  const update: { geometryGeojson: string | null; acres?: number } = { geometryGeojson };
  const fromGeo = geojsonAreaAcres(geometryGeojson);
  if (fromGeo !== null && Number.isFinite(fromGeo) && fromGeo > 0) {
    update.acres = fromGeo;
  }
  const row = db
    .update(blocks)
    .set(update)
    .where(withTenant(blocks, eq(blocks.id, blockId)))
    .returning()
    .get();
  if (!row) return undefined;
  recomputeBlockAxes();
  const fresh = db
    .select()
    .from(blocks)
    .where(withTenant(blocks, eq(blocks.id, blockId)))
    .get();
  return fresh ? rowToBlock(fresh) : rowToBlock(row);
}

export function updateBlock(
  id: string,
  patch: {
    name?: string;
    acres?: number | null;
    blockLabel?: string | null;
    fieldId?: string;
    tillageMethod?: TillageMethod;
    sunExposure?: SunExposure | null;
    eastWestIndex?: number | null;
    northSouthIndex?: number | null;
    axesLocked?: boolean;
    slopePercent?: number | null;
    slopeAspectDeg?: number | null;
  }
): Block | undefined {
  const set: Partial<typeof blocks.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.acres !== undefined) set.acres = patch.acres;
  if (patch.blockLabel !== undefined) set.blockLabel = patch.blockLabel;
  if (patch.fieldId !== undefined) set.fieldId = patch.fieldId;
  if (patch.tillageMethod !== undefined) set.tillageMethod = patch.tillageMethod;
  if (patch.sunExposure !== undefined) set.sunExposure = patch.sunExposure;
  if (patch.slopePercent !== undefined) set.slopePercent = patch.slopePercent;
  if (patch.slopeAspectDeg !== undefined) set.slopeAspectDeg = patch.slopeAspectDeg;
  const axisManualEdit =
    patch.eastWestIndex !== undefined || patch.northSouthIndex !== undefined;
  if (patch.eastWestIndex !== undefined) set.eastWestIndex = patch.eastWestIndex;
  if (patch.northSouthIndex !== undefined) set.northSouthIndex = patch.northSouthIndex;
  if (patch.axesLocked !== undefined) set.axesLocked = patch.axesLocked;
  else if (axisManualEdit) set.axesLocked = true;
  if (Object.keys(set).length === 0) {
    const cur = db.select().from(blocks).where(withTenant(blocks, eq(blocks.id, id))).get();
    return cur ? rowToBlock(cur) : undefined;
  }
  const row = db
    .update(blocks)
    .set(set)
    .where(withTenant(blocks, eq(blocks.id, id)))
    .returning()
    .get();
  if (!row) return undefined;
  recomputeBlockAxes();
  const fresh = db.select().from(blocks).where(withTenant(blocks, eq(blocks.id, id))).get();
  return fresh ? rowToBlock(fresh) : rowToBlock(row);
}

export function addPlanting(input: {
  blockId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  plantingDate: number | null;
  quantityPlanted?: number;
  quantityUnit?: string;
}): PlantingRecord {
  if (input.plantingDate === null && input.quantityPlanted !== undefined) {
    const conds = [
      eq(plantingRecords.blockId, input.blockId),
      eq(plantingRecords.cropPluginId, input.cropPluginId),
      eq(plantingRecords.status, 'planned'),
      isNull(plantingRecords.plantingDate)
    ];
    if (input.quantityUnit) {
      conds.push(eq(plantingRecords.quantityUnit, input.quantityUnit));
    } else {
      conds.push(isNull(plantingRecords.quantityUnit));
    }
    const existing = db
      .select()
      .from(plantingRecords)
      .where(withTenant(plantingRecords, and(...conds)))
      .limit(1)
      .get();
    if (existing) {
      const addHundredths = Math.round(input.quantityPlanted * 100);
      const updated = db
        .update(plantingRecords)
        .set({
          quantityPlantedHundredths: sql`COALESCE(${plantingRecords.quantityPlantedHundredths}, 0) + ${addHundredths}`
        })
        .where(withTenant(plantingRecords, eq(plantingRecords.id, existing.id)))
        .returning()
        .get();
      return {
        id: updated.id,
        blockId: updated.blockId,
        cropPluginId: updated.cropPluginId,
        varietyDisplayName: updated.varietyDisplayName,
        plantingDate: updated.plantingDate?.getTime() ?? null
      };
    }
  }

  const id = randomUUID();
  const row = db
    .insert(plantingRecords)
    .values(
      tenantValues({
        id,
        blockId: input.blockId,
        cropPluginId: input.cropPluginId,
        varietyDisplayName: input.varietyDisplayName,
        plantingDate: input.plantingDate !== null ? new Date(input.plantingDate) : null,
        status: input.plantingDate === null ? 'planned' : 'active',
        quantityPlantedHundredths:
          input.quantityPlanted !== undefined ? Math.round(input.quantityPlanted * 100) : null,
        quantityUnit: input.quantityUnit ?? null
      })
    )
    .returning()
    .get();
  return {
    id: row.id,
    blockId: row.blockId,
    cropPluginId: row.cropPluginId,
    varietyDisplayName: row.varietyDisplayName,
    plantingDate: row.plantingDate?.getTime() ?? null
  };
}

export function deleteBlock(id: string): boolean {
  // Plantings cascade only if FK ON DELETE CASCADE is set; we delete manually.
  db.delete(plantingRecords)
    .where(withTenant(plantingRecords, eq(plantingRecords.blockId, id)))
    .run();
  const result = db
    .delete(blocks)
    .where(withTenant(blocks, eq(blocks.id, id)))
    .run();
  recomputeBlockAxes();
  return result.changes > 0;
}

// ─── Phase 14: axis inference from geometry centroid ────────────────────

export function geometryCentroid(geojson: string): { lon: number; lat: number } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(geojson);
  } catch {
    return null;
  }
  const coords = extractOuterRing(parsed);
  if (!coords || coords.length === 0) return null;
  let sumLon = 0;
  let sumLat = 0;
  for (const [lon, lat] of coords) {
    sumLon += lon;
    sumLat += lat;
  }
  return { lon: sumLon / coords.length, lat: sumLat / coords.length };
}

function extractOuterRing(g: unknown): [number, number][] | null {
  if (!g || typeof g !== 'object') return null;
  const obj = g as Record<string, unknown>;
  const type = obj.type;
  if (type === 'Feature') return extractOuterRing(obj.geometry);
  if (type === 'Polygon') {
    const coords = obj.coordinates as unknown;
    if (Array.isArray(coords) && Array.isArray(coords[0])) {
      return (coords[0] as unknown[]).filter(isLonLat) as [number, number][];
    }
  }
  if (type === 'MultiPolygon') {
    const coords = obj.coordinates as unknown;
    if (Array.isArray(coords) && Array.isArray(coords[0]) && Array.isArray(coords[0][0])) {
      return (coords[0][0] as unknown[]).filter(isLonLat) as [number, number][];
    }
  }
  return null;
}

function isLonLat(v: unknown): boolean {
  return Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number';
}

export function inferBlockAxes(
  all: ReadonlyArray<Block>
): Map<string, { east: number | null; north: number | null }> {
  const out = new Map<string, { east: number | null; north: number | null }>();
  for (const b of all) {
    out.set(b.id, {
      east: b.eastWestIndex ?? null,
      north: b.northSouthIndex ?? null
    });
  }
  const candidates = all
    .filter((b) => !b.axesLocked && b.geometryGeojson)
    .map((b) => {
      const c = geometryCentroid(b.geometryGeojson!);
      return c ? { id: b.id, lon: c.lon, lat: c.lat } : null;
    })
    .filter((x): x is { id: string; lon: number; lat: number } => x !== null);
  if (candidates.length === 0) return out;

  const eastSorted = [...candidates].sort((a, b) => a.lon - b.lon);
  const northSorted = [...candidates].sort((a, b) => a.lat - b.lat);
  eastSorted.forEach((c, i) => {
    const cur = out.get(c.id)!;
    cur.east = i;
  });
  northSorted.forEach((c, i) => {
    const cur = out.get(c.id)!;
    cur.north = i;
  });
  return out;
}

export function recomputeBlockAxes(): void {
  const rows = db.select().from(blocks).where(tenantWhere(blocks)).all().map(rowToBlock);
  const next = inferBlockAxes(rows);
  for (const b of rows) {
    if (b.axesLocked) continue;
    const want = next.get(b.id);
    if (!want) continue;
    if (want.east !== (b.eastWestIndex ?? null) || want.north !== (b.northSouthIndex ?? null)) {
      db.update(blocks)
        .set({ eastWestIndex: want.east, northSouthIndex: want.north })
        .where(withTenant(blocks, eq(blocks.id, b.id)))
        .run();
    }
  }
}
